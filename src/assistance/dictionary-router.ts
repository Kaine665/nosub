/**
 * DictionaryRouter —— 按语种选择词典 Provider。
 *
 * 中文释义优先级（稳定性优先）:
 *   NoSub 本地词库 → 金山短义项 → 有道简明 → Google 短译
 * NoSub 词库由服务器统一输出并经客户端质量过滤。
 */

import type { DefinitionProvider, DefinitionResult } from './definition-provider.js';
import { DictionaryApiProvider } from './providers/dictionary-api-provider.js';
import { DictionaryServerProvider } from './providers/dictionary-server-provider.js';
import { IcibaZhProvider } from './providers/iciba-zh-provider.js';
import { YoudaoZhProvider } from './providers/youdao-zh-provider.js';
import type { UserSettings } from '../shared/types.js';

export type DictLocale = 'en' | 'zh_CN';

function isChinese(language: string): boolean {
  return language.toLowerCase().replace('_', '-').startsWith('zh');
}

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
      ? [serverEn, new DictionaryApiProvider()]
      : [serverEn]);

    // Public Chinese dictionaries remain fallbacks when NoSub has no entry.
    this.zhPrimary = new CompositeProvider(source === 'public'
      ? [serverZh, new IcibaZhProvider(), new YoudaoZhProvider()]
      : [serverZh]);
  }

  getProvider(locale: DictLocale): DefinitionProvider {
    if (locale === 'zh_CN') return this.zhPrimary;
    return this.enPrimary;
  }

  getReferenceProvider(): DefinitionProvider {
    return this.enPrimary;
  }

  /** 返回原生双语词典；null 表示该语言应使用英文释义机器翻译兜底。 */
  getNativeProvider(language: string): DefinitionProvider | null {
    if (language.toLowerCase().startsWith('en')) return this.enPrimary;
    if (isChinese(language)) return this.zhPrimary;
    return null;
  }
}
