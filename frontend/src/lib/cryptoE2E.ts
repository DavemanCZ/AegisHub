/**
 * E2E šifrování pro DM zprávy pomocí ECDH P-256 + AES-256-GCM.
 * Stejný princip jako Matrix/Signal.
 */

import { importKey } from './crypto';

// ─── Typy ────────────────────────────────────────────────────────────────────

export interface ECDHKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJWK: JsonWebKey;
}

export interface EncryptedMsg {
  enc: 1;
  ct: string;  // hex ciphertext
  n: string;   // hex nonce
  type?: 'text' | 'file';
  file_id?: string;
  name?: string;
  mime?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): ArrayBuffer {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
}

// ─── Generování a načítání klíčů ─────────────────────────────────────────────

/** Generuje nový ECDH P-256 klíčový pár. */
export async function generateECDHKeyPair(): Promise<ECDHKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const publicKeyJWK = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicKeyJWK };
}

/** Serializuje klíčový pár do JSON pro uložení. */
export async function exportKeyPair(pair: ECDHKeyPair): Promise<string> {
  const privateJWK = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return JSON.stringify({ priv: privateJWK, pub: pair.publicKeyJWK });
}

/** Deserializuje klíčový pár z JSON. */
export async function importKeyPair(json: string): Promise<ECDHKeyPair> {
  const { priv, pub } = JSON.parse(json);
  const privateKey = await crypto.subtle.importKey('jwk', priv, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const publicKey = await crypto.subtle.importKey('jwk', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey, publicKeyJWK: pub };
}

/** Importuje cizí veřejný klíč ze JWK stringu. */
export async function importPublicKeyJWK(jwkStr: string): Promise<CryptoKey> {
  const jwk = typeof jwkStr === 'string' ? JSON.parse(jwkStr) : jwkStr;
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

// ─── Sdílený klíč ────────────────────────────────────────────────────────────

/** Odvodí sdílený AES-GCM klíč z ECDH. */
export async function deriveSharedKey(myPrivateKey: CryptoKey, theirPublicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Šifrování/dešifrování zpráv ─────────────────────────────────────────────

/** Zašifruje textovou zprávu sdíleným klíčem. */
export async function encryptMessage(sharedKey: CryptoKey, content: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer.slice(0) as ArrayBuffer },
    sharedKey,
    enc.encode(content)
  );
  const msg: EncryptedMsg = { enc: 1, ct: bufToHex(ct), n: bufToHex(nonce) };
  return JSON.stringify(msg);
}

/** Dešifruje zprávu sdíleným klíčem. Vrátí plaintext nebo původní content pokud není šifrovaný. */
export async function decryptMessage(sharedKey: CryptoKey, content: string): Promise<string> {
  let parsed: EncryptedMsg;
  try {
    parsed = JSON.parse(content);
    if (parsed.enc !== 1) return content;
  } catch { return content; }

  const dec = new TextDecoder();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBuf(parsed.n) },
      sharedKey,
      hexToBuf(parsed.ct)
    );
    return dec.decode(plain);
  } catch {
    return '🔒 [Nelze dešifrovat]';
  }
}

/** Vrátí true pokud je obsah šifrovaný. */
export function isEncrypted(content: string): boolean {
  try { const p = JSON.parse(content); return p.enc === 1; } catch { return false; }
}

/** Vrátí true pokud je šifrovaná zpráva souborová příloha. */
export function isFileMessage(content: string): boolean {
  try { const p = JSON.parse(content); return p.enc === 1 && p.type === 'file'; } catch { return false; }
}

/** Vytvoří zprávu o souboru (šifruje metadata). */
export async function encryptFileMessage(sharedKey: CryptoKey, fileId: string, name: string, mime: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const meta = JSON.stringify({ name, mime });
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer.slice(0) as ArrayBuffer },
    sharedKey,
    enc.encode(meta)
  );
  const msg: EncryptedMsg = { enc: 1, type: 'file', file_id: fileId, ct: bufToHex(ct), n: bufToHex(nonce) };
  return JSON.stringify(msg);
}

/** Dešifruje metadata souboru ze zprávy. */
export async function decryptFileMessage(sharedKey: CryptoKey, content: string): Promise<{ name: string; mime: string; file_id: string } | null> {
  try {
    const parsed: EncryptedMsg = JSON.parse(content);
    if (parsed.enc !== 1 || parsed.type !== 'file' || !parsed.file_id) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBuf(parsed.n) },
      sharedKey,
      hexToBuf(parsed.ct)
    );
    const meta = JSON.parse(new TextDecoder().decode(plain));
    return { ...meta, file_id: parsed.file_id };
  } catch { return null; }
}

// ─── Správa klíčů přes Vault ─────────────────────────────────────────────────

/** Uloží klíčový pár šifrovaně jako aegis.ecdh_key objekt. */
export async function saveKeyPairToVault(
  vaultKeyRaw: Uint8Array,
  jwtToken: string,
  pair: ECDHKeyPair
): Promise<void> {
  const { saveObject } = await import('./api');
  const { encryptData } = await import('./crypto');
  const vk = await importKey(vaultKeyRaw);
  const serialized = await exportKeyPair(pair);
  const { ciphertext, nonce } = await encryptData(vk, serialized);
  await saveObject(jwtToken, { type: 'aegis.ecdh_key', version: 1, ciphertext, nonce });
}

/** Načte nebo vygeneruje klíčový pár ze Vaultu. */
export async function loadOrCreateKeyPair(
  vaultKeyRaw: Uint8Array,
  jwtToken: string
): Promise<ECDHKeyPair> {
  const { fetchObjects, saveObject } = await import('./api');
  const { encryptData, decryptData } = await import('./crypto');

  const vk = await importKey(vaultKeyRaw);
  const objects = await fetchObjects(jwtToken);
  const ecdhObj = objects.find(o => o.type === 'aegis.ecdh_key');

  if (ecdhObj) {
    const json = await decryptData(vk, ecdhObj.ciphertext, ecdhObj.nonce);
    return importKeyPair(json);
  }

  // Generujeme nový pár
  const pair = await generateECDHKeyPair();
  const serialized = await exportKeyPair(pair);
  const { ciphertext, nonce } = await encryptData(vk, serialized);
  await saveObject(jwtToken, { type: 'aegis.ecdh_key', version: 1, ciphertext, nonce });
  return pair;
}

/** Nahraje veřejný klíč na server. */
export async function uploadPublicKey(jwtToken: string, publicKeyJWK: JsonWebKey): Promise<void> {
  await fetch('/api/users/pubkeys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwtToken },
    body: JSON.stringify({ public_key_jwk: JSON.stringify(publicKeyJWK) })
  });
}

/** Načte veřejné klíče všech uživatelů. */
export async function fetchPublicKeys(jwtToken: string): Promise<Record<string, CryptoKey>> {
  const res = await fetch('/api/users/pubkeys', {
    headers: { 'Authorization': 'Bearer ' + jwtToken }
  });
  if (!res.ok) return {};
  const list: { user_id: string; username: string; public_key_jwk: string }[] = await res.json();
  const result: Record<string, CryptoKey> = {};
  for (const u of list) {
    if (!u.public_key_jwk) continue;
    try {
      result[u.user_id] = await importPublicKeyJWK(u.public_key_jwk);
    } catch { /* skip */ }
  }
  return result;
}

/** Šifruje soubor sdíleným klíčem, vrátí blob a nonce hex. */
export async function encryptFileWithKey(sharedKey: CryptoKey, data: ArrayBuffer): Promise<{ blob: Blob; nonceHex: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer.slice(0) as ArrayBuffer },
    sharedKey,
    data
  );
  return { blob: new Blob([ct], { type: 'application/octet-stream' }), nonceHex: bufToHex(nonce) };
}

/** Dešifruje soubor sdíleným klíčem. */
export async function decryptFileWithKey(sharedKey: CryptoKey, data: ArrayBuffer, nonceHex: string): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBuf(nonceHex) },
    sharedKey,
    data
  );
}
