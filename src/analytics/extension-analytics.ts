import { getAnonymousId } from './anonymous-identity.js';

const API_URL = 'https://api-nosub.43-130-246-125.sslip.io';

export type ExtensionAnalyticsEventName =
  | 'extension_installed'
  | 'youtube_opened'
  | 'listening_started'
  | 'subtitle_translation_used'
  | 'google_signed_in';

const EVENT_PATHS: Record<ExtensionAnalyticsEventName, string> = {
  extension_installed: '/extension/install',
  youtube_opened: '/youtube/open',
  listening_started: '/youtube/listening',
  subtitle_translation_used: '/youtube/translation',
  google_signed_in: '/account/google',
};

export async function trackExtensionEvent(eventName: ExtensionAnalyticsEventName): Promise<void> {
  const anonymousId = await getAnonymousId();
  const response = await fetch(`${API_URL}/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_name: eventName,
      anonymous_id: anonymousId,
      path: EVENT_PATHS[eventName],
      app_version: chrome.runtime.getManifest().version,
      environment: import.meta.env.DEV ? 'development' : 'production',
    }),
  });
  if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
}
