/**
 * fetch 轻量封装 —— 比 axios 小 100 倍, 够用。
 */

export interface FetchOptions {
  timeoutMs?: number;
}

/**
 * 带超时的 fetch。
 * 成功返回 Response, 失败(网络/超时/非 2xx)返回 null。
 * 不做 SW 代理 —— content script 有 host_permissions 直接 fetch 即可。
 */
export async function safeFetch(url: string, opts: FetchOptions = {}): Promise<Response | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    return resp.ok ? resp : null;
  } catch {
    return null;
  }
}

/** safeFetch + json, 失败返回 null */
export async function fetchJSON<T = unknown>(url: string, opts?: FetchOptions): Promise<T | null> {
  const resp = await safeFetch(url, opts);
  if (!resp) return null;
  try { return (await resp.json()) as T; } catch { return null; }
}

/** safeFetch + text, 失败返回 null */
export async function fetchText(url: string, opts?: FetchOptions): Promise<string | null> {
  const resp = await safeFetch(url, opts);
  if (!resp) return null;
  try { return await resp.text(); } catch { return null; }
}
