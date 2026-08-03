/**
 * 通过 background service worker 代发跨域请求。
 * Content script 直连会被 YouTube 页面 CORS/CSP 挡住。
 */

export type ProxyFetchType = 'translate-fetch' | 'dict-fetch' | 'audio-fetch';

export interface ProxyFetchResult {
  ok: boolean;
  status: number;
  body: unknown;
  contentType?: string;
  error?: string;
}

export function proxyFetch(
  type: ProxyFetchType,
  url: string,
  timeoutMs = 5000,
): Promise<ProxyFetchResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, status: 0, body: null, error: 'timeout' }),
      timeoutMs,
    );
    try {
      chrome.runtime.sendMessage(
        { type, url },
        (resp: ProxyFetchResult | undefined) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp) {
            resolve({
              ok: false,
              status: 0,
              body: null,
              error: chrome.runtime.lastError?.message ?? 'no response',
            });
            return;
          }
          resolve(resp);
        },
      );
    } catch (err) {
      clearTimeout(timer);
      resolve({ ok: false, status: 0, body: null, error: (err as Error).message });
    }
  });
}
