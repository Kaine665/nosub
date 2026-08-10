/**
 * 本地 Wiktionary EN 词典 Provider。
 * 1.35M 词条, 230MB JSON / 72MB gzip。
 * fetch 自动处理 gzip 解压。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('dict-wikt-en');

interface CompactEntry {
  p?: string;
  d: string[];
  e: string[];
  i?: string;
}

export class WiktionaryEnProvider implements DefinitionProvider {
  readonly name = 'wiktionary-en';
  readonly language = 'en';
  private dict: Record<string, CompactEntry> | null = null;
  private loading: Promise<void> | null = null;

  async lookup(word: string): Promise<DefinitionResult | null> {
    const dict = await this.loadDict();
    if (!dict) return null;

    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    const entry = dict[clean];
    if (!entry) return null;

    const examples = entry.e ?? [];
    const entries: DefinitionEntry[] = [];
    for (let i = 0; i < entry.d.slice(0, 8).length; i++) {
      const def = entry.d[i];
      entries.push({
        partOfSpeech: entry.p ?? '',
        definition: def,
        example: examples[i],
      });
    }
    for (let i = entry.d.slice(0, 8).length; i < Math.min(examples.length, 3); i++) {
      entries.push({
        partOfSpeech: entry.p ?? '',
        definition: '',
        example: examples[i],
      });
    }

    return {
      language: 'en',
      entries: entries.length > 0 ? entries : [{
        partOfSpeech: entry.p ?? '',
        definition: entry.d[0] ?? '',
        example: examples[0],
      }],
    };
  }

  private async loadDict(): Promise<Record<string, CompactEntry> | null> {
    if (this.dict) return this.dict;
    if (this.loading) { await this.loading; return this.dict; }

    this.loading = (async () => {
      try {
        const url = chrome.runtime.getURL('public/dict-en-core.json');
        log.info('加载 EN 词典...');
        const t0 = performance.now();

        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        // Decompress gzip → JSON (230MB decompressed, 72MB on disk)
        const ds = new DecompressionStream('gzip');
        const decompressed = await new Response(
          resp.body!.pipeThrough(ds)
        ).text();
        this.dict = JSON.parse(decompressed);

        const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
        log.info(`EN 词典就绪: ${Object.keys(this.dict!).length.toLocaleString()} 词 (${elapsed}s)`);
      } catch (err) {
        log.warn('EN 词典加载失败:', (err as Error).message);
        this.dict = {};
      }
    })();

    await this.loading;
    return this.dict;
  }
}
