const ANONYMOUS_ID_KEY = 'nosub-anonymous-id-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let pendingAnonymousId: Promise<string> | null = null;

async function loadOrCreateAnonymousId(): Promise<string> {
  const stored = await chrome.storage.local.get(ANONYMOUS_ID_KEY);
  const existing = stored[ANONYMOUS_ID_KEY];
  if (typeof existing === 'string' && UUID_PATTERN.test(existing)) return existing;

  const created = crypto.randomUUID();
  await chrome.storage.local.set({ [ANONYMOUS_ID_KEY]: created });
  return created;
}

/** Stable for this Chrome extension installation and removed when extension storage is cleared. */
export function getAnonymousId(): Promise<string> {
  pendingAnonymousId ??= loadOrCreateAnonymousId();
  return pendingAnonymousId;
}
