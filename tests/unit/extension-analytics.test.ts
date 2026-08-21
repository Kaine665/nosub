/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  (globalThis as { chrome?: typeof chrome }).chrome = {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.3.1' })),
    },
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
    await trackExtensionEvent('listening_session_started', {
      eventId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-08-21T00:00:00.000Z',
      videoSessionId: '33333333-3333-4333-8333-333333333333',
    });

    expect(sentBody).toEqual({
      event_id: '22222222-2222-4222-8222-222222222222',
      event_name: 'listening_session_started',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/youtube/listening',
      occurred_at: '2026-08-21T00:00:00.000Z',
      video_session_id: '33333333-3333-4333-8333-333333333333',
      app_version: '0.3.1',
      environment: 'development',
      browser_language: 'en-US',
    });
    expect(JSON.stringify(sentBody)).not.toContain('watch?v=');
  });

  it('keeps a supplied event identity stable for retries', async () => {
    const { createExtensionAnalyticsEvent } = await import('../../src/analytics/extension-analytics.js');
    const event = createExtensionAnalyticsEvent('extension_installed', {
      eventId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-08-21T00:00:00.000Z',
    });
    expect(createExtensionAnalyticsEvent(event.eventName, event)).toEqual(event);
  });
});
