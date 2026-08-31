export type BackgroundFetchType = 'translate-fetch' | 'dict-fetch' | 'audio-fetch';

const NOSUB_API_ORIGIN = 'https://api-nosub.43-130-246-125.sslip.io';

const ALLOWED_ORIGINS: Record<BackgroundFetchType, ReadonlySet<string>> = {
  'translate-fetch': new Set([
    'https://translate.googleapis.com',
  ]),
  'dict-fetch': new Set([
    'https://api.dictionaryapi.dev',
    'https://tatoeba.org',
    'https://dict.youdao.com',
    'https://dict-mobile.iciba.com',
    'https://translate.googleapis.com',
    'https://api-nosub.43-130-246-125.sslip.io',
  ]),
  'audio-fetch': new Set([
    'https://api.dictionaryapi.dev',
    'https://translate.googleapis.com',
    'https://dict.youdao.com',
    'https://api-nosub.43-130-246-125.sslip.io',
  ]),
};

/** 防止 content script 把后台消息通道变成任意 URL 代理。 */
export function isAllowedBackgroundFetch(type: BackgroundFetchType, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return false;
    if (url.origin === NOSUB_API_ORIGIN) {
      if (type === 'dict-fetch') return /^\/dictionary\/word\/(?:en|zh)\/[a-zA-Z%'-]+$/.test(url.pathname);
      if (type === 'audio-fetch') return /^\/dictionary\/audio\/[a-zA-Z%'-]+$/.test(url.pathname);
      return false;
    }
    return ALLOWED_ORIGINS[type].has(url.origin);
  } catch {
    return false;
  }
}
