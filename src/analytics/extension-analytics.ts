import { getAnonymousId } from './anonymous-identity.js';

const API_URL = 'https://api-nosub.43-130-246-125.sslip.io';

export type ExtensionAnalyticsEventName = 'extension_installed' | 'nosub_started';

const EVENT_PATHS: Record<ExtensionAnalyticsEventName, string> = {
  extension_installed: '/extension/install',
  nosub_started: '/youtube/watch',
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
    }),
  });
  if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
}
