import { addDoc, collection, deleteDoc, doc, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import { decryptJson, encryptJson } from './crypto';
import { getVaultKey } from './vault';

export type ExpenseCategory = 'Food' | 'Transport' | 'Shopping' | 'Bills' | 'Other';

export interface ExpenseEntry {
  id: string;
  amount: number;
  category: ExpenseCategory;
  note: string;
  date: string; // 'YYYY-MM-DD'
}

const expensesCollection = (uid: string) => collection(getFirestore(), 'users', uid, 'expenses');

// Each entry is stored as { enc } only — amount, note and even the date are
// encrypted, so ordering happens client-side after decryption.
export async function addExpense(uid: string, entry: Omit<ExpenseEntry, 'id'>): Promise<void> {
  const key = getVaultKey(uid);
  if (!key) throw new Error("Couldn't save — please log in again.");
  await addDoc(expensesCollection(uid), { enc: await encryptJson(entry, key) });
}

export async function deleteExpense(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(getFirestore(), 'users', uid, 'expenses', id));
}

// Kept as a live subscription (rather than a one-shot load, like the rest of
// AppState) since expenses are their own growing collection the user actively
// adds to while the Expenses screen is open — a one-shot load would miss
// entries added a moment ago until the next remount.
export function subscribeExpenses(uid: string, onChange: (entries: ExpenseEntry[]) => void): () => void {
  // Decryption is async, so a slow batch could resolve after a newer snapshot —
  // only the latest snapshot's result is delivered.
  let latest = 0;
  return onSnapshot(
    expensesCollection(uid),
    async (snap) => {
      const run = ++latest;
      const key = getVaultKey(uid);
      if (!key) return;
      const decrypted = await Promise.all(
        snap.docs.map(async (d) => {
          try {
            const entry = await decryptJson<Omit<ExpenseEntry, 'id'>>(d.data().enc, key);
            return { id: d.id, ...entry };
          } catch {
            return null; // unreadable entry — skip rather than break the list
          }
        })
      );
      if (run !== latest) return;
      const entries = decrypted.filter((e): e is ExpenseEntry => e !== null);
      entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      onChange(entries);
    },
    () => {
      // best-effort — mirrors the silent-fail contract of the rest of firestoreSync
    }
  );
}
