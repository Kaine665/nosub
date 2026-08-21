import { getAnonymousId } from './anonymous-identity.js';

const API_URL = 'https://api-nosub.43-130-246-125.sslip.io';

export type ExtensionAnalyticsEventName =
  | 'extension_installed'
  | 'youtube_video_opened'
  | 'caption_load_succeeded'
  | 'caption_load_failed'
  | 'listening_session_started'
  | 'core_action_completed'
  | 'google_signed_in';

export type AnalyticsEventProperties = Record<string, string>;

export interface ExtensionAnalyticsEvent {
  eventId: string;
  eventName: ExtensionAnalyticsEventName;
  occurredAt: string;
  videoSessionId?: string;
  properties?: AnalyticsEventProperties;
}

const EVENT_PATHS: Record<ExtensionAnalyticsEventName, string> = {
  extension_installed: '/extension/install',
  youtube_video_opened: '/youtube/video',
  caption_load_succeeded: '/youtube/captions/success',
  caption_load_failed: '/youtube/captions/failure',
  listening_session_started: '/youtube/listening',
  core_action_completed: '/youtube/action',
  google_signed_in: '/account/google',
};

export function createExtensionAnalyticsEvent(
  eventName: ExtensionAnalyticsEventName,
  details: Omit<Partial<ExtensionAnalyticsEvent>, 'eventName'> = {},
): ExtensionAnalyticsEvent {
  return {
    eventId: details.eventId ?? crypto.randomUUID(),
    eventName,
    occurredAt: details.occurredAt ?? new Date().toISOString(),
    ...(details.videoSessionId ? { videoSessionId: details.videoSessionId } : {}),
    ...(details.properties ? { properties: details.properties } : {}),
  };
}

export async function trackExtensionEvent(
  eventName: ExtensionAnalyticsEventName,
  details: Omit<Partial<ExtensionAnalyticsEvent>, 'eventName'> = {},
): Promise<void> {
  const event = createExtensionAnalyticsEvent(eventName, details);
  const anonymousId = await getAnonymousId();
  const response = await fetch(`${API_URL}/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: event.eventId,
      event_name: event.eventName,
      anonymous_id: anonymousId,
      path: EVENT_PATHS[event.eventName],
      occurred_at: event.occurredAt,
      video_session_id: event.videoSessionId,
      properties: event.properties,
      app_version: chrome.runtime.getManifest().version,
      environment: import.meta.env.DEV ? 'development' : 'production',
      browser_language: navigator.language,
    }),
  });
  if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
}
