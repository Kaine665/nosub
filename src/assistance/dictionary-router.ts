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
import { WiktionaryEnProvider } from './providers/wiktionary-en-provider.js';
import { DictionaryServerProvider } from './providers/dictionary-server-provider.js';
import { IcibaZhProvider } from './providers/iciba-zh-provider.js';
import { YoudaoZhProvider } from './providers/youdao-zh-provider.js';
import { WiktionaryZhProvider } from './providers/wiktionary-zh-provider.js';

export type DictLocale = 'en' | 'zh_CN';

class CompositeProvider implements DefinitionProvider {
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

const serverEn = new DictionaryServerProvider('en');
const enLocalProvider = new WiktionaryEnProvider();
const enOnlineProvider = new DictionaryApiProvider();
const icibaZh = new IcibaZhProvider();
const youdaoZh = new YoudaoZhProvider();
const googleZh = new GoogleCnProvider();
const serverZh = new DictionaryServerProvider('zh_CN');
const localZh = new WiktionaryZhProvider();

const enPrimary: DefinitionProvider = new CompositeProvider([
  serverEn,
  enLocalProvider,
  enOnlineProvider,
]);

/** 中文：多源短义项，全部需过质量关卡（provider 内部已过滤） */
const zhPrimary: DefinitionProvider = new CompositeProvider([
  icibaZh,
  youdaoZh,
  googleZh,
  serverZh,
  localZh,
]);

export class DictionaryRouter {
  getProvider(locale: DictLocale): DefinitionProvider {
    if (locale === 'zh_CN') return zhPrimary;
    return enPrimary;
  }

  getReferenceProvider(): DefinitionProvider {
    return enPrimary;
  }
}
