import { describe, expect, it } from 'vitest';
import { parseAnalyticsEvent } from '../../server/src/analytics.js';

describe('pricing analytics input', () => {
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

  it('rejects unsupported events and invalid visitor IDs', () => {
    expect(() => parseAnalyticsEvent({
      event_name: 'checkout_completed', anonymous_id: 'bad', path: '/',
    })).toThrow();
    expect(() => parseAnalyticsEvent({
      event_name: 'page_view', anonymous_id: 'bad', path: '/',
    })).toThrow('Invalid anonymous visitor ID');
  });
});
