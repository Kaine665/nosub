export type BackgroundFetchType = 'translate-fetch' | 'dict-fetch' | 'audio-fetch';

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
    'http://43.130.246.125:8899',
  ]),
  'audio-fetch': new Set([
    'https://api.dictionaryapi.dev',
    'https://translate.googleapis.com',
    'https://dict.youdao.com',
    'http://43.130.246.125:8899',
  ]),
};

/** 防止 content script 把后台消息通道变成任意 URL 代理。 */
export function isAllowedBackgroundFetch(type: BackgroundFetchType, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return false;
    return ALLOWED_ORIGINS[type].has(url.origin);
  } catch {
    return false;
  }
}
