/** Thin typed wrappers over chrome.runtime for the content script. */
import type { PortLike } from '../background/core';
import { SUGGEST_PORT, type Reply, type ReplyMap, type Request } from '../messages';

export async function send<R extends Request>(msg: R): Promise<Reply<ReplyMap[R['type']]>> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as Reply<ReplyMap[R['type']]>;
  } catch (e) {
    return {
      ok: false,
      error: { code: 'extension', message: e instanceof Error ? e.message : String(e) },
    };
  }
}

export function connectSuggest(): PortLike & { disconnect(): void } {
  return chrome.runtime.connect({ name: SUGGEST_PORT });
}

export function decodeSecret(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
