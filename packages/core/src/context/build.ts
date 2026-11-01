/** Builds the POST /v1/suggest body (docs/03-system-design.md §4.1). */
import type { Controls, MessageKind, NormalizedMessage, SuggestMode } from '../model';
import type { ChatMemory, StoredChat } from '../store/types';
import { redact } from './redact';

export type SuggestTrigger = 'incoming_message' | 'button' | 'command' | 'tweak' | 'regenerate';

export const MAX_WINDOW_MESSAGES = 40;
export const MAX_WINDOW_TOKENS = 2500;
export const MIN_WINDOW_MESSAGES = 6;
export const MEMORY_REFRESH_EVERY = 50;

export interface SuggestRequestDraft {
  request_id: string;
  chat: {
    key: string;
    platform: string;
    stage: string | null;
    their_alias: string;
    is_group: boolean;
  };
  mode: SuggestMode;
  trigger: SuggestTrigger;
  controls: Controls;
  directive: string | null;
  draft: string | null;
  avoid: string[];
  tweak: string | null;
  memory: { summary: string; facts: string[]; covered_until: string | null };
  messages: { dir: 'in' | 'out'; kind: MessageKind; text: string; ts: string | null }[];
  client: { app: string; version: string; style_profile_version: number | null };
}

export interface BuildSuggestInput {
  chat: StoredChat;
  messages: NormalizedMessage[];
  memory?: ChatMemory | null;
  mode: SuggestMode;
  trigger: SuggestTrigger;
  controls?: Controls;
  directive?: string | null;
  draft?: string | null;
  avoid?: string[];
  tweak?: string | null;
  client: { app: string; version: string; styleProfileVersion?: number | null };
}

export const estimateTokens = (s: string): number => Math.ceil(s.length / 3.5);

const PLACEHOLDERS: Partial<Record<MessageKind, string>> = {
  image: '[photo]',
  video: '[video]',
  voice: '[voice note]',
  sticker: '[sticker]',
  gif: '[gif]',
  deleted: '[deleted]',
  story_reply: '[story reply]',
  reel_share: '[reel]',
  link: '[link]',
  system: '[system]',
  unknown: '[unsupported message]',
};

function looksLikePhone(s: string): boolean {
  const t = s.trim();
  return /^[+\d][\d\s().-]{5,}$/.test(t) && t.replace(/\D/g, '').length >= 6;
}

export function theirAlias(chat: Pick<StoredChat, 'alias' | 'title'>): string {
  const alias = chat.alias?.trim();
  if (alias) return redact(alias);
  const title = chat.title.trim();
  if (!title || looksLikePhone(title)) return 'them';
  const first = title.split(/\s+/)[0] ?? '';
  return first && !looksLikePhone(first) ? redact(first) : 'them';
}

function messageText(m: NormalizedMessage): string {
  const text = redact(m.text ?? '').trim();
  const ph = PLACEHOLDERS[m.kind];
  if (m.kind === 'text') return text;
  if (!ph) return text;
  if (m.kind === 'deleted') return ph;
  return text ? `${ph} ${text}` : ph;
}

export function selectWindow<T extends { text: string }>(
  msgs: T[],
  opts: { maxMessages?: number; maxTokens?: number; minMessages?: number } = {},
): T[] {
  const maxMessages = opts.maxMessages ?? MAX_WINDOW_MESSAGES;
  const maxTokens = opts.maxTokens ?? MAX_WINDOW_TOKENS;
  const min = opts.minMessages ?? MIN_WINDOW_MESSAGES;
  const picked: T[] = [];
  let tokens = 0;
  for (let i = msgs.length - 1; i >= 0 && picked.length < maxMessages; i--) {
    const m = msgs[i] as T;
    const t = estimateTokens(m.text);
    if (picked.length >= min && tokens + t > maxTokens) break;
    tokens += t;
    picked.push(m);
  }
  return picked.reverse();
}

export function buildSuggestRequest(input: BuildSuggestInput): SuggestRequestDraft {
  const { chat, memory } = input;
  const all = input.messages.map((m) => ({
    dir: m.dir,
    kind: m.kind,
    text: messageText(m),
    ts: m.ts,
  }));
  const messages = selectWindow(all);
  const directive = input.directive?.trim() ? redact(input.directive.trim()) : null;
  const draft = input.draft != null && input.draft !== '' ? redact(input.draft) : null;
  return {
    request_id: crypto.randomUUID(),
    chat: {
      key: chat.chatKey,
      platform: chat.platform,
      stage: chat.stage ?? null,
      their_alias: theirAlias(chat),
      is_group: chat.isGroup,
    },
    mode: input.mode,
    trigger: input.trigger,
    controls: { ...(input.controls ?? {}) },
    directive,
    draft,
    avoid: (input.avoid ?? []).map(redact),
    tweak: input.tweak ?? null,
    memory: {
      summary: memory?.summary ?? '',
      facts: [...(memory?.facts ?? [])],
      covered_until: memory?.coveredUntil ?? null,
    },
    messages,
    client: {
      app: input.client.app,
      version: input.client.version,
      style_profile_version: input.client.styleProfileVersion ?? null,
    },
  };
}

/**
 * True when more than MEMORY_REFRESH_EVERY messages arrived since the memory
 * was last folded, or the caller knows the live window is overflowing the budget
 * while stale memory still leaves uncovered messages outside it.
 */
export function needsMemoryRefresh(
  _memory: ChatMemory | null | undefined,
  messagesSinceCovered: number,
  windowOverflowing = false,
): boolean {
  if (messagesSinceCovered > MEMORY_REFRESH_EVERY) return true;
  return windowOverflowing && messagesSinceCovered > MAX_WINDOW_MESSAGES;
}
