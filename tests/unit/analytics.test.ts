import { describe, expect, it } from 'vitest';
import { parseAnalyticsEvent } from '../../server/src/analytics.js';

describe('analytics input', () => {
  it('accepts a minimal first-party page view and limits campaign fields', () => {
    const event = parseAnalyticsEvent({
      event_name: 'page_view',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/nosub/',
      referrer_host: 'example.com',
      utm_source: 'x'.repeat(200),
    });
    expect(event.eventName).toBe('page_view');
    expect(event.utmSource).toHaveLength(120);
  });

  it('accepts privacy-bounded extension activity events', () => {
    const event = parseAnalyticsEvent({
      event_id: '22222222-2222-4222-8222-222222222222',
      event_name: 'core_action_completed',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      video_session_id: '33333333-3333-4333-8333-333333333333',
      occurred_at: '2026-08-21T00:00:00.000Z',
      properties: { action: 'D', action_result: 'exit_loop', input_method: 'toolbar' },
      path: '/youtube/action',
      app_version: '0.3.1',
      environment: 'production',
      browser_language: 'zh-CN',
    });
    expect(event).toMatchObject({
      eventId: '22222222-2222-4222-8222-222222222222',
      eventName: 'core_action_completed', path: '/youtube/action', referrerHost: null,
      videoSessionId: '33333333-3333-4333-8333-333333333333',
      properties: { action: 'D', action_result: 'exit_loop', input_method: 'toolbar' },
      appVersion: '0.3.1', environment: 'production',
      browserLanguage: 'zh-CN',
    });
  });

  it('accepts Q as the focused-listening mode toggle', () => {
    const event = parseAnalyticsEvent({
      event_name: 'core_action_completed',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      video_session_id: '33333333-3333-4333-8333-333333333333',
      path: '/youtube/action',
      properties: {
        action: 'Q',
        action_result: 'enter_focused_listening',
        input_method: 'keyboard',
      },
    });
    expect(event.properties).toEqual({
      action: 'Q',
      action_result: 'enter_focused_listening',
      input_method: 'keyboard',
    });
  });

  it('rejects video events without a session ID and rejects unknown properties', () => {
    expect(() => parseAnalyticsEvent({
      event_name: 'youtube_video_opened',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/youtube/video',
    })).toThrow('Video session ID is required');
    expect(() => parseAnalyticsEvent({
      event_name: 'youtube_video_opened',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      video_session_id: '33333333-3333-4333-8333-333333333333',
      path: '/youtube/video',
      properties: { video_id: 'forbidden' },
    })).toThrow('Unsupported analytics property');
  });

  it('rejects a malformed browser language', () => {
    expect(() => parseAnalyticsEvent({
      event_name: 'youtube_opened',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/youtube/open',
      browser_language: 'not_a_language',
    })).toThrow('Invalid browser language');
  });

  it('rejects an unknown deployment environment', () => {
    expect(() => parseAnalyticsEvent({
      event_name: 'extension_installed',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/extension/install',
      environment: 'staging',
    })).toThrow('Invalid analytics environment');
  });

  it('rejects unsupported events and invalid visitor IDs', () => {
    expect(() => parseAnalyticsEvent({
      event_name: 'checkout_completed', anonymous_id: 'bad', path: '/',
    })).toThrow();
    expect(() => parseAnalyticsEvent({
      event_name: 'page_view', anonymous_id: 'bad', path: '/',
    })).toThrow('Invalid anonymous visitor ID');
  });
});
