import { collection, deleteField, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch } from '@react-native-firebase/firestore';
import {
  decryptJson,
  deleteDeviceDek,
  encryptJson,
  generateKey,
  loadDeviceDek,
  saveDeviceDek,
  unwrapDek,
  wrapDek,
  type AesKey,
  type KeyWrap,
} from './crypto';

// Fields on users/{uid} that stay in plaintext: server-written Pro status,
// the onboarding flag the login screens branch on, and the encryption metadata.
// Everything else lives inside the encrypted `enc` blob.
export const PLAINTEXT_USER_KEYS = ['onboarded', 'proUnlocked', 'proUnlockedAt', 'keyWrap', 'enc', 'encVersion'];

const userDoc = (uid: string) => doc(getFirestore(), 'users', uid);
const expensesCollection = (uid: string) => collection(getFirestore(), 'users', uid, 'expenses');

let current: { uid: string; key: AesKey } | null = null;
const listeners = new Set<(uid: string | null) => void>();

function setCurrent(next: { uid: string; key: AesKey } | null) {
  current = next;
  for (const l of listeners) l(next?.uid ?? null);
}

export function getVaultKey(uid: string): AesKey | null {
  return current?.uid === uid ? current.key : null;
}

export function subscribeVault(listener: (uid: string | null) => void): () => void {
  listeners.add(listener);
  listener(current?.uid ?? null);
  return () => {
    listeners.delete(listener);
  };
}

// Cold start with a persisted Firebase session — no password to hand, so the
// data key has to come from this device's secure storage.
export async function loadVaultFromDevice(uid: string): Promise<boolean> {
  const key = await loadDeviceDek(uid);
  if (!key) return false;
  setCurrent({ uid, key });
  return true;
}

// Sign-out: forget the key in memory but keep the device copy, so a later
// password reset can still be recovered on this device.
export function lockVault(): void {
  setCurrent(null);
}

// Account deletion: nothing left to recover.
export async function clearVault(uid: string): Promise<void> {
  setCurrent(null);
  await deleteDeviceDek(uid);
}

async function opens(enc: unknown, key: AesKey): Promise<boolean> {
  if (typeof enc !== 'string') return true; // nothing encrypted yet to check against
  try {
    await decryptJson(enc, key);
    return true;
  } catch {
    return false;
  }
}

// Moves a pre-encryption account's plaintext fields and expenses into `enc`.
async function migratePlaintext(uid: string, data: Record<string, unknown> | undefined, key: AesKey, keyWrap: KeyWrap) {
  const update: Record<string, unknown> = { keyWrap, encVersion: 1 };
  const plain: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (PLAINTEXT_USER_KEYS.includes(k)) continue;
    plain[k] = v;
    update[k] = deleteField(); // merge alone would leave the plaintext copy behind
  }
  if (Object.keys(plain).length > 0) update.enc = await encryptJson(plain, key);
  await setDoc(userDoc(uid), update, { merge: true });

  const expenses = await getDocs(expensesCollection(uid));
  const batch = writeBatch(getFirestore());
  let pending = 0;
  for (const d of expenses.docs) {
    const entry = d.data();
    if (typeof entry.enc === 'string') continue;
    batch.set(d.ref, { enc: await encryptJson(entry, key) });
    pending++;
  }
  if (pending > 0) await batch.commit();
}

export interface UnlockResult {
  // True when the password was reset on a device that never held the data key,
  // so the old encrypted data couldn't be opened and was cleared.
  dataReset: boolean;
}

// Runs right after a successful sign-in/sign-up, while the password is known.
export async function unlockVault(uid: string, password: string): Promise<UnlockResult> {
  const snap = await getDoc(userDoc(uid));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : undefined;
  const wrap = data?.keyWrap as KeyWrap | undefined;

  // New account, or one created before encryption shipped.
  if (!wrap) {
    const key = (await loadDeviceDek(uid)) ?? (await generateKey());
    await saveDeviceDek(uid, key);
    await migratePlaintext(uid, data, key, await wrapDek(key, password));
    setCurrent({ uid, key });
    return { dataReset: false };
  }

  const key = await unwrapDek(wrap, password);
  if (key) {
    await saveDeviceDek(uid, key);
    setCurrent({ uid, key });
    return { dataReset: false };
  }

  // Firebase accepted the password but it doesn't open the wrap, so it was
  // reset. If this device kept the data key, re-seal it with the new password.
  const deviceKey = await loadDeviceDek(uid);
  if (deviceKey && (await opens(data?.enc, deviceKey))) {
    await setDoc(userDoc(uid), { keyWrap: await wrapDek(deviceKey, password) }, { merge: true });
    setCurrent({ uid, key: deviceKey });
    return { dataReset: false };
  }

  // No copy of the old key anywhere — the old data is unreadable. Start fresh,
  // keeping Pro status (server-owned, never encrypted).
  const fresh = await generateKey();
  const expenses = await getDocs(expensesCollection(uid));
  const batch = writeBatch(getFirestore());
  expenses.docs.forEach((d) => batch.delete(d.ref));
  batch.set(userDoc(uid), { keyWrap: await wrapDek(fresh, password), enc: deleteField(), onboarded: false }, { merge: true });
  await batch.commit();
  await saveDeviceDek(uid, fresh);
  setCurrent({ uid, key: fresh });
  return { dataReset: true };
}
