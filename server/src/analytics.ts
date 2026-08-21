import { randomUUID } from 'node:crypto';

type AnalyticsEventName =
  | 'page_view'
  | 'extension_installed'
  | 'nosub_started'
  | 'youtube_opened'
  | 'listening_started'
  | 'subtitle_translation_used'
  | 'google_signed_in'
  | 'youtube_video_opened'
  | 'caption_load_succeeded'
  | 'caption_load_failed'
  | 'listening_session_started'
  | 'core_action_completed';

export interface AnalyticsEventInput {
  eventId: string;
  eventName: AnalyticsEventName;
  anonymousId: string;
  videoSessionId: string | null;
  occurredAt: Date;
  properties: Record<string, string>;
  path: string;
  appVersion: string | null;
  environment: 'production' | 'development' | null;
  browserLanguage: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

const ANALYTICS_EVENT_NAMES = new Set<AnalyticsEventInput['eventName']>([
  'page_view', 'extension_installed', 'nosub_started', 'youtube_opened',
  'listening_started', 'subtitle_translation_used', 'google_signed_in',
  'youtube_video_opened', 'caption_load_succeeded', 'caption_load_failed',
  'listening_session_started', 'core_action_completed',
]);

const VIDEO_EVENTS = new Set<AnalyticsEventName>([
  'youtube_video_opened', 'caption_load_succeeded', 'caption_load_failed',
  'listening_session_started', 'core_action_completed',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAnonymousId(value: unknown): string {
  const anonymousId = typeof value === 'string' ? value : '';
  if (!UUID_PATTERN.test(anonymousId)) {
    throw new Error('Invalid anonymous visitor ID.');
  }
  return anonymousId;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function occurredAt(value: unknown): Date {
  if (value === undefined || value === null || value === '') return new Date();
  if (typeof value !== 'string') throw new Error('Invalid analytics occurrence time.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) {
    throw new Error('Invalid analytics occurrence time.');
  }
  return date;
}

function eventProperties(eventName: AnalyticsEventName, value: unknown): Record<string, string> {
  const raw = value === undefined || value === null ? {} : value;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid analytics properties.');
  const input = raw as Record<string, unknown>;
  const allowed = eventName === 'caption_load_succeeded'
    ? new Set(['caption_language', 'caption_type'])
    : eventName === 'caption_load_failed'
      ? new Set(['failure_reason'])
      : eventName === 'core_action_completed'
        ? new Set(['action', 'action_result', 'input_method'])
        : new Set<string>();
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error('Unsupported analytics property.');
  const properties = Object.fromEntries(Object.entries(input).map(([key, item]) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 40) {
      throw new Error('Invalid analytics property.');
    }
    return [key, item];
  }));
  if (eventName === 'caption_load_succeeded') {
    if (!properties.caption_language || !['manual', 'automatic'].includes(properties.caption_type)) {
      throw new Error('Invalid caption success properties.');
    }
  } else if (eventName === 'caption_load_failed') {
    if (!['metadata_timeout', 'no_usable_tracks', 'track_load_failed', 'empty_track']
      .includes(properties.failure_reason)) throw new Error('Invalid caption failure reason.');
  } else if (eventName === 'core_action_completed') {
    const validResults: Record<string, string[]> = {
      A: ['repeat_current', 'previous_cue'],
      S: ['show_original', 'show_translation', 'hide_subtitles'],
      D: ['next_cue', 'exit_loop'],
    };
    if (!validResults[properties.action]?.includes(properties.action_result)
      || !['keyboard', 'toolbar'].includes(properties.input_method)) {
      throw new Error('Invalid core action properties.');
    }
  }
  return properties;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Invalid analytics field.');
  return value.trim().slice(0, max) || null;
}

function browserLanguage(value: unknown): string | null {
  const language = optionalText(value, 35);
  if (!language) return null;
  try {
    return new Intl.Locale(language).toString();
  } catch {
    throw new Error('Invalid browser language.');
  }
}

export function parseAnalyticsEvent(body: Record<string, unknown>): AnalyticsEventInput {
  if (typeof body.event_name !== 'string' || !ANALYTICS_EVENT_NAMES.has(
    body.event_name as AnalyticsEventInput['eventName'],
  )) throw new Error('Unsupported analytics event.');
  const eventName = body.event_name as AnalyticsEventInput['eventName'];
  const eventId = optionalUuid(body.event_id, 'analytics event ID') ?? randomUUID();
  const anonymousId = parseAnonymousId(body.anonymous_id);
  const videoSessionId = optionalUuid(body.video_session_id, 'video session ID');
  if (VIDEO_EVENTS.has(eventName) && !videoSessionId) throw new Error('Video session ID is required.');
  const path = optionalText(body.path, 300);
  if (!path || !path.startsWith('/')) throw new Error('Invalid page path.');
  const appVersion = optionalText(body.app_version, 40);
  const environment = optionalText(body.environment, 20);
  if (environment !== null && environment !== 'production' && environment !== 'development') {
    throw new Error('Invalid analytics environment.');
  }
  return {
    eventId, eventName, anonymousId, videoSessionId,
    occurredAt: occurredAt(body.occurred_at),
    properties: eventProperties(eventName, body.properties),
    path,
    appVersion,
    environment,
    browserLanguage: browserLanguage(body.browser_language),
    referrerHost: optionalText(body.referrer_host, 255),
    utmSource: optionalText(body.utm_source, 120),
    utmMedium: optionalText(body.utm_medium, 120),
    utmCampaign: optionalText(body.utm_campaign, 160),
  };
}
