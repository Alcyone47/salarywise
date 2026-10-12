import { doc, getDoc, getFirestore, onSnapshot, setDoc } from '@react-native-firebase/firestore';
import { decryptJson, encryptJson } from './crypto';
import { NON_PERSISTED_KEYS, type AppState } from './types';
import { getVaultKey } from './vault';

const userDoc = (uid: string) => doc(getFirestore(), 'users', uid);

// Set only by the verifyRazorpayPayment Cloud Function after checking a real
// payment — the client must never write these, or a regular state sync could
// clobber a real purchase (or the security rule would just reject the write).
const SERVER_ONLY_KEYS = ['proUnlocked', 'proUnlockedAt'];

// Thrown when users/{uid}.enc can't be opened with this device's data key —
// the key was replaced after a password reset on another device.
export class VaultKeyMismatchError extends Error {}

function stripNonPersisted(state: Partial<AppState>): Partial<AppState> {
  const toSave: Partial<AppState> & Record<string, unknown> = { ...state };
  for (const key of NON_PERSISTED_KEYS) delete toSave[key];
  for (const key of SERVER_ONLY_KEYS) delete toSave[key];
  // Firestore rejects `undefined` field values; round-trip through JSON to strip them.
  return JSON.parse(JSON.stringify(toSave));
}

export async function loadRemoteState(uid: string): Promise<Partial<AppState> | null> {
  let data: Record<string, unknown> | undefined;
  try {
    const snap = await getDoc(userDoc(uid));
    data = snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  } catch {
    return null;
  }
  // No encrypted profile yet — a brand-new account, or one whose data was
  // cleared after an unrecoverable password reset.
  if (typeof data?.enc !== 'string') return null;

  const key = getVaultKey(uid);
  if (!key) throw new VaultKeyMismatchError('Data key not loaded.');
  let decrypted: Partial<AppState>;
  try {
    decrypted = await decryptJson<Partial<AppState>>(data.enc, key);
  } catch {
    throw new VaultKeyMismatchError("This device's data key no longer matches.");
  }
  return {
    ...decrypted,
    onboarded: Boolean(data.onboarded),
    proUnlocked: Boolean(data.proUnlocked),
  };
}

export async function saveRemoteState(uid: string, state: AppState): Promise<void> {
  // Never fall back to writing plaintext — without the key there's no save.
  const key = getVaultKey(uid);
  if (!key) return;
  try {
    const { onboarded, ...sensitive } = stripNonPersisted(state);
    const enc = await encryptJson(sensitive, key);
    await setDoc(userDoc(uid), { enc, encVersion: 1, onboarded: Boolean(onboarded) }, { merge: true });
  } catch {
    // best-effort — mirrors saveState's silent-fail contract; the Firestore SDK
    // queues writes made while offline and flushes them once reconnected.
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleRemoteSave(uid: string, state: AppState, delayMs = 400): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    saveRemoteState(uid, state);
  }, delayMs);
}

export function cancelScheduledRemoteSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}

// Only proUnlocked is worth watching live — it's written server-side by the
// payment Cloud Function, outside the app's own debounced-save loop, so a
// one-time getDoc can miss it (e.g. a purchase completing on another device).
// The rest of AppState stays on the one-shot load to avoid a remote echo
// clobbering in-flight local edits while the user is typing.
export function subscribeProStatus(uid: string, onChange: (unlocked: boolean) => void): () => void {
  return onSnapshot(
    userDoc(uid),
    (snap) => onChange(Boolean(snap.data()?.proUnlocked)),
    () => {
      // best-effort — mirrors the silent-fail contract of loadRemoteState/saveRemoteState
    }
  );
}
