/** AES-GCM text encryption on WebCrypto (browsers, Node >= 20). */

export interface EncryptedBlob {
  iv: Uint8Array;
  ct: Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function createKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey, text: string): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv, ct: new Uint8Array(ct) };
}

export async function decrypt(key: CryptoKey, blob: EncryptedBlob): Promise<string> {
  const iv = new Uint8Array(blob.iv);
  const ct = new Uint8Array(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}
