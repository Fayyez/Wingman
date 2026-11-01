import { describe, expect, it } from 'vitest';
import type { NormalizedMessage } from '../model';
import type { StoredChat } from '../store/types';
import { buildSuggestRequest, estimateTokens, needsMemoryRefresh, theirAlias, type BuildSuggestInput } from './build';

const chat: StoredChat = {
  chatKey: 'ck_1',
  platform: 'whatsapp_web',
  title: 'Ayesha Khan',
  isGroup: false,
  stage: 'talking',
  firstSeenAt: '2026-11-01T00:00:00Z',
  lastMsgAt: '2026-11-01T00:00:00Z',
};
const mk = (i: number, text = `msg ${i}`, extra: Partial<NormalizedMessage> = {}): NormalizedMessage => ({
  id: String(i),
  chatKey: 'ck_1',
  dir: i % 2 ? 'in' : 'out',
  kind: 'text',
  text,
  ts: `2026-11-01T10:${String(i % 60).padStart(2, '0')}:00Z`,
  ...extra,
});
const many = (n: number, text?: (i: number) => string) => Array.from({ length: n }, (_, i) => mk(i, text?.(i)));
const base = (over: Partial<BuildSuggestInput> = {}): BuildSuggestInput => ({
  chat,
  messages: many(3),
  mode: 'auto',
  trigger: 'incoming_message',
  client: { app: 'ext', version: '0.1.0', styleProfileVersion: 7 },
  ...over,
});

describe('buildSuggestRequest', () => {
  it('produces the §4.1 shape with snake_case fields', () => {
    const r = buildSuggestRequest(
      base({
        controls: { tone: 'playful', count: 3 },
        directive: 'she is stressed',
        avoid: ['old card'],
        tweak: 'shorter',
        memory: { summary: 's', facts: ['f'], coveredUntil: '2026-10-28T19:00:00Z', version: 1 },
      }),
    );
    expect(r.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.chat).toEqual({ key: 'ck_1', platform: 'whatsapp_web', stage: 'talking', their_alias: 'Ayesha', is_group: false });
    expect(r.mode).toBe('auto');
    expect(r.trigger).toBe('incoming_message');
    expect(r.controls).toEqual({ tone: 'playful', count: 3 });
    expect(r.directive).toBe('she is stressed');
    expect(r.draft).toBeNull();
    expect(r.avoid).toEqual(['old card']);
    expect(r.tweak).toBe('shorter');
    expect(r.memory).toEqual({ summary: 's', facts: ['f'], covered_until: '2026-10-28T19:00:00Z' });
    expect(r.messages[0]).toEqual({ dir: 'out', kind: 'text', text: 'msg 0', ts: '2026-11-01T10:00:00Z' });
    expect(r.client).toEqual({ app: 'ext', version: '0.1.0', style_profile_version: 7 });
  });

  it('uses unique request ids and empty memory defaults', () => {
    const a = buildSuggestRequest(base());
    const b = buildSuggestRequest(base());
    expect(a.request_id).not.toBe(b.request_id);
    expect(a.memory).toEqual({ summary: '', facts: [], covered_until: null });
  });

  it('caps the window at 40 messages, newest kept', () => {
    const r = buildSuggestRequest(base({ messages: many(100) }));
    expect(r.messages).toHaveLength(40);
    expect(r.messages.at(-1)?.text).toBe('msg 99');
    expect(r.messages[0]?.text).toBe('msg 60');
  });

  it('drops oldest to fit the token budget but keeps at least 6', () => {
    const long = 'x'.repeat(700); // 200 tokens each
    const r = buildSuggestRequest(base({ messages: many(40, () => long) }));
    expect(r.messages.length).toBeLessThan(40);
    expect(r.messages.length).toBeGreaterThanOrEqual(6);
    const tokens = r.messages.reduce((a, m) => a + estimateTokens(m.text), 0);
    expect(tokens).toBeLessThanOrEqual(2500);
    const huge = 'y'.repeat(7000);
    const r2 = buildSuggestRequest(base({ messages: many(20, () => huge) }));
    expect(r2.messages).toHaveLength(6);
  });

  it('redacts messages, directive, draft and avoid', () => {
    const r = buildSuggestRequest(
      base({
        messages: [mk(1, 'call +92 300 1234567'), mk(2, 'mail a@b.com')],
        directive: 'her number 03001234567',
        draft: 'see https://x.com/a?t=1',
        mode: 'rewrite',
      }),
    );
    expect(r.messages.map((m) => m.text)).toEqual(['call <PHONE>', 'mail <EMAIL>']);
    expect(r.directive).toBe('her number <PHONE>');
    expect(r.draft).toBe('see <URL>');
  });

  it('maps media-only messages to placeholders', () => {
    const kinds = ['image', 'voice', 'sticker', 'deleted', 'video', 'gif'] as const;
    const r = buildSuggestRequest(base({ messages: kinds.map((k, i) => mk(i, '', { kind: k })) }));
    expect(r.messages.map((m) => m.text)).toEqual(['[photo]', '[voice note]', '[sticker]', '[deleted]', '[video]', '[gif]']);
    const cap = buildSuggestRequest(base({ messages: [mk(1, 'dekho yeh', { kind: 'image' })] }));
    expect(cap.messages[0]?.text).toBe('[photo] dekho yeh');
  });

  it('never sends sender names or ids', () => {
    const r = buildSuggestRequest(base({ messages: [mk(1, 'hi', { sender: 'Ayesha Khan' })] }));
    expect(JSON.stringify(r)).not.toContain('Ayesha Khan');
  });
});

describe('theirAlias', () => {
  it('prefers alias, then first word of title', () => {
    expect(theirAlias({ alias: 'Jaan', title: 'Ayesha Khan' })).toBe('Jaan');
    expect(theirAlias({ title: 'Ayesha Khan' })).toBe('Ayesha');
  });
  it('falls back to "them" for phone-like or empty titles', () => {
    expect(theirAlias({ title: '+92 300 1234567' })).toBe('them');
    expect(theirAlias({ title: '0300-1234567' })).toBe('them');
    expect(theirAlias({ title: '' })).toBe('them');
  });
});

describe('needsMemoryRefresh', () => {
  it('triggers above 50 new messages', () => {
    expect(needsMemoryRefresh(undefined, 50)).toBe(false);
    expect(needsMemoryRefresh(undefined, 51)).toBe(true);
  });
  it('triggers when the window is overflowing with uncovered messages', () => {
    expect(needsMemoryRefresh(null, 45, true)).toBe(true);
    expect(needsMemoryRefresh(null, 10, true)).toBe(false);
    expect(needsMemoryRefresh(null, 45)).toBe(false);
  });
});
