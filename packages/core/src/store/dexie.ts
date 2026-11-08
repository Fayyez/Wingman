/** Dexie (IndexedDB) implementation of ConversationStore (03 §2.4). */
import Dexie, { type Table } from 'dexie';
import type { NormalizedMessage } from '../model';
import { createKey, decrypt, encrypt, type EncryptedBlob } from './crypto';
import {
  MAX_MESSAGES_PER_CHAT,
  mergeFacts,
  type ChatMemory,
  type ConversationStore,
  type FeedbackEvent,
  type MemoryDelta,
  type StoredChat,
  type SuggestionLogEntry,
} from './types';

export interface KeyProvider {
  getOrCreateKey(): Promise<CryptoKey>;
}

export class InMemoryKeyProvider implements KeyProvider {
  private key?: Promise<CryptoKey>;
  getOrCreateKey(): Promise<CryptoKey> {
    return (this.key ??= createKey());
  }
}

interface MessageRow {
  chatKey: string;
  id: string;
  dir: NormalizedMessage['dir'];
  kind: NormalizedMessage['kind'];
  enc_text: EncryptedBlob;
  ts: string | null;
  /** ts, or the chat's latest sortTs for messages without one. */
  sortTs: string;
  seq: number;
  sender?: string;
  replyToId?: string;
  reactions?: string[];
  meta?: NormalizedMessage['meta'];
}

interface MemoryRow {
  chatKey: string;
  enc_summary: EncryptedBlob;
  enc_facts: EncryptedBlob;
  coveredUntil: string | null;
  version: number;
}

interface FeedbackRow {
  id?: number;
  event: FeedbackEvent;
}

interface KvRow {
  key: string;
  value: unknown;
}

// Explicit bounds: Dexie.maxKey varies by environment and can be rejected by some IDB implementations.
const MIN_KEY = -Infinity;
const MAX_KEY = '\uffff';
const KEY_NAME = 'encKey';

/** Persists a non-extractable CryptoKey in the db's kv table (structured clone). */
export class IndexedDbKeyProvider implements KeyProvider {
  private pending?: Promise<CryptoKey>;
  constructor(private readonly kv: () => Table<KvRow, string>) {}
  getOrCreateKey(): Promise<CryptoKey> {
    return (this.pending ??= (async () => {
      const row = await this.kv().get(KEY_NAME);
      if (row?.value) return row.value as CryptoKey;
      const key = await createKey();
      await this.kv().put({ key: KEY_NAME, value: key });
      return key;
    })());
  }
}

let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter++ % 1000);

export class DexieConversationStore implements ConversationStore {
  private readonly db: Dexie;
  private readonly chats: Table<StoredChat, string>;
  private readonly messages: Table<MessageRow, [string, string]>;
  private readonly memory: Table<MemoryRow, string>;
  private readonly suggestionLog: Table<SuggestionLogEntry, string>;
  private readonly feedback: Table<FeedbackRow, number>;
  private readonly kv: Table<KvRow, string>;
  private readonly keys: KeyProvider;

  constructor(dbName: string, keyProvider?: KeyProvider) {
    this.db = new Dexie(dbName);
    this.db.version(1).stores({
      chats: 'chatKey, lastMsgAt',
      messages: '[chatKey+id], [chatKey+sortTs+seq]',
      memory: 'chatKey',
      suggestion_log: 'requestId, chatKey',
      feedback_queue: '++id',
      kv: 'key',
    });
    this.chats = this.db.table('chats');
    this.messages = this.db.table('messages');
    this.memory = this.db.table('memory');
    this.suggestionLog = this.db.table('suggestion_log');
    this.feedback = this.db.table('feedback_queue');
    this.kv = this.db.table('kv');
    this.keys = keyProvider ?? new IndexedDbKeyProvider(() => this.kv);
  }

  close(): void {
    this.db.close();
  }

  async upsertChat(chat: StoredChat): Promise<void> {
    await this.chats.put({ ...chat });
  }

  getChat(chatKey: string): Promise<StoredChat | undefined> {
    return this.chats.get(chatKey);
  }

  listChats(): Promise<StoredChat[]> {
    return this.chats.toArray();
  }

  async addMessages(msgs: NormalizedMessage[]): Promise<void> {
    if (msgs.length === 0) return;
    const key = await this.keys.getOrCreateKey();
    // Encrypt outside the transaction (WebCrypto promises would auto-commit it).
    const encrypted = await Promise.all(msgs.map((m) => encrypt(key, m.text)));
    await this.db.transaction('rw', this.messages, async () => {
      const existing = await this.messages.bulkGet(
        msgs.map((m) => [m.chatKey, m.id] as [string, string]),
      );
      const latest = new Map<string, string>();
      const rows: MessageRow[] = [];
      const touched = new Set<string>();
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i] as NormalizedMessage;
        if (existing[i]) continue;
        if (!latest.has(m.chatKey)) {
          const last = await this.messages
            .where('[chatKey+sortTs+seq]')
            .between([m.chatKey, MIN_KEY, MIN_KEY], [m.chatKey, MAX_KEY, MAX_KEY])
            .last();
          latest.set(m.chatKey, last?.sortTs ?? '');
        }
        const sortTs = m.ts ?? latest.get(m.chatKey) ?? '';
        const row: MessageRow = {
          chatKey: m.chatKey,
          id: m.id,
          dir: m.dir,
          kind: m.kind,
          enc_text: encrypted[i] as EncryptedBlob,
          ts: m.ts,
          sortTs,
          seq: nextSeq(),
        };
        if (m.sender !== undefined) row.sender = m.sender;
        if (m.replyToId !== undefined) row.replyToId = m.replyToId;
        if (m.reactions !== undefined) row.reactions = m.reactions;
        if (m.meta !== undefined) row.meta = m.meta;
        if (sortTs > (latest.get(m.chatKey) ?? '')) latest.set(m.chatKey, sortTs);
        rows.push(row);
        existing[i] = row; // dedupe within the batch
        touched.add(m.chatKey);
      }
      if (rows.length) await this.messages.bulkAdd(rows);
      for (const ck of touched) {
        const over =
          (await this.messages
            .where('[chatKey+sortTs+seq]')
            .between([ck, MIN_KEY, MIN_KEY], [ck, MAX_KEY, MAX_KEY])
            .count()) - MAX_MESSAGES_PER_CHAT;
        if (over > 0) {
          const old = await this.messages
            .where('[chatKey+sortTs+seq]')
            .between([ck, MIN_KEY, MIN_KEY], [ck, MAX_KEY, MAX_KEY])
            .limit(over)
            .primaryKeys();
          await this.messages.bulkDelete(old);
        }
      }
    });
  }

  async getRecentMessages(chatKey: string, limit: number): Promise<NormalizedMessage[]> {
    const rows = await this.messages
      .where('[chatKey+sortTs+seq]')
      .between([chatKey, MIN_KEY, MIN_KEY], [chatKey, MAX_KEY, MAX_KEY])
      .reverse()
      .limit(limit)
      .toArray();
    if (rows.length === 0) return [];
    const key = await this.keys.getOrCreateKey();
    const out = await Promise.all(
      rows.map(async (r): Promise<NormalizedMessage> => {
        const m: NormalizedMessage = {
          id: r.id,
          chatKey: r.chatKey,
          dir: r.dir,
          kind: r.kind,
          text: await decrypt(key, r.enc_text),
          ts: r.ts,
        };
        if (r.sender !== undefined) m.sender = r.sender;
        if (r.replyToId !== undefined) m.replyToId = r.replyToId;
        if (r.reactions !== undefined) m.reactions = r.reactions;
        if (r.meta !== undefined) m.meta = r.meta;
        return m;
      }),
    );
    return out.reverse();
  }

  countMessagesSince(chatKey: string, ts: string | null): Promise<number> {
    const lower = ts ?? '';
    const c = this.messages
      .where('[chatKey+sortTs+seq]')
      .between([chatKey, lower, MAX_KEY], [chatKey, MAX_KEY, MAX_KEY], false, true);
    return c.count();
  }

  async getMemory(chatKey: string): Promise<ChatMemory | undefined> {
    const row = await this.memory.get(chatKey);
    if (!row) return undefined;
    const key = await this.keys.getOrCreateKey();
    return {
      summary: await decrypt(key, row.enc_summary),
      facts: JSON.parse(await decrypt(key, row.enc_facts)) as string[],
      coveredUntil: row.coveredUntil,
      version: row.version,
    };
  }

  async setMemory(chatKey: string, memory: ChatMemory): Promise<void> {
    const key = await this.keys.getOrCreateKey();
    const [enc_summary, enc_facts] = await Promise.all([
      encrypt(key, memory.summary),
      encrypt(key, JSON.stringify(memory.facts)),
    ]);
    await this.memory.put({
      chatKey,
      enc_summary,
      enc_facts,
      coveredUntil: memory.coveredUntil,
      version: memory.version,
    });
  }

  async applyMemoryDelta(chatKey: string, delta: MemoryDelta): Promise<ChatMemory> {
    const cur = (await this.getMemory(chatKey)) ?? {
      summary: '',
      facts: [],
      coveredUntil: null,
      version: 0,
    };
    const next: ChatMemory = { ...cur, facts: mergeFacts(cur.facts, delta.facts_add ?? []) };
    await this.setMemory(chatKey, next);
    return next;
  }

  async logSuggestion(entry: SuggestionLogEntry): Promise<void> {
    await this.suggestionLog.put(entry);
  }

  async queueFeedback(event: FeedbackEvent): Promise<void> {
    await this.feedback.add({ event });
  }

  async drainFeedback(max: number): Promise<FeedbackEvent[]> {
    return this.db.transaction('rw', this.feedback, async () => {
      const rows = await this.feedback.orderBy('id').limit(max).toArray();
      await this.feedback.bulkDelete(rows.map((r) => r.id as number));
      return rows.map((r) => r.event);
    });
  }

  async forgetChat(chatKey: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.chats, this.messages, this.memory, this.suggestionLog],
      async () => {
        await this.chats.delete(chatKey);
        await this.messages
          .where('[chatKey+id]')
          .between([chatKey, MIN_KEY], [chatKey, MAX_KEY])
          .delete();
        await this.memory.delete(chatKey);
        await this.suggestionLog.where('chatKey').equals(chatKey).delete();
      },
    );
  }

  async wipeAll(): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.chats, this.messages, this.memory, this.suggestionLog, this.feedback, this.kv],
      async () => {
        await Promise.all([
          this.chats.clear(),
          this.messages.clear(),
          this.memory.clear(),
          this.suggestionLog.clear(),
          this.feedback.clear(),
          this.kv.where('key').notEqual(KEY_NAME).delete(), // keep the cached encryption key valid
        ]);
      },
    );
  }
}
