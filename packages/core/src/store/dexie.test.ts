import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedMessage } from '../model';
import { decrypt, encrypt, createKey } from './crypto';
import { DexieConversationStore, InMemoryKeyProvider } from './dexie';
import type { StoredChat } from './types';

let n = 0;
const chat = (chatKey: string): StoredChat => ({
  chatKey,
  platform: 'whatsapp_web',
  title: 'Ayesha Khan',
  isGroup: false,
  firstSeenAt: '2026-11-01T00:00:00Z',
  lastMsgAt: '2026-11-01T00:00:00Z',
});
const msg = (chatKey: string, id: string, ts: string | null, text = `m${id}`): NormalizedMessage => ({
  id,
  chatKey,
  dir: 'in',
  kind: 'text',
  text,
  ts,
});

describe('crypto', () => {
  it('roundtrips and uses fresh IVs', async () => {
    const key = await createKey();
    const a = await encrypt(key, 'thak gai hun yaar');
    const b = await encrypt(key, 'thak gai hun yaar');
    expect(a.iv).toHaveLength(12);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(await decrypt(key, a)).toBe('thak gai hun yaar');
    await expect(decrypt(await createKey(), a)).rejects.toThrow();
  });
});

describe('DexieConversationStore', () => {
  let store: DexieConversationStore;
  beforeEach(() => {
    store = new DexieConversationStore(`test-${n++}`, new InMemoryKeyProvider());
  });

  it('upserts and lists chats', async () => {
    await store.upsertChat(chat('a'));
    await store.upsertChat({ ...chat('a'), alias: 'Aya' });
    await store.upsertChat(chat('b'));
    expect((await store.getChat('a'))?.alias).toBe('Aya');
    expect(await store.listChats()).toHaveLength(2);
    expect(await store.getChat('zzz')).toBeUndefined();
  });

  it('adds messages idempotently and returns oldest->newest', async () => {
    await store.addMessages([msg('a', '1', '2026-11-01T10:00:00Z'), msg('a', '2', '2026-11-01T10:01:00Z')]);
    await store.addMessages([msg('a', '2', '2026-11-01T10:01:00Z', 'changed'), msg('a', '3', '2026-11-01T10:02:00Z')]);
    const all = await store.getRecentMessages('a', 10);
    expect(all.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(all[1]?.text).toBe('m2');
    expect((await store.getRecentMessages('a', 2)).map((m) => m.id)).toEqual(['2', '3']);
  });

  it('orders by ts even if inserted out of order', async () => {
    await store.addMessages([msg('a', 'late', '2026-11-01T10:05:00Z')]);
    await store.addMessages([msg('a', 'early', '2026-11-01T10:00:00Z')]);
    expect((await store.getRecentMessages('a', 10)).map((m) => m.id)).toEqual(['early', 'late']);
  });

  it('handles null timestamps and isolates chats', async () => {
    await store.addMessages([msg('a', '1', '2026-11-01T10:00:00Z'), msg('a', '2', null), msg('b', '9', null)]);
    expect((await store.getRecentMessages('a', 10)).map((m) => m.id)).toEqual(['1', '2']);
    expect((await store.getRecentMessages('b', 10)).map((m) => m.id)).toEqual(['9']);
  });

  it('counts messages since a timestamp', async () => {
    await store.addMessages([
      msg('a', '1', '2026-11-01T10:00:00Z'),
      msg('a', '2', '2026-11-01T10:01:00Z'),
      msg('a', '3', '2026-11-01T10:02:00Z'),
    ]);
    expect(await store.countMessagesSince('a', '2026-11-01T10:00:00Z')).toBe(2);
    expect(await store.countMessagesSince('a', null)).toBe(3);
    expect(await store.countMessagesSince('a', '2027-01-01T00:00:00Z')).toBe(0);
  });

  it('stores message text encrypted at rest', async () => {
    await store.addMessages([msg('a', '1', '2026-11-01T10:00:00Z', 'secret plan')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (store as any).messages.toArray();
    expect(JSON.stringify(row)).not.toContain('secret plan');
    expect(row[0].enc_text.ct).toBeDefined();
  });

  it('persists memory encrypted and applies deltas with dedupe + cap', async () => {
    expect(await store.getMemory('a')).toBeUndefined();
    await store.setMemory('a', { summary: 'viva soon', facts: ['loves chai'], coveredUntil: 't', version: 2 });
    expect(await store.getMemory('a')).toEqual({ summary: 'viva soon', facts: ['loves chai'], coveredUntil: 't', version: 2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(await (store as any).memory.toArray())).not.toContain('chai');
    const m = await store.applyMemoryDelta('a', { facts_add: ['Loves Chai', ' viva on 4 Nov ', ''] });
    expect(m.facts).toEqual(['loves chai', 'viva on 4 Nov']);
    const many = Array.from({ length: 30 }, (_, i) => `fact ${i}`);
    const m2 = await store.applyMemoryDelta('a', { facts_add: many });
    expect(m2.facts).toHaveLength(20);
    expect(m2.facts.at(-1)).toBe('fact 29');
    const fresh = await store.applyMemoryDelta('new', { facts_add: ['x'] });
    expect(fresh.facts).toEqual(['x']);
    expect(fresh.summary).toBe('');
  });

  it('queues and drains feedback in order', async () => {
    for (let i = 0; i < 5; i++) await store.queueFeedback({ type: 'copy', ts: String(i) });
    expect((await store.drainFeedback(3)).map((e) => e.ts)).toEqual(['0', '1', '2']);
    expect((await store.drainFeedback(10)).map((e) => e.ts)).toEqual(['3', '4']);
    expect(await store.drainFeedback(10)).toEqual([]);
  });

  it('forgetChat removes everything for the chat only; wipeAll removes all', async () => {
    for (const k of ['a', 'b']) {
      await store.upsertChat(chat(k));
      await store.addMessages([msg(k, '1', '2026-11-01T10:00:00Z')]);
      await store.setMemory(k, { summary: 's', facts: [], coveredUntil: null, version: 1 });
      await store.logSuggestion({ requestId: `r-${k}`, chatKey: k, cards: [], createdAt: 'now' });
    }
    await store.forgetChat('a');
    expect(await store.getChat('a')).toBeUndefined();
    expect(await store.getRecentMessages('a', 10)).toEqual([]);
    expect(await store.getMemory('a')).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logs = await (store as any).suggestionLog.toArray();
    expect(logs.map((l: { requestId: string }) => l.requestId)).toEqual(['r-b']);
    expect(await store.getRecentMessages('b', 10)).toHaveLength(1);
    await store.wipeAll();
    expect(await store.listChats()).toEqual([]);
    expect(await store.getRecentMessages('b', 10)).toEqual([]);
    await store.addMessages([msg('b', '2', null, 'after wipe')]);
    expect((await store.getRecentMessages('b', 10))[0]?.text).toBe('after wipe');
  });

  it('IndexedDB key provider persists the key across instances (if CryptoKey is cloneable)', async () => {
    const name = `test-kp-${n++}`;
    const s1 = new DexieConversationStore(name);
    await s1.addMessages([msg('a', '1', '2026-11-01T10:00:00Z', 'persisted')]);
    s1.close();
    const s2 = new DexieConversationStore(name);
    expect((await s2.getRecentMessages('a', 5))[0]?.text).toBe('persisted');
  });
});
