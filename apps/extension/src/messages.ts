/** Typed message protocol between content script / popup / options and the background SW. */
import type {
  Controls,
  MemoryDelta,
  NormalizedMessage,
  SuggestMode,
  SuggestTrigger,
  Tweak,
} from '@wingman/core';
import type { SuggestEvent } from '@wingman/api-client';

export const SUGGEST_PORT = 'suggest';

export interface ChatLite {
  chatKey: string;
  platform: string;
  title: string;
  isGroup: boolean;
}

export type Request =
  | { type: 'secret.get' }
  | { type: 'chat.upsert'; chat: ChatLite }
  | { type: 'messages.add'; chatKey: string; messages: NormalizedMessage[] }
  | { type: 'memory.applyDelta'; chatKey: string; delta: MemoryDelta }
  | { type: 'chat.forget'; chatKey: string }
  | { type: 'auth.status' }
  | { type: 'auth.devLogin'; email: string }
  | { type: 'auth.google' }
  | { type: 'auth.signIn' }
  | { type: 'auth.signOut' }
  | { type: 'store.wipeAll' };

export interface AuthStatus {
  signedIn: boolean;
  email: string | null;
  apiUrl: string;
  devLogin: boolean;
  googleEnabled: boolean;
}

export interface ReplyMap {
  'secret.get': { secret: string };
  'chat.upsert': null;
  'messages.add': { added: number };
  'memory.applyDelta': null;
  'chat.forget': null;
  'auth.status': AuthStatus;
  'auth.devLogin': AuthStatus;
  'auth.google': AuthStatus;
  'auth.signIn': { opened: 'popup' | 'google' };
  'auth.signOut': AuthStatus;
  'store.wipeAll': null;
}

export type Reply<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface SuggestPortRequest {
  chatKey: string;
  mode: SuggestMode;
  trigger: SuggestTrigger;
  controls: Controls;
  directive?: string;
  draft?: string;
  avoid?: string[];
  tweak?: Tweak;
}

/** Same as the API events, but `error` also carries client-side codes such as auth_required. */
export type PortEvent =
  | Exclude<SuggestEvent, { event: 'error' }>
  | { event: 'error'; data: { code: string; message: string } };

export const REQUEST_TYPES: ReadonlySet<string> = new Set<Request['type']>([
  'secret.get',
  'chat.upsert',
  'messages.add',
  'memory.applyDelta',
  'chat.forget',
  'auth.status',
  'auth.devLogin',
  'auth.google',
  'auth.signIn',
  'auth.signOut',
  'store.wipeAll',
]);

export function isRequest(m: unknown): m is Request {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as { type?: unknown }).type === 'string' &&
    REQUEST_TYPES.has((m as { type: string }).type)
  );
}

export const STORAGE_KEYS = {
  accessToken: 'accessToken', // chrome.storage.session
  refreshToken: 'refreshToken', // chrome.storage.local
  email: 'authEmail',
  installSecret: 'installSecret',
  debugPanel: 'debugPanel',
} as const;
