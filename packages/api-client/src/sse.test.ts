import { describe, expect, it } from 'vitest';
import { streamSuggest, WingmanApiError, type SuggestRequest, type SuggestEvent } from './index';

const enc = new TextEncoder();
const body = {} as SuggestRequest;
const wire =
  'event: meta\ndata: {"request_id":"r","prompt_version":"v1"}\n\n' +
  ': keepalive\n\n' +
  'event: card\ndata: {"kind":"reply",\ndata: "text":"hi"}\n\n' +
  'event: done\ndata: {}\n\n' +
  'event: card\ndata: {"after":"done"}\n\n';

function streamFetch(chunks: Uint8Array[], status = 200, headers?: HeadersInit): typeof fetch {
  return (async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(ch);
        c.close();
      },
    });
    return new Response(stream, { status, headers });
  }) as unknown as typeof fetch;
}

const bytes = (s: string, size: number) => {
  const b = enc.encode(s);
  const out: Uint8Array[] = [];
  for (let i = 0; i < b.length; i += size) out.push(b.slice(i, i + size));
  return out;
};

async function collect(f: typeof fetch, signal?: AbortSignal) {
  const out: SuggestEvent[] = [];
  for await (const e of streamSuggest({ baseUrl: 'http://x', token: 't', body, fetch: f, signal }))
    out.push(e);
  return out;
}

describe('streamSuggest', () => {
  for (const [name, text] of [
    ['LF', wire],
    ['CRLF', wire.replace(/\n/g, '\r\n')],
  ] as const) {
    for (const size of [1, 3, 1000]) {
      it(`parses ${name} with ${size}-byte chunks`, async () => {
        const evs = await collect(streamFetch(bytes(text, size)));
        expect(evs.map((e) => e.event)).toEqual(['meta', 'card', 'done']);
        expect(evs[1]).toEqual({ event: 'card', data: { kind: 'reply', text: 'hi' } });
      });
    }
  }

  it('splits multibyte characters across chunks', async () => {
    const t = 'event: guide\ndata: {"text":"añ😀"}\n\nevent: done\ndata: {}\n\n';
    const evs = await collect(streamFetch(bytes(t, 1)));
    expect(evs[0]).toEqual({ event: 'guide', data: { text: 'añ😀' } });
  });

  it('stops after error', async () => {
    const t = 'event: error\ndata: {"code":"internal","message":"x"}\n\nevent: done\ndata: {}\n\n';
    const evs = await collect(streamFetch(bytes(t, 5)));
    expect(evs.map((e) => e.event)).toEqual(['error']);
  });

  it('sends bearer, JSON and SSE accept headers', async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response('event: done\ndata: {}\n\n');
    }) as unknown as typeof fetch;
    await collect(f);
    const h = init?.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer t');
    expect(h.Accept).toBe('text/event-stream');
    expect(init?.method).toBe('POST');
  });

  it('throws WingmanApiError from error JSON', async () => {
    const f = (async () =>
      new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), {
        status: 429,
      })) as unknown as typeof fetch;
    const err = await collect(f).catch((e) => e);
    expect(err).toBeInstanceOf(WingmanApiError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', message: 'slow down' });
  });

  it('falls back on non-JSON error bodies', async () => {
    const f = (async () => new Response('oops', { status: 502 })) as unknown as typeof fetch;
    const err = await collect(f).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: 'http_error' });
  });

  it('abort stops reading cleanly', async () => {
    const ac = new AbortController();
    const f = (async (_u: string, i: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('event: meta\ndata: {"request_id":"r","prompt_version":"v"}\n\n'));
          i.signal?.addEventListener('abort', () => c.error(new DOMException('x', 'AbortError')));
        },
      });
      return new Response(stream);
    }) as unknown as typeof fetch;
    const got: string[] = [];
    for await (const e of streamSuggest({
      baseUrl: 'http://x',
      token: 't',
      body,
      fetch: f,
      signal: ac.signal,
    })) {
      got.push(e.event);
      ac.abort();
    }
    expect(got).toEqual(['meta']);
  });
});
