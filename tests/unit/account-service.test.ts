/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage: Record<string, unknown> = {};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  for (const key of Object.keys(storage)) delete storage[key];
  (globalThis as { chrome?: typeof chrome }).chrome = {
    identity: {
      getAuthToken: vi.fn(async () => ({ token: 'google-token' })),
      removeCachedAuthToken: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => key in storage ? { [key]: storage[key] } : {}),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        }),
      },
    },
  } as unknown as typeof chrome;
});

describe('Google account analytics identity link', () => {
  it('links the installation with the authenticated session and never submits a user ID', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/v1/auth/google')) {
        return new Response(JSON.stringify({
          access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600,
          user: { id: 'user-1', email: 'user@example.com' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/v1/analytics/identity')) return new Response(null, { status: 204 });
      if (url.endsWith('/v1/account')) {
        return new Response(JSON.stringify({
          user: { id: 'user-1', email: 'user@example.com' }, isPro: false, subscription: null,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 404 });
    }));

    const { AccountService } = await import('../../src/auth/account-service.js');
    await new AccountService().signInWithGoogle();

    const link = requests.find((request) => request.url.endsWith('/v1/analytics/identity'));
    expect(link?.init?.headers).toMatchObject({ authorization: 'Bearer access-token' });
    const body = JSON.parse(String(link?.init?.body)) as Record<string, unknown>;
    expect(body.anonymous_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body).not.toHaveProperty('user_id');
    expect(body).not.toHaveProperty('email');
  });
});
