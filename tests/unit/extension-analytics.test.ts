/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  (globalThis as { chrome?: typeof chrome }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({
          'nosub-anonymous-id-v1': '11111111-1111-4111-8111-111111111111',
        })),
        set: vi.fn(),
      },
    },
  } as unknown as typeof chrome;
});

describe('extension analytics', () => {
  it('tracks product use without sending a video ID or browsing URL', async () => {
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(null, { status: 202 });
    }));

    const { trackExtensionEvent } = await import('../../src/analytics/extension-analytics.js');
    await trackExtensionEvent('nosub_started');

    expect(sentBody).toEqual({
      event_name: 'nosub_started',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/youtube/watch',
    });
  });
});
