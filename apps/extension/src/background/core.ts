/**
 * Background logic with injected dependencies (store, storage, fetch) so it is unit-testable.
 * The service worker entrypoint wires the real chrome.* APIs.
 */
import { buildSuggestRequest, type ConversationStore, type StoredChat } from '@wingman/core';
import {
  createWingmanClient,
  streamSuggest,
  WingmanApiError,
  type SuggestEvent,
} from '@wingman/api-client';
import {
  STORAGE_KEYS,
  type AuthStatus,
  type PortEvent,
  type Reply,
  type ReplyMap,
  type Request,
  type SuggestPortRequest,
} from '../messages';

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export interface BackgroundDeps {
  store: ConversationStore;
  /** Access token lives here (chrome.storage.session). */
  session: KV;
  /** Refresh token, email, install secret (chrome.storage.local). */
  local: KV;
  fetch: typeof fetch;
  apiUrl: string;
  version: string;
  devLogin: boolean;
  googleClientId: string;
  /** Runs the Google OAuth flow and returns an ID token. */
  googleIdToken?: () => Promise<string>;
  /** Opens the sign-in UI (popup) for the content script's "Sign in" prompt. */
  openSignIn?: () => Promise<void>;
  now?: () => Date;
}

class BgError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

export function createBackground(deps: BackgroundDeps) {
  const now = deps.now ?? (() => new Date());
  const K = STORAGE_KEYS;

  // ---------- install secret ----------
  let secretPromise: Promise<string> | null = null;
  const getSecret = (): Promise<string> =>
    (secretPromise ??= (async () => {
      const existing = await deps.local.get(K.installSecret);
      if (typeof existing === 'string' && atob(existing).length === 32) return existing;
      const fresh = b64(crypto.getRandomValues(new Uint8Array(32)));
      await deps.local.set(K.installSecret, fresh);
      return fresh;
    })());

  // ---------- auth ----------
  const getAccess = async (): Promise<string | null> => {
    const t = await deps.session.get(K.accessToken);
    return typeof t === 'string' && t ? t : null;
  };
  const saveTokens = async (
    t: { access_token: string; refresh_token: string },
    email: string | null,
  ) => {
    await deps.session.set(K.accessToken, t.access_token);
    await deps.local.set(K.refreshToken, t.refresh_token);
    if (email) await deps.local.set(K.email, email);
  };
  const clearTokens = async () => {
    await deps.session.remove(K.accessToken);
    await deps.local.remove(K.refreshToken);
    await deps.local.remove(K.email);
  };

  let refreshing: Promise<string | null> | null = null;
  const refresh = (): Promise<string | null> =>
    (refreshing ??= (async () => {
      try {
        const rt = await deps.local.get(K.refreshToken);
        if (typeof rt !== 'string' || !rt) return null;
        const { data, response } = await client.POST('/v1/auth/refresh', {
          body: { refresh_token: rt },
        });
        if (!data) {
          // A definitive rejection (expired / reused token) signs the user out; network errors do not.
          if (response && response.status >= 400 && response.status < 500) await clearTokens();
          return null;
        }
        await saveTokens(data, null);
        return data.access_token;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })());

  const client = createWingmanClient({
    baseUrl: deps.apiUrl,
    getAccessToken: getAccess,
    refresh,
    fetch: deps.fetch,
  });

  const authStatus = async (): Promise<AuthStatus> => {
    const rt = await deps.local.get(K.refreshToken);
    const access = await getAccess();
    const email = await deps.local.get(K.email);
    return {
      signedIn: Boolean(access || (typeof rt === 'string' && rt)),
      email: typeof email === 'string' ? email : null,
      apiUrl: deps.apiUrl,
      devLogin: deps.devLogin,
      googleEnabled: Boolean(deps.googleClientId && deps.googleIdToken),
    };
  };

  const devLogin = async (email: string): Promise<AuthStatus> => {
    if (!deps.devLogin)
      throw new BgError('dev_login_disabled', 'Dev login is not enabled in this build');
    const trimmed = email.trim();
    if (!trimmed) throw new BgError('invalid_email', 'Enter an email');
    const { data, error } = await client.POST('/v1/auth/dev', { body: { email: trimmed } });
    if (!data) throw new BgError('login_failed', `Dev login failed: ${JSON.stringify(error)}`);
    await saveTokens(data, trimmed);
    return authStatus();
  };

  const googleLogin = async (): Promise<AuthStatus> => {
    if (!deps.googleClientId || !deps.googleIdToken)
      throw new BgError('google_disabled', 'Google sign-in is not configured in this build');
    const idToken = await deps.googleIdToken();
    const { data, error } = await client.POST('/v1/auth/google', { body: { id_token: idToken } });
    if (!data) throw new BgError('login_failed', `Google login failed: ${JSON.stringify(error)}`);
    await saveTokens(data, emailFromIdToken(idToken));
    return authStatus();
  };

  // ---------- request/response messages ----------
  async function dispatch(msg: Request): Promise<ReplyMap[Request['type']]> {
    const { store } = deps;
    switch (msg.type) {
      case 'secret.get':
        return { secret: await getSecret() };
      case 'chat.upsert': {
        const c = msg.chat;
        if (!c.chatKey) throw new BgError('bad_request', 'chatKey required');
        const existing = await store.getChat(c.chatKey);
        const ts = now().toISOString();
        const chat: StoredChat = {
          ...existing,
          chatKey: c.chatKey,
          platform: c.platform,
          title: c.title,
          isGroup: c.isGroup,
          firstSeenAt: existing?.firstSeenAt ?? ts,
          lastMsgAt: existing?.lastMsgAt ?? ts,
        };
        await store.upsertChat(chat);
        return null;
      }
      case 'messages.add': {
        const msgs = msg.messages.filter((m) => m.chatKey === msg.chatKey);
        if (msgs.length) await store.addMessages(msgs);
        return { added: msgs.length };
      }
      case 'memory.applyDelta':
        await store.applyMemoryDelta(msg.chatKey, msg.delta);
        return null;
      case 'chat.forget':
        await store.forgetChat(msg.chatKey);
        return null;
      case 'auth.status':
        return authStatus();
      case 'auth.devLogin':
        return devLogin(msg.email);
      case 'auth.google':
        return googleLogin();
      case 'auth.signIn':
        if (deps.googleClientId && deps.googleIdToken) {
          void googleLogin().catch(() => undefined);
          return { opened: 'google' as const };
        }
        await deps.openSignIn?.();
        return { opened: 'popup' as const };
      case 'auth.signOut':
        await clearTokens();
        return authStatus();
      case 'store.wipeAll':
        await store.wipeAll();
        return null;
    }
  }

  async function handle<R extends Request>(msg: R): Promise<Reply<ReplyMap[R['type']]>> {
    try {
      return { ok: true, data: (await dispatch(msg)) as ReplyMap[R['type']] };
    } catch (e) {
      if (e instanceof BgError) return { ok: false, error: { code: e.code, message: e.message } };
      return {
        ok: false,
        error: { code: 'internal', message: e instanceof Error ? e.message : String(e) },
      };
    }
  }

  // ---------- suggest over a Port ----------
  async function runSuggest(port: PortLike, req: SuggestPortRequest, signal: AbortSignal) {
    const send = (ev: PortEvent) => {
      if (signal.aborted) return;
      try {
        port.postMessage(ev);
      } catch {
        /* port closed */
      }
    };
    const fail = (code: string, message: string) =>
      send({ event: 'error', data: { code, message } });

    let token = (await getAccess()) ?? (await refresh());
    if (!token) return fail('auth_required', 'Sign in to use Wingman');

    const chat = await deps.store.getChat(req.chatKey);
    if (!chat) return fail('unknown_chat', 'Chat not seen yet. Open it in WhatsApp first.');
    const [messages, memory] = await Promise.all([
      deps.store.getRecentMessages(req.chatKey, 60),
      deps.store.getMemory(req.chatKey),
    ]);
    const body = buildSuggestRequest({
      chat,
      messages,
      memory,
      mode: req.mode,
      trigger: req.trigger,
      controls: req.controls,
      directive: req.directive,
      draft: req.draft,
      avoid: req.avoid,
      tweak: req.tweak,
      client: { app: 'ext', version: deps.version },
    });

    const cards: unknown[] = [];
    const consume = async (t: string) => {
      for await (const ev of streamSuggest({
        baseUrl: deps.apiUrl,
        token: t,
        body,
        signal,
        fetch: deps.fetch,
      })) {
        const e = ev as SuggestEvent;
        if (e.event === 'card') cards.push(e.data);
        if (e.event === 'memory' && e.data.facts_add.length)
          await deps.store.applyMemoryDelta(req.chatKey, { facts_add: e.data.facts_add });
        send(e as PortEvent);
        if (e.event === 'done')
          await deps.store.logSuggestion({
            requestId: body.request_id,
            chatKey: req.chatKey,
            cards,
            controls: req.controls,
            createdAt: now().toISOString(),
          });
      }
    };

    try {
      try {
        await consume(token);
      } catch (e) {
        if (!(e instanceof WingmanApiError) || e.status !== 401) throw e;
        token = (await refresh()) ?? '';
        if (!token) return fail('auth_required', 'Session expired. Sign in again.');
        await consume(token);
      }
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof WingmanApiError)
        return fail(e.status === 401 ? 'auth_required' : e.code, e.message);
      fail('network', e instanceof Error ? e.message : 'Could not reach the Wingman API');
    }
  }

  function onSuggestPort(port: PortLike) {
    const ac = new AbortController();
    let started = false;
    port.onDisconnect.addListener(() => ac.abort());
    port.onMessage.addListener((m) => {
      if (started) return;
      started = true;
      void runSuggest(port, m as SuggestPortRequest, ac.signal).catch((e) => {
        if (!ac.signal.aborted)
          try {
            port.postMessage({
              event: 'error',
              data: { code: 'internal', message: e instanceof Error ? e.message : String(e) },
            } satisfies PortEvent);
          } catch {
            /* closed */
          }
      });
    });
  }

  return { handle, onSuggestPort };
}

export type Background = ReturnType<typeof createBackground>;
