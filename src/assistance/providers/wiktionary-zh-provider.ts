/**
 * 本地 Wiktionary 英中词典 Provider。
 * 数据源: kaikki.org Wiktionary JSONL → build-dict-wiktionary.py → dict-zh.json
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('dict-wikt');

interface CompactEntry {
  p?: string;
  d: string[];
  c: string[];
  e: string[];
  i?: string;
}

export class WiktionaryZhProvider implements DefinitionProvider {
  readonly name = 'wiktionary-zh';
  readonly language = 'zh_CN';
  private dict: Record<string, CompactEntry> | null = null;
  private loading: Promise<void> | null = null;

  async lookup(word: string): Promise<DefinitionResult | null> {
    const dict = await this.loadDict();
    if (!dict) return null;

    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    const entry = dict[clean];
    if (!entry) return null;

    // 把中文翻译当作"释义"，例句挂到对应义项
    const examples = entry.e ?? [];
    const entries: DefinitionEntry[] = [];
    for (let i = 0; i < entry.c.slice(0, 5).length; i++) {
      const cn = entry.c[i];
      entries.push({
        partOfSpeech: entry.p ?? '',
        definition: cn,
        example: examples[i],
      });
    }
    for (let i = entry.c.slice(0, 5).length; i < Math.min(examples.length, 3); i++) {
      entries.push({
        partOfSpeech: entry.p ?? '',
        definition: '',
        example: examples[i],
      });
    }

    return {
      language: 'zh_CN',
      entries: entries.length > 0 ? entries : [{
        partOfSpeech: entry.p ?? '',
        definition: entry.c[0] ?? '',
        example: examples[0],
      }],
    };
  }

  private async loadDict(): Promise<Record<string, CompactEntry> | null> {
    if (this.dict) return this.dict;
    if (this.loading) { await this.loading; return this.dict; }

    this.loading = (async () => {
      try {
        // 从扩展内置资源加载 (public/dict-zh.json)
        const url = chrome.runtime.getURL('public/dict-zh.json');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        this.dict = await resp.json();
        log.info('Wiktionary 中文字典已加载:', Object.keys(this.dict!).length, '词');
      } catch (err) {
        log.warn('Wiktionary 中文字典加载失败:', (err as Error).message);
        this.dict = {};
      }
    })();

    await this.loading;
    return this.dict;
  }
}
