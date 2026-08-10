/**
 * DictionaryRouter —— 按语种选择词典 Provider。
 *
 * 中文释义优先级（质量优先）:
 *   金山短义项 → 有道简明 → Google 短译
 * Wiktionary / 自建 ZH 大词库噪声太多，不再作为中文主路径。
 */

import type { DefinitionProvider, DefinitionResult } from './definition-provider.js';
import { DictionaryApiProvider } from './providers/dictionary-api-provider.js';
import { GoogleCnProvider } from './providers/google-cn-provider.js';
import { DictionaryServerProvider } from './providers/dictionary-server-provider.js';
import { IcibaZhProvider } from './providers/iciba-zh-provider.js';
import { YoudaoZhProvider } from './providers/youdao-zh-provider.js';
import type { UserSettings } from '../shared/types.js';

export type DictLocale = 'en' | 'zh_CN';

export class CompositeProvider implements DefinitionProvider {
  readonly name: string;
  readonly language: string;
  private chain: DefinitionProvider[];

  constructor(chain: DefinitionProvider[]) {
    this.chain = chain.filter(Boolean);
    this.name = this.chain[0]?.name ?? 'empty';
    this.language = this.chain[0]?.language ?? 'en';
  }

  async lookup(word: string): Promise<DefinitionResult | null> {
    for (const p of this.chain) {
      const result = await p.lookup(word).catch(() => null);
      if (result?.entries?.length) return result;
    }
    return null;
  }
}

export class DictionaryRouter {
  private readonly enPrimary: DefinitionProvider;
  private readonly zhPrimary: DefinitionProvider;

  constructor(source: UserSettings['dictionarySource'] = 'public') {
    const serverEn = new DictionaryServerProvider('en');
    const serverZh = new DictionaryServerProvider('zh_CN');

    this.enPrimary = new CompositeProvider(source === 'public'
      ? [new DictionaryApiProvider(), serverEn]
      : [serverEn]);

    // Public Chinese dictionaries are tried in quality order. The NoSub
    // server is the final fallback, or the only source in server-only mode.
    this.zhPrimary = new CompositeProvider(source === 'public'
      ? [new IcibaZhProvider(), new YoudaoZhProvider(), new GoogleCnProvider(), serverZh]
      : [serverZh]);
  }

  getProvider(locale: DictLocale): DefinitionProvider {
    if (locale === 'zh_CN') return this.zhPrimary;
    return this.enPrimary;
  }

  getReferenceProvider(): DefinitionProvider {
    return this.enPrimary;
  }
}
