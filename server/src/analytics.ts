export interface AnalyticsEventInput {
  eventName: 'page_view' | 'extension_installed' | 'nosub_started' | 'youtube_opened'
    | 'listening_started' | 'subtitle_translation_used' | 'google_signed_in';
  anonymousId: string;
  path: string;
  appVersion: string | null;
  environment: 'production' | 'development' | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

const ANALYTICS_EVENT_NAMES = new Set<AnalyticsEventInput['eventName']>([
  'page_view', 'extension_installed', 'nosub_started', 'youtube_opened',
  'listening_started', 'subtitle_translation_used', 'google_signed_in',
]);

export function parseAnonymousId(value: unknown): string {
  const anonymousId = typeof value === 'string' ? value : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(anonymousId)) {
    throw new Error('Invalid anonymous visitor ID.');
  }
  return anonymousId;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Invalid analytics field.');
  return value.trim().slice(0, max) || null;
}

export function parseAnalyticsEvent(body: Record<string, unknown>): AnalyticsEventInput {
  if (typeof body.event_name !== 'string' || !ANALYTICS_EVENT_NAMES.has(
    body.event_name as AnalyticsEventInput['eventName'],
  )) throw new Error('Unsupported analytics event.');
  const eventName = body.event_name as AnalyticsEventInput['eventName'];
  const anonymousId = parseAnonymousId(body.anonymous_id);
  const path = optionalText(body.path, 300);
  if (!path || !path.startsWith('/')) throw new Error('Invalid page path.');
  const appVersion = optionalText(body.app_version, 40);
  const environment = optionalText(body.environment, 20);
  if (environment !== null && environment !== 'production' && environment !== 'development') {
    throw new Error('Invalid analytics environment.');
  }
  return {
    eventName, anonymousId, path,
    appVersion,
    environment,
    referrerHost: optionalText(body.referrer_host, 255),
    utmSource: optionalText(body.utm_source, 120),
    utmMedium: optionalText(body.utm_medium, 120),
    utmCampaign: optionalText(body.utm_campaign, 160),
  };
}
