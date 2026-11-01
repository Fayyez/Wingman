/**
 * chatKey = HMAC-SHA256(installSecret, `${platform}:${platformChatId}`), hex, truncated.
 * The server only ever sees this key, never the platform id / phone number (03 §14).
 * Synchronous so adapters can compute it inline.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { PlatformId } from './model';

export type ChatKeyFn = (platform: PlatformId, platformChatId: string) => string;

export function makeChatKeyFn(installSecret: Uint8Array): ChatKeyFn {
  if (installSecret.length < 16) throw new Error('installSecret must be >= 16 bytes');
  return (platform, platformChatId) =>
    'ck_' +
    bytesToHex(hmac(sha256, installSecret, utf8ToBytes(`${platform}:${platformChatId}`))).slice(0, 32);
}
