/**
 * GoogleTranslateProvider —— 使用 Google Translate 免费端点。
 *
 * 关键: content script 直连 translate.googleapis.com 会被 CORS 挡。
 * 走 background service worker 代发(MV3 扩展请求不受同源策略限制)。
 */

import type { TranslationProvider, TranslationRequest, TranslationResult } from '../translation-service.js';
import { proxyFetch } from '../../shared/proxy-fetch.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('translate:google');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TIMEOUT_MS = 5000;

/**
 * 经 SW 代理，避免 content script 回退直连时触发 YouTube 页面 CORS。
 */
async function resilientFetch(url: string): Promise<{ ok: boolean; body: unknown | null; status: number }> {
  try {
    return await proxyFetch('translate-fetch', url, TIMEOUT_MS);
  } catch {
    return { ok: false, body: null, status: 0 };
  }
}

export class GoogleTranslateProvider implements TranslationProvider {
  readonly name = 'google';

  async isAvailable(): Promise<boolean> {
    try {
      const params = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'zh-CN', dt: 't', q: 'hi' });
      const resp = await resilientFetch(`${ENDPOINT}?${params}`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async translate(request: TranslationRequest): Promise<TranslationResult | null> {
    const { text, sourceLanguage: sl, targetLanguage: tl } = request;
    if (!text.trim()) return null;

    try {
      const params = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't', q: text });
      const resp = await resilientFetch(`${ENDPOINT}?${params}`);

      if (!resp.ok || !resp.body) {
        log.warn('translate failed: status', resp.status);
        return null;
      }

      // Google Translate 返回的是文本,需要 parse
      const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
      // 格式: [[["翻译","原文",...],...], null, sl, ...]
      const sentences = (data as unknown[][])[0] as unknown[][];
      if (!Array.isArray(sentences)) return null;

      const translated = sentences
        .map((s) => s?.[0])
        .filter((s): s is string => typeof s === 'string')
        .join('');

      if (!translated) return null;

      return { translatedText: translated, service: this.name };
    } catch (err) {
      log.warn('translate error:', (err as Error).message);
      return null;
    }
  }
}
