export interface AnalyticsEventInput {
  eventName: 'page_view';
  anonymousId: string;
  path: string;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Invalid analytics field.');
  return value.trim().slice(0, max) || null;
}

export function parseAnalyticsEvent(body: Record<string, unknown>): AnalyticsEventInput {
  if (body.event_name !== 'page_view') throw new Error('Unsupported analytics event.');
  const anonymousId = typeof body.anonymous_id === 'string' ? body.anonymous_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anonymousId)) {
    throw new Error('Invalid anonymous visitor ID.');
  }
  const path = optionalText(body.path, 300);
  if (!path || !path.startsWith('/')) throw new Error('Invalid page path.');
  return {
    eventName: 'page_view', anonymousId, path,
    referrerHost: optionalText(body.referrer_host, 255),
    utmSource: optionalText(body.utm_source, 120),
    utmMedium: optionalText(body.utm_medium, 120),
    utmCampaign: optionalText(body.utm_campaign, 160),
  };
}
