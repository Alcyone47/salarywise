import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { decryptJson, encryptJson, getLocalKey } from './crypto';
import { NON_PERSISTED_KEYS, type AppState } from './types';

const STORAGE_KEY = 'salarywise:state';
const ENCRYPTED_PREFIX = 'enc1:';

// expo-secure-store has no web implementation, so the web build (which also
// skips Firestore sync) keeps its local copy unencrypted.
const ENCRYPT_LOCAL = Platform.OS !== 'web';

export async function loadState(): Promise<Partial<AppState> | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Copies written before encryption shipped are plain JSON — read them once;
    // the next save re-writes them encrypted.
    const parsed = raw.startsWith(ENCRYPTED_PREFIX)
      ? await decryptJson<Partial<AppState>>(raw.slice(ENCRYPTED_PREFIX.length), await getLocalKey())
      : (JSON.parse(raw) as Partial<AppState>);
    for (const key of NON_PERSISTED_KEYS) delete parsed[key];
    return parsed;
  } catch {
    return null;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    const toSave: Partial<AppState> = { ...state };
    for (const key of NON_PERSISTED_KEYS) delete toSave[key];
    const value = ENCRYPT_LOCAL ? ENCRYPTED_PREFIX + (await encryptJson(toSave, await getLocalKey())) : JSON.stringify(toSave);
    await AsyncStorage.setItem(STORAGE_KEY, value);
  } catch {
    // best-effort persistence — ignore write failures
  }
}

export async function clearState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort — ignore failures
  }
}
