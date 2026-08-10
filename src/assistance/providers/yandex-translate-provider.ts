/**
 * YandexTranslateProvider —— Yandex 翻译。
 *
 * 免费额度: 每月 100 万字, 需注册 API Key。
 * https://translate.yandex.com/developers/keys
 *
 * ⚠️ 待实现: 俄罗斯用户可验证此 Provider。
 */

import type { TranslationProvider, TranslationRequest, TranslationResult } from '../translation-service.js';

export class YandexTranslateProvider implements TranslationProvider {
  readonly name = 'yandex';

  private apiKey: string | null = null;

  setApiKey(key: string): void { this.apiKey = key; }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async translate(_request: TranslationRequest): Promise<TranslationResult | null> {
    // TODO: 实现 Yandex 翻译 API 调用
    // POST https://translate.api.cloud.yandex.net/translate/v2/translate
    // Header: Authorization: Api-Key {key}
    // Body: { sourceLanguageCode, targetLanguageCode, texts }
    return null;
  }
}
