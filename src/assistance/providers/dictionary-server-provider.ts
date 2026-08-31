/**
 * 自建词典后端 Provider —— 日本服务器, 保证每个词返回标准结构。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { buildCleanZhLines } from '../zh-gloss-quality.js';
import { logger } from '../../shared/logger.js';
import { proxyFetch } from '../../shared/proxy-fetch.js';

const log = logger.createLogger('dict-server');
const SERVER = 'https://api-nosub.43-130-246-125.sslip.io/dictionary';

export class DictionaryServerProvider implements DefinitionProvider {
  readonly name = 'nosub-server';
  readonly language: string;

  constructor(lang: string) {
    // 'zh' | 'zh_CN' → zh API；其它走 en
    this.language = lang === 'zh' || lang === 'zh_CN' ? 'zh' : 'en';
  }

  async lookup(word: string): Promise<DefinitionResult | null> {
    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!clean || clean.length < 2) return null;

    try {
      const resp = await proxyFetch(
        'dict-fetch',
        `${SERVER}/word/${this.language}/${encodeURIComponent(clean)}`,
        5500,
      );
      if (!resp.ok || !resp.body) return null;

      const data = resp.body as {
        word: string; pos: string; defs: string[]; examples: string[]; ipa: string;
      };
      if (!data?.defs?.length) return null;

      const examples = data.examples ?? [];
      let entries: DefinitionEntry[] = data.defs.map((d, i) => ({
        partOfSpeech: data.pos || '',
        definition: d,
        // 把例句按序挂到各义项；多余例句挂在第一条，保证 UI 能收到
        example: examples[i] ?? (i === 0 && examples.length ? examples[0] : undefined),
      }));
      if (this.language === 'zh') {
        const lines = buildCleanZhLines(entries.map((entry) => ({
          pos: entry.partOfSpeech,
          definition: entry.definition,
        })));
        if (!lines.length) return null;
        entries = lines.map((line, i) => ({
          partOfSpeech: line.pos,
          definition: line.text,
          example: examples[i],
        }));
      }
      // 若义项少于例句，补挂剩余例句（空 definition 不会显示，但 example 会被收集）
      for (let i = entries.length; i < examples.length; i++) {
        entries.push({
          partOfSpeech: data.pos || '',
          definition: '',
          example: examples[i],
        });
      }

      const phonetic = data.ipa?.trim() || undefined;
      return {
        language: this.language,
        entries,
        phonetic,
        phoneticUK: phonetic,
        phoneticUS: phonetic,
      };
    } catch (err) {
      log.debug('server lookup failed:', (err as Error).message);
      return null;
    }
  }
}
