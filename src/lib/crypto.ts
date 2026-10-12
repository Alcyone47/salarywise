import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export type AesKey = Awaited<ReturnType<typeof AESEncryptionKey.generate>>;

// Stored on users/{uid} — the user's data key (DEK), sealed with a key derived
// from their password (KEK). Only the device or the password can open it.
export interface KeyWrap {
  v: 1;
  salt: string; // hex
  iters: number;
  wrapped: string; // base64 AES-GCM combined (iv + ciphertext + tag)
}

// Stored with the wrap so it can be raised later without breaking existing
// users. Pure-JS PBKDF2 on Hermes is slow, so this trades some strength for a
// ~1s login on mid-range Android — re-time on a low-end device before raising.
const PBKDF2_ITERATIONS = 100_000;

const DEK_STORE_KEY = (uid: string) => `salarywise.dek.${uid}`;
const LOCAL_KEY_STORE_KEY = 'salarywise.localKey';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// AESSealedData.fromCombined's Android implementation only accepts bytes —
// a base64 string fails there, so decode it in JS first.
function fromBase64(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

// JSON with every non-ASCII char escaped as \uXXXX is pure ASCII, so it maps
// 1:1 to bytes without relying on TextEncoder/TextDecoder being available.
function jsonToBytes(value: unknown): Uint8Array {
  const ascii = JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const bytes = new Uint8Array(ascii.length);
  for (let i = 0; i < ascii.length; i++) bytes[i] = ascii.charCodeAt(i);
  return bytes;
}

function bytesToJson<T>(bytes: Uint8Array): T {
  let ascii = '';
  for (let i = 0; i < bytes.length; i += 4096) ascii += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return JSON.parse(ascii) as T;
}

export function generateKey(): Promise<AesKey> {
  return AESEncryptionKey.generate();
}

export async function encryptJson(value: unknown, key: AesKey): Promise<string> {
  const sealed = await aesEncryptAsync(jsonToBytes(value), key);
  return (await sealed.combined('base64')) as string;
}

// Throws if the key is wrong or the data was tampered with (GCM tag check).
export async function decryptJson<T>(combined: string, key: AesKey): Promise<T> {
  const bytes = await aesDecryptAsync(AESSealedData.fromCombined(fromBase64(combined)), key, { output: 'bytes' });
  return bytesToJson<T>(bytes);
}

async function deriveKek(password: string, salt: Uint8Array, iters: number): Promise<AesKey> {
  const bytes = await pbkdf2Async(sha256, password, salt, { c: iters, dkLen: 32 });
  return AESEncryptionKey.import(bytes);
}

export async function wrapDek(dek: AesKey, password: string): Promise<KeyWrap> {
  const salt = getRandomBytes(16);
  const kek = await deriveKek(password, salt, PBKDF2_ITERATIONS);
  const sealed = await aesEncryptAsync(await dek.bytes(), kek);
  return { v: 1, salt: toHex(salt), iters: PBKDF2_ITERATIONS, wrapped: (await sealed.combined('base64')) as string };
}

// Encrypts and decrypts a random probe through the same path stored data takes,
// so a failure to open real data can be blamed on the key, not on this device.
async function assertRoundTrip(key: AesKey): Promise<void> {
  const probe = getRandomBytes(16);
  const sealed = await aesEncryptAsync(probe, key);
  const combined = (await sealed.combined('base64')) as string;
  const back = await aesDecryptAsync(AESSealedData.fromCombined(fromBase64(combined)), key, { output: 'bytes' });
  if (back.length !== probe.length || back.some((b, i) => b !== probe[i])) {
    throw new Error('Encryption self-test failed.');
  }
}

// Returns null only when the password provably doesn't open the wrap — after a
// password reset, the wrap is still sealed with the old password. Any other
// failure throws, since callers clear data on null.
export async function unwrapDek(wrap: KeyWrap, password: string): Promise<AesKey | null> {
  const kek = await deriveKek(password, fromHex(wrap.salt), wrap.iters);
  const sealed = AESSealedData.fromCombined(fromBase64(wrap.wrapped));
  let bytes: Uint8Array;
  try {
    bytes = await aesDecryptAsync(sealed, kek, { output: 'bytes' });
  } catch {
    // A wrong password and a broken crypto path both fail here — the round
    // trip tells them apart (and rethrows for the latter).
    await assertRoundTrip(kek);
    return null;
  }
  return AESEncryptionKey.import(bytes);
}

export async function loadDeviceDek(uid: string): Promise<AesKey | null> {
  try {
    const hex = await SecureStore.getItemAsync(DEK_STORE_KEY(uid));
    return hex ? await AESEncryptionKey.import(hex, 'hex') : null;
  } catch {
    return null;
  }
}

export async function saveDeviceDek(uid: string, dek: AesKey): Promise<void> {
  await SecureStore.setItemAsync(DEK_STORE_KEY(uid), await dek.encoded('hex'));
}

export async function deleteDeviceDek(uid: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(DEK_STORE_KEY(uid));
  } catch {
    // best-effort
  }
}

// Separate per-device key for the AsyncStorage copy — it exists before the
// user signs in, so it can't be the account's DEK.
// Memoized so concurrent first calls can't each generate (and store) a different key.
let localKeyPromise: Promise<AesKey> | null = null;

export function getLocalKey(): Promise<AesKey> {
  localKeyPromise ??= (async () => {
    const hex = await SecureStore.getItemAsync(LOCAL_KEY_STORE_KEY);
    if (hex) return AESEncryptionKey.import(hex, 'hex');
    const key = await generateKey();
    await SecureStore.setItemAsync(LOCAL_KEY_STORE_KEY, await key.encoded('hex'));
    return key;
  })().catch((err) => {
    localKeyPromise = null;
    throw err;
  });
  return localKeyPromise;
}
