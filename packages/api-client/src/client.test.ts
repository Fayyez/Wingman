import { describe, expect, it, vi } from 'vitest';
import { createWingmanClient } from './index';

const json = (status: number, b: unknown = {}) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function setup(responses: Response[]) {
  const calls: Request[] = [];
  const fetchMock = vi.fn(async (input: Request) => {
    calls.push(input);
    return responses.shift()!;
  });
  const refresh = vi.fn(async () => 'new');
  const client = createWingmanClient({
    baseUrl: 'http://api',
    getAccessToken: async () => 'old',
    refresh,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { client, calls, refresh };
}

describe('createWingmanClient', () => {
  it('adds bearer token', async () => {
    const { client, calls } = setup([json(200)]);
    await client.GET('/v1/me');
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer old');
  });

  it('refreshes once and retries once on 401', async () => {
    const { client, calls, refresh } = setup([json(401), json(200, { ok: 1 })]);
    const { response } = await client.GET('/v1/me');
    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get('Authorization')).toBe('Bearer new');
  });

  it('does not loop when the retry is also 401', async () => {
    const { client, calls, refresh } = setup([json(401), json(401)]);
    const { response } = await client.GET('/v1/me');
    expect(response.status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('retries POST bodies', async () => {
    const { client, calls } = setup([json(401), json(200)]);
    await client.POST('/v1/auth/refresh', { body: { refresh_token: 'r' } as never });
    expect(calls).toHaveLength(1); // auth route: no refresh/retry
    const s2 = setup([json(401), json(200)]);
    await s2.client.PATCH('/v1/me/settings', { body: {} as never });
    expect(s2.calls).toHaveLength(2);
    expect(await s2.calls[1]!.text()).toBe('{}');
  });

  it('skips auth header and refresh for /v1/auth/*', async () => {
    const { client, calls, refresh } = setup([json(401)]);
    await client.POST('/v1/auth/dev', { body: {} as never });
    expect(calls[0]!.headers.get('Authorization')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
