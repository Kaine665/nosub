/**
 * BaiduTranslateProvider —— 百度翻译。
 *
 * 免费额度: 标准版每月 200 万字, 需注册 API Key。
 * https://fanyi-api.baidu.com/api/trans/product/desktop
 */

import type { TranslationProvider, TranslationRequest, TranslationResult } from '../translation-service.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('translate:baidu');

const ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
const TIMEOUT_MS = 5000;

/** 语言代码映射: nosub → 百度 */
const LANG_MAP: Record<string, string> = {
  'en': 'en', 'zh-CN': 'zh', 'zh': 'zh',
  'ja': 'jp', 'ko': 'kor', 'fr': 'fra', 'de': 'de',
  'es': 'spa', 'ru': 'ru', 'pt': 'pt', 'it': 'it',
  'ar': 'ara', 'th': 'th', 'vi': 'vie', 'nl': 'nl',
  'id': 'id', 'hi': 'hi', 'uk': 'uk', 'tr': 'tr',
};

export class BaiduTranslateProvider implements TranslationProvider {
  readonly name = 'baidu';

  private get appId(): string | null {
    return this.storage?.appId ?? null;
  }
  private get secretKey(): string | null {
    return this.storage?.secretKey ?? null;
  }

  /** 由外部注入存储读取(避免 provider 直接依赖 chrome.storage) */
  private storage: { appId: string; secretKey: string } | null = null;

  setCredentials(appId: string, secretKey: string): void {
    this.storage = { appId, secretKey };
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.appId && this.secretKey);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult | null> {
    const { text, sourceLanguage: sl, targetLanguage: tl } = request;
    if (!this.appId || !this.secretKey || !text.trim()) return null;

    const from = LANG_MAP[sl] ?? sl;
    const to = LANG_MAP[tl] ?? tl;
    const salt = String(Date.now());
    const sign = await this.md5(`${this.appId}${text}${salt}${this.secretKey}`);

    const params = new URLSearchParams({
      q: text, from, to, appid: this.appId, salt, sign,
    });

    try {
      const resp = await fetch(`${ENDPOINT}?${params.toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        log.warn('Baidu translate failed: HTTP', resp.status);
        return null;
      }

      const data = (await resp.json()) as {
        error_code?: string;
        trans_result?: Array<{ dst: string }>;
      };

      if (data.error_code) {
        log.warn('Baidu translate error:', data.error_code);
        return null;
      }

      const translated = data.trans_result?.map(r => r.dst).join('') ?? '';
      if (!translated) return null;

      return { translatedText: translated, service: this.name };
    } catch (err) {
      log.warn('Baidu translate network error:', (err as Error).message);
      return null;
    }
  }

  /** 生成百度签名: MD5(appId + text + salt + secretKey) */
  private md5(input: string): Promise<string> {
    return Promise.resolve(md5Hex(input));
  }
}

/** MD5 实现 (Web Crypto 不支持, 手写一个兼容版) */
function md5Hex(str: string): string {
  function rotateLeft(n: number, s: number) { return (n << s) | (n >>> (32 - s)); }
  function addUnsigned(x: number, y: number) { const lsw = (x & 0xffff) + (y & 0xffff); const msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }

  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K: number[] = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  const msg = new TextEncoder().encode(str);
  const msgLen = msg.length;
  const paddedLen = (((msgLen + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msgLen] = 0x80;
  const bitsLen = msgLen * 8;
  for (let i = 0; i < 8; i++) padded[paddedLen - 8 + i] = bitsLen >>> (i * 8);

  let [a, b, c, d] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let i = 0; i < paddedLen; i += 64) {
    const M = new Uint32Array(padded.buffer.slice(i, i + 64));
    let [A, B, C, D] = [a, b, c, d];

    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) { f = (B & C) | (~B & D); g = j; }
      else if (j < 32) { f = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { f = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { f = C ^ (B | ~D); g = (7 * j) % 16; }
      const temp = D;
      D = C; C = B;
      B = addUnsigned(B, rotateLeft(addUnsigned(addUnsigned(addUnsigned(A, f), K[j]), M[g]), S[j]));
      A = temp;
    }
    a = addUnsigned(a, A); b = addUnsigned(b, B);
    c = addUnsigned(c, C); d = addUnsigned(d, D);
  }

  const hex = (x: number) => x.toString(16).padStart(8, '0');
  return hex(a) + hex(b) + hex(c) + hex(d);
}
