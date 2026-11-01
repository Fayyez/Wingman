/* eslint-disable @typescript-eslint/no-explicit-any */
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { DexieConversationStore, InMemoryKeyProvider, type NormalizedMessage } from '@wingman/core';
import { createBackground, type KV, type PortLike } from './core';

const memKV = (): KV & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sse = (events: [string, unknown][]) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

const TOKENS = {
  access_token: 'acc1',
  refresh_token: 'ref1',
  expires_in: 900,
  token_type: 'bearer',
};
const CARD = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  rank: n,
  kind: 'reply',
  approach: 'playful',
  text: `card ${n}`,
});
const OK_STREAM: [string, unknown][] = [
  ['meta', { request_id: 'r', prompt_version: 'v1', model_route: 'suggest' }],
  [
    'analysis',
    {
      their_mood: 'neutral',
      energy: 'medium',
      interest: 'unclear',
      hooks: [],
      recommended_move: 'x',
      boundary_signal: false,
    },
  ],
  ['card', CARD(1)],
  ['card', CARD(2)],
  ['card', CARD(3)],
  ['memory', { facts_add: ['likes chai'] }],
  ['done', { cards: 3, first_card_ms: 5, latency_ms: 10 }],
];

function fakePort() {
  const msgs: any[] = [];
  let onMsg: (m: unknown) => void = () => undefined;
  let onDisc: () => void = () => undefined;
  const port: PortLike = {
    postMessage: (m) => void msgs.push(m),
    onMessage: { addListener: (cb) => (onMsg = cb) },
    onDisconnect: { addListener: (cb) => (onDisc = cb) },
  };
  return { port, msgs, send: (m: unknown) => onMsg(m), disconnect: () => onDisc() };
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

const msg = (id: string, dir: 'in' | 'out', text: string): NormalizedMessage => ({
  id,
  chatKey: 'ck_1',
  dir,
  kind: 'text',
  text,
  ts: `2026-11-01T10:0${id}:00Z`,
});

let n = 0;
function setup(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  over: Partial<Parameters<typeof createBackground>[0]> = {},
) {
  const store = new DexieConversationStore(`ext-test-${n++}`, new InMemoryKeyProvider());
  const session = memKV();
  const local = memKV();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    return fetchImpl(
      req.url,
      init ?? {
        method: req.method,
        headers: req.headers,
        body: await req.clone().text(),
        signal: req.signal,
      },
    );
  });
  const bg = createBackground({
    store,
    session,
    local,
    fetch: fetchMock as unknown as typeof fetch,
    apiUrl: 'http://api.test',
    version: '9.9.9',
    devLogin: true,
    googleClientId: '',
    ...over,
  });
  return { store, session, local, bg, fetchMock };
}

async function seedChat(bg: ReturnType<typeof setup>['bg']) {
  await bg.handle({
    type: 'chat.upsert',
    chat: { chatKey: 'ck_1', platform: 'whatsapp_web', title: 'Ayesha Khan', isGroup: false },
  });
  await bg.handle({
    type: 'messages.add',
    chatKey: 'ck_1',
    messages: [msg('1', 'out', 'kesa gaya din?'), msg('2', 'in', 'thak gai hun yaar')],
  });
}

describe('storage messages', () => {
  it('generates a stable 32-byte install secret', async () => {
    const { bg, local } = setup(async () => json({}));
    const a = await bg.handle({ type: 'secret.get' });
    const b = await bg.handle({ type: 'secret.get' });
    expect(a.ok && b.ok && a.data.secret === b.data.secret).toBe(true);
    if (a.ok) expect(atob(a.data.secret)).toHaveLength(32);
    expect(local.data.get('installSecret')).toBeTruthy();
  });

  it('upserts chats, persists messages (only for that chat) and forgets', async () => {
    const { bg, store } = setup(async () => json({}));
    await seedChat(bg);
    const extra = await bg.handle({
      type: 'messages.add',
      chatKey: 'ck_1',
      messages: [{ ...msg('3', 'in', 'x'), chatKey: 'other' }],
    });
    expect(extra).toEqual({ ok: true, data: { added: 0 } });
    expect((await store.getChat('ck_1'))?.title).toBe('Ayesha Khan');
    expect((await store.getRecentMessages('ck_1', 10)).map((m) => m.text)).toEqual([
      'kesa gaya din?',
      'thak gai hun yaar',
    ]);
    await bg.handle({
      type: 'memory.applyDelta',
      chatKey: 'ck_1',
      delta: { facts_add: ['a fact'] },
    });
    expect((await store.getMemory('ck_1'))?.facts).toEqual(['a fact']);
    await bg.handle({ type: 'chat.forget', chatKey: 'ck_1' });
    expect(await store.getChat('ck_1')).toBeUndefined();
    expect(await store.getRecentMessages('ck_1', 10)).toEqual([]);
  });

  it('wipeAll clears everything', async () => {
    const { bg, store } = setup(async () => json({}));
    await seedChat(bg);
    await bg.handle({ type: 'store.wipeAll' });
    expect(await store.listChats()).toEqual([]);
  });
});

describe('auth', () => {
  it('dev login stores access in session, refresh in local; sign out clears', async () => {
    const { bg, session, local, fetchMock } = setup(async (url) =>
      url.endsWith('/v1/auth/dev') ? json(TOKENS) : json({}, 404),
    );
    expect(
      (await bg.handle({ type: 'auth.status' })).ok && (await bg.handle({ type: 'auth.status' })),
    ).toMatchObject({ data: { signedIn: false } });
    const r = await bg.handle({ type: 'auth.devLogin', email: 'a@b.co' });
    expect(r).toMatchObject({
      ok: true,
      data: { signedIn: true, email: 'a@b.co', apiUrl: 'http://api.test' },
    });
    expect(session.data.get('accessToken')).toBe('acc1');
    expect(local.data.get('refreshToken')).toBe('ref1');
    expect(session.data.has('refreshToken')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const out = await bg.handle({ type: 'auth.signOut' });
    expect(out).toMatchObject({ ok: true, data: { signedIn: false, email: null } });
    expect(
      session.data.size + [...local.data.keys()].filter((k) => k !== 'installSecret').length,
    ).toBe(0);
  });

  it('rejects dev login when disabled', async () => {
    const { bg, fetchMock } = setup(async () => json({}), { devLogin: false });
    expect(await bg.handle({ type: 'auth.devLogin', email: 'a@b.co' })).toMatchObject({
      ok: false,
      error: { code: 'dev_login_disabled' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('google login uses the injected token flow', async () => {
    const payload = btoa(JSON.stringify({ email: 'g@x.com' })).replace(/=+$/, '');
    const idToken = `h.${payload}.s`;
    const { bg, local } = setup(
      async (url) => (url.endsWith('/v1/auth/google') ? json(TOKENS) : json({}, 404)),
      {
        googleClientId: 'cid',
        googleIdToken: async () => idToken,
      },
    );
    expect(await bg.handle({ type: 'auth.google' })).toMatchObject({
      ok: true,
      data: { signedIn: true, email: 'g@x.com' },
    });
    expect(local.data.get('refreshToken')).toBe('ref1');
  });
});

describe('suggest port', () => {
  const req = {
    chatKey: 'ck_1',
    mode: 'reply' as const,
    trigger: 'button' as const,
    controls: { tone: 'playful' as const },
  };

  it('reports auth_required when signed out', async () => {
    const { bg } = setup(async () => json({}));
    const p = fakePort();
    bg.onSuggestPort(p.port);
    p.send(req);
    await waitFor(() => p.msgs.length > 0);
    expect(p.msgs[0]).toEqual({
      event: 'error',
      data: { code: 'auth_required', message: expect.any(String) },
    });
  });

  it('streams events to the port, builds the request from the store and applies memory', async () => {
    let body: any;
    let auth: string | null = null;
    const { bg, store, session } = setup(async (url, init) => {
      if (!url.endsWith('/v1/suggest')) return json({}, 404);
      body = JSON.parse(String(init?.body));
      auth = new Headers(init?.headers).get('Authorization');
      return sse(OK_STREAM);
    });
    session.data.set('accessToken', 'acc1');
    await seedChat(bg);
    const p = fakePort();
    bg.onSuggestPort(p.port);
    p.send({ ...req, avoid: ['old'] });
    await waitFor(() => p.msgs.some((m) => m.event === 'done'));
    expect(p.msgs.map((m) => m.event)).toEqual([
      'meta',
      'analysis',
      'card',
      'card',
      'card',
      'memory',
      'done',
    ]);
    expect(auth).toBe('Bearer acc1');
    expect(body.client).toMatchObject({ app: 'ext', version: '9.9.9' });
    expect(body.chat).toMatchObject({
      key: 'ck_1',
      their_alias: 'Ayesha',
      platform: 'whatsapp_web',
    });
    expect(body.controls).toEqual({ tone: 'playful' });
    expect(body.avoid).toEqual(['old']);
    expect(body.messages.map((m: any) => m.text)).toEqual(['kesa gaya din?', 'thak gai hun yaar']);
    expect((await store.getMemory('ck_1'))?.facts).toEqual(['likes chai']);
  });

  it('errors for an unknown chat', async () => {
    const { bg, session } = setup(async () => json({}));
    session.data.set('accessToken', 'acc1');
    const p = fakePort();
    bg.onSuggestPort(p.port);
    p.send(req);
    await waitFor(() => p.msgs.length > 0);
    expect(p.msgs[0].data.code).toBe('unknown_chat');
  });

  it('refreshes once on 401 and retries', async () => {
    const seen: string[] = [];
    const { bg, session, local } = setup(async (url, init) => {
      if (url.endsWith('/v1/auth/refresh'))
        return json({ ...TOKENS, access_token: 'acc2', refresh_token: 'ref2' });
      seen.push(new Headers(init?.headers).get('Authorization') ?? '');
      return seen.length === 1
        ? json({ error: { code: 'unauthorized', message: 'expired' } }, 401)
        : sse(OK_STREAM);
    });
    session.data.set('accessToken', 'stale');
    local.data.set('refreshToken', 'ref1');
    await seedChat(bg);
    const p = fakePort();
    bg.onSuggestPort(p.port);
    p.send(req);
    await waitFor(() => p.msgs.some((m) => m.event === 'done'));
    expect(seen).toEqual(['Bearer stale', 'Bearer acc2']);
    expect(local.data.get('refreshToken')).toBe('ref2');
  });

  it('maps API errors and forwards server error events', async () => {
    const { bg, session } = setup(async () =>
      json({ error: { code: 'rate_limited', message: 'slow down' } }, 429),
    );
    session.data.set('accessToken', 'acc1');
    await seedChat(bg);
    const p = fakePort();
    bg.onSuggestPort(p.port);
    p.send(req);
    await waitFor(() => p.msgs.length > 0);
    expect(p.msgs[0]).toEqual({
      event: 'error',
      data: { code: 'rate_limited', message: 'slow down' },
    });
  });

  it('aborts the upstream fetch when the port disconnects', async () => {
    let signal: AbortSignal | undefined;
    const { bg, session } = setup((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener('abort', () =>
          rej(new DOMException('aborted', 'AbortError')),
        ),
      );
    });
    session.data.set('accessToken', 'acc1');
    await seedChat(bg);
    const p = fakePort();
    bg.onSuggestPort(p.port);
    p.send(req);
    await waitFor(() => signal !== undefined);
    expect(signal!.aborted).toBe(false);
    p.disconnect();
    expect(signal!.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(p.msgs).toEqual([]);
  });
});
