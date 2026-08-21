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
      event_name: 'listening_started',
      anonymous_id: '11111111-1111-4111-8111-111111111111',
      path: '/youtube/listening',
      app_version: '0.3.1',
      environment: 'production',
      browser_language: 'zh-CN',
    });
    expect(event).toMatchObject({
      eventName: 'listening_started', path: '/youtube/listening', referrerHost: null,
      appVersion: '0.3.1', environment: 'production',
      browserLanguage: 'zh-CN',
    });
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
