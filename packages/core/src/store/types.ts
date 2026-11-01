/** Platform-neutral local conversation store (docs/03-system-design.md §2.4). */
import type { Controls, NormalizedMessage, PlatformId, Stage } from '../model';

export interface StoredChat {
  chatKey: string;
  platform: PlatformId;
  title: string;
  alias?: string;
  isGroup: boolean;
  stage?: Stage;
  settings?: Controls;
  firstSeenAt: string;
  lastMsgAt: string;
}

export interface ChatMemory {
  summary: string;
  facts: string[];
  /** ISO timestamp up to which messages are folded into the summary. */
  coveredUntil: string | null;
  version: number;
}

export interface MemoryDelta {
  facts_add?: string[];
}

export interface SuggestionLogEntry {
  requestId: string;
  chatKey: string;
  cards: unknown[];
  controls?: Controls;
  createdAt: string;
  insertedCardId?: string;
  sentMessageId?: string;
}

export interface FeedbackEvent {
  type: string;
  requestId?: string;
  ts: string;
  payload?: Record<string, unknown>;
}

export interface QueuedFeedback {
  id: number;
  event: FeedbackEvent;
}

export const MAX_FACTS = 20;
export const MAX_MESSAGES_PER_CHAT = 20_000;

export interface ConversationStore {
  upsertChat(chat: StoredChat): Promise<void>;
  getChat(chatKey: string): Promise<StoredChat | undefined>;
  listChats(): Promise<StoredChat[]>;
  /** Idempotent by [chatKey + id]; existing messages are left untouched. */
  addMessages(msgs: NormalizedMessage[]): Promise<void>;
  /** Oldest to newest. */
  getRecentMessages(chatKey: string, limit: number): Promise<NormalizedMessage[]>;
  /** Number of messages with ts strictly after `ts`. */
  countMessagesSince(chatKey: string, ts: string | null): Promise<number>;
  getMemory(chatKey: string): Promise<ChatMemory | undefined>;
  setMemory(chatKey: string, memory: ChatMemory): Promise<void>;
  /** Appends facts (deduped, case-insensitive), keeping the newest MAX_FACTS. */
  applyMemoryDelta(chatKey: string, delta: MemoryDelta): Promise<ChatMemory>;
  logSuggestion(entry: SuggestionLogEntry): Promise<void>;
  queueFeedback(event: FeedbackEvent): Promise<void>;
  /** Removes and returns up to `max` queued events, oldest first. */
  drainFeedback(max: number): Promise<FeedbackEvent[]>;
  /** Deletes chat, messages, memory and suggestion logs. */
  forgetChat(chatKey: string): Promise<void>;
  wipeAll(): Promise<void>;
}

/** Merge facts: trim, drop empties, dedupe case-insensitively, keep newest MAX_FACTS. */
export function mergeFacts(existing: string[], add: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...existing, ...add]) {
    const t = f.trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(-MAX_FACTS);
}
