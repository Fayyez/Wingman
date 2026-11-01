/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { Controller } from './controller';
import { initialState, type UiState } from '../ui/overlay';
import type { PortLike } from '../background/core';

function setup(insertOk = true) {
  let state = initialState();
  const ui = {
    getState: () => state,
    set: (p: Partial<UiState>) => void (state = { ...state, ...p }),
  };
  const posted: any[] = [];
  let emit: (m: unknown) => void = () => undefined;
  let disc: () => void = () => undefined;
  const disconnect = vi.fn();
  const inserted: string[] = [];
  const c = new Controller({
    ui,
    insert: async (t) => (inserted.push(t), insertOk),
    copy: async () => true,
    connect: () =>
      ({
        postMessage: (m) => void posted.push(m),
        onMessage: { addListener: (cb) => (emit = cb) },
        onDisconnect: { addListener: (cb) => (disc = cb) },
        disconnect,
      }) as PortLike,
    getChatKey: () => 'ck_1',
    syncChat: async () => undefined,
    signIn: vi.fn(),
  });
  const card = (n: number, text: string) =>
    emit({ event: 'card', data: { id: `id${n}`, rank: n, kind: 'reply', approach: 'a', text } });
  return {
    c,
    ui,
    posted,
    inserted,
    card,
    emit: (m: unknown) => emit(m),
    disc: () => disc(),
    disconnect,
    get: () => state,
  };
}

describe('Controller', () => {
  it('streams cards in rank order and finishes on done', async () => {
    const t = setup();
    await t.c.run({ mode: 'reply', trigger: 'button' });
    expect(t.posted[0]).toMatchObject({ chatKey: 'ck_1', mode: 'reply', trigger: 'button' });
    expect(t.get().status).toBe('loading');
    t.card(2, 'b');
    t.card(1, 'a');
    expect(t.get().cards.map((x) => x.text)).toEqual(['a', 'b']);
    expect(t.get().status).toBe('streaming');
    t.emit({ event: 'done', data: {} });
    expect(t.get().status).toBe('done');
  });

  it('multi-line card: insert first part then "insert next" for the rest', async () => {
    const t = setup();
    await t.c.run({ mode: 'reply', trigger: 'button' });
    t.card(1, 'one\ntwo\nthree');
    await t.c.onInsert('id1');
    expect(t.inserted).toEqual(['one']);
    expect(t.get().pending).toEqual({ id1: 2 });
    await t.c.onInsertNext('id1');
    expect(t.inserted).toEqual(['one', 'two']);
    expect(t.get().pending).toEqual({ id1: 1 });
    await t.c.onInsertNext('id1');
    expect(t.inserted).toEqual(['one', 'two', 'three']);
    expect(t.get().pending).toEqual({});
  });

  it('Alt+n inserts card n; failed insert keeps no pending', async () => {
    const t = setup(false);
    await t.c.run({ mode: 'reply', trigger: 'button' });
    t.card(1, 'x\ny');
    t.card(2, 'second');
    await t.c.insertByIndex(2);
    expect(t.inserted).toEqual(['second']);
    await t.c.insertByIndex(1);
    expect(t.get().pending).toEqual({});
    expect(t.get().toast).toMatch(/Copy/);
  });

  it('regenerate sends avoid = current card texts; tweak sets trigger+tweak', async () => {
    const t = setup();
    await t.c.run({ mode: 'topic', trigger: 'button', controls: { tone: 'chill' } });
    t.card(1, 'a');
    t.card(2, 'b');
    t.emit({ event: 'done', data: {} });
    t.c.onRegenerate();
    await vi.waitFor(() => expect(t.posted.length).toBe(2));
    expect(t.posted[1]).toMatchObject({
      trigger: 'regenerate',
      mode: 'topic',
      avoid: ['a', 'b'],
      controls: { tone: 'chill' },
    });
    t.card(1, 'c');
    t.emit({ event: 'done', data: {} });
    t.c.onTweak('shorter');
    await vi.waitFor(() => expect(t.posted.length).toBe(3));
    expect(t.posted[2]).toMatchObject({ trigger: 'tweak', tweak: 'shorter', avoid: ['c'] });
  });

  it('command run keeps directive/draft and trigger command; disconnect aborts previous port', async () => {
    const t = setup();
    t.c.runCommand({ mode: 'rewrite', controls: {}, draft: 'hello' });
    await vi.waitFor(() => expect(t.posted.length).toBe(1));
    expect(t.posted[0]).toMatchObject({ trigger: 'command', mode: 'rewrite', draft: 'hello' });
    await t.c.run({ mode: 'reply', trigger: 'button' });
    expect(t.disconnect).toHaveBeenCalled();
  });

  it('shows auth_required error and surfaces retry', async () => {
    const t = setup();
    await t.c.run({ mode: 'reply', trigger: 'button' });
    t.emit({ event: 'error', data: { code: 'auth_required', message: 'Sign in' } });
    expect(t.get().status).toBe('error');
    expect(t.get().error?.code).toBe('auth_required');
  });

  it('reset clears stale cards on chat switch', async () => {
    const t = setup();
    await t.c.run({ mode: 'reply', trigger: 'button' });
    t.card(1, 'a');
    t.c.reset();
    expect(t.get().cards).toEqual([]);
    expect(t.get().status).toBe('idle');
  });
});
