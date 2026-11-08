import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';
import { SseParser } from './sse';

export type { paths, components };
type S = components['schemas'];

export type SuggestRequest = S['SuggestRequest'];
export type MetaEvent = S['MetaEvent'];
export type AnalysisEvent = S['AnalysisEvent'];
export type CardEvent = S['CardEvent'];
export type GuideEvent = S['GuideEvent'];
export type MemoryEvent = S['MemoryEvent'];
export type DoneEvent = S['DoneEvent'];
export type ErrorEvent = S['ErrorEvent'];
export type SuggestEventName = S['SuggestEventName'];

export type SuggestEvent =
  | { event: 'meta'; data: MetaEvent }
  | { event: 'analysis'; data: AnalysisEvent }
  | { event: 'card'; data: CardEvent }
  | { event: 'guide'; data: GuideEvent }
  | { event: 'memory'; data: MemoryEvent }
  | { event: 'done'; data: DoneEvent }
  | { event: 'error'; data: ErrorEvent };

export class WingmanApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WingmanApiError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  fetch?: typeof fetch;
}

const isAuthRoute = (url: string) => new URL(url, 'http://x').pathname.startsWith('/v1/auth/');

export function createWingmanClient(opts: ClientOptions) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const client = createClient<paths>({ baseUrl: opts.baseUrl, fetch: doFetch });
  // openapi-fetch consumes the Request body; keep a clone per request for the retry.
  const clones = new WeakMap<Request, Request>();
  const mw: Middleware = {
    async onRequest({ request }) {
      if (!isAuthRoute(request.url)) {
        clones.set(request, request.clone());
        const token = await opts.getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || isAuthRoute(request.url)) return undefined;
      const retry = clones.get(request);
      if (!retry) return undefined;
      const token = await opts.refresh();
      if (!token) return undefined;
      retry.headers.set('Authorization', `Bearer ${token}`);
      return doFetch(retry);
    },
  };
  client.use(mw);
  return client;
}

async function toApiError(res: Response): Promise<WingmanApiError> {
  let code = 'http_error';
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    if (j.error?.code) code = j.error.code;
    if (j.error?.message) message = j.error.message;
  } catch {
    /* non-JSON body */
  }
  return new WingmanApiError(res.status, code, message);
}

export interface StreamSuggestOptions {
  baseUrl: string;
  token: string;
  body: SuggestRequest;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

const KNOWN = new Set<string>(['meta', 'analysis', 'card', 'guide', 'memory', 'done', 'error']);

export async function* streamSuggest(opts: StreamSuggestOptions): AsyncGenerator<SuggestEvent> {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl.replace(/\/$/, '')}/v1/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) return;
    throw e;
  }
  if (!res.ok) throw await toApiError(res);
  if (!res.body) throw new WingmanApiError(res.status, 'no_body', 'Empty response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (opts.signal?.aborted) return;
        throw e;
      }
      const events = chunk.done
        ? [...parser.push(decoder.decode()), ...parser.end()]
        : parser.push(decoder.decode(chunk.value, { stream: true }));
      for (const raw of events) {
        if (!KNOWN.has(raw.event)) continue;
        const ev = { event: raw.event, data: JSON.parse(raw.data) } as SuggestEvent;
        yield ev;
        if (ev.event === 'done' || ev.event === 'error') return;
      }
      if (chunk.done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
