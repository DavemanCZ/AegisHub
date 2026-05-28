/**
 * Aegis Crypto Utils (Web Crypto API)
 *
 * Zabezpečuje šifrování a dešifrování dat (AES-256-GCM) a odvozování klíčů.
 * V této fázi definujeme rozhraní.
 */
import { argon2id } from 'hash-wasm';


const ALGO_NAME = 'AES-GCM';
const KEY_LENGTH = 256;

/**
 * Generuje nový náhodný šifrovací klíč pro daný objekt.
 */
export async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: ALGO_NAME, length: KEY_LENGTH },
    true, // extractable (aby mohl být zabalen pomocí Vault Key)
    ['encrypt', 'decrypt']
  );
}

/**
 * Zašifruje data pomocí předaného klíče.
 * Vrací { ciphertext, nonce }
 */
export async function encryptData(key: CryptoKey, data: string): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(data);
  const nonce = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce pro AES-GCM

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: ALGO_NAME, iv: nonce as BufferSource },
    key,
    encodedData as BufferSource
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    nonce
  };
}

/**
 * Dešifruje data pomocí předaného klíče a nonce.
 */
export async function decryptData(key: CryptoKey, ciphertext: Uint8Array, nonce: Uint8Array): Promise<string> {
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGO_NAME, iv: nonce as BufferSource },
    key,
    ciphertext as BufferSource
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Odvodí Master Key (MK) z Master Password a Salt pomocí Argon2id.
 *
 * @param password Uživatelské heslo
 * @param salt Sůl (unikátní pro každého uživatele, např. 16 bajtů)
 * @returns Master Key jako Uint8Array
 */
export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const hash = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 64 * 1024, // 64 MB RAM
    hashLength: 32, // 256-bit klíč pro AES
    outputType: 'binary'
  });
  return hash;
}

/**
 * Hashování Master Key pro získání AuthToken (SHA-256).
 * AuthToken je odesílán na server k ověření.
 */
export async function hashAuthToken(masterKey: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', masterKey as BufferSource);
  return new Uint8Array(hashBuffer);
}

/**
 * Exportuje klíč do raw Uint8Array formátu.
 */
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(exported);
}

/**
 * Importuje raw Uint8Array klíč pro použití v AES-GCM.
 */
export async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: ALGO_NAME },
    false, // Nechceme, aby šel znovu exportovat, pokud to není nutné
    ['encrypt', 'decrypt']
  );
}

/**
 * Zašifruje VaultKey (raw) pomocí MasterKey (raw).
 * Jelikož MasterKey pochází z KDF, nejprve ho importujeme.
 * Vrací ciphertext, ve kterém je obsažena i nonce (prvních 12 bajtů).
 */
export async function encryptVaultKey(masterKeyRaw: Uint8Array, vaultKeyRaw: Uint8Array): Promise<Uint8Array> {
  const mk = await crypto.subtle.importKey('raw', masterKeyRaw as BufferSource, { name: ALGO_NAME }, false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: ALGO_NAME, iv: nonce as BufferSource },
    mk,
    vaultKeyRaw as BufferSource
  );
  
  // Připojíme nonce na začátek ciphertextu
  const ciphertext = new Uint8Array(ciphertextBuffer);
  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  
  return result;
}

/**
 * Dešifruje VaultKey (raw) pomocí MasterKey (raw).
 */
export async function decryptVaultKey(masterKeyRaw: Uint8Array, encryptedVaultKey: Uint8Array): Promise<Uint8Array> {
  const mk = await crypto.subtle.importKey('raw', masterKeyRaw as BufferSource, { name: ALGO_NAME }, false, ['decrypt']);
  const nonce = encryptedVaultKey.slice(0, 12);
  const ciphertext = encryptedVaultKey.slice(12);
  
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGO_NAME, iv: nonce as BufferSource },
    mk,
    ciphertext as BufferSource
  );
  
  return new Uint8Array(decryptedBuffer);
}
