/**
 * Google 释义翻译兜底。
 * 仅在目标语言没有原生双语词典时，把英文词典释义翻成第二语言。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { buildCleanZhLines } from '../zh-gloss-quality.js';
import { logger } from '../../shared/logger.js';
import { proxyFetch } from '../../shared/proxy-fetch.js';

const log = logger.createLogger('dict-cn');
const API = 'https://translate.googleapis.com/translate_a/single';

async function translateText(text: string, targetLanguage: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      client: 'gtx', sl: 'en', tl: targetLanguage, dt: 't', q: text,
    });
    const url = `${API}?${params.toString()}`;
    const resp = await proxyFetch('dict-fetch', url, 5500);
    if (!resp.ok || !resp.body) return null;
    const data = typeof resp.body === 'string'
      ? JSON.parse(resp.body) as unknown[][]
      : resp.body as unknown[][];
    return ((data[0] as Array<[string]> | undefined) ?? [])
      .map((x) => x[0])
      .join('')
      .trim() || null;
  } catch {
    return null;
  }
}

export class GoogleCnProvider implements DefinitionProvider {
  readonly name = 'google-definition-fallback';
  readonly language: string;

  constructor(targetLanguage = 'zh-CN') {
    this.language = targetLanguage;
  }

  async translate(enResult: DefinitionResult): Promise<DefinitionResult | null> {
    const sources = enResult.entries.slice(0, 5);
    if (!sources.length) return null;

    try {
      const SEP = '\n---\n';
      const joined = sources.map((e) => e.definition).join(SEP);
      const translated = await translateText(joined, this.language);
      if (!translated) return null;

      const translatedParts = translated.split(/[-–—]{2,}/).map((s) => s.trim()).filter(Boolean);
      const raw = sources
        .slice(0, translatedParts.length)
        .map((e, i) => ({ pos: e.partOfSpeech, definition: translatedParts[i] }));
      if (!raw.length) return null;

      const entries: DefinitionEntry[] = this.language.toLowerCase().startsWith('zh')
        ? buildCleanZhLines(raw).map((line, i) => ({
            partOfSpeech: line.pos || sources[i]?.partOfSpeech || '',
            definition: line.text,
            example: sources[i]?.example,
          }))
        : raw.map((entry, i) => ({
            partOfSpeech: entry.pos,
            definition: entry.definition,
            example: sources[i]?.example,
          }));
      if (!entries.length) return null;

      return { language: this.language, entries };
    } catch (err) {
      log.debug('CN translate failed:', (err as Error).message);
      return null;
    }
  }

  async lookup(word: string): Promise<DefinitionResult | null> {
    const text = await translateText(word, this.language);
    if (!text) return null;
    return {
      language: this.language,
      entries: [{ partOfSpeech: '', definition: text }],
    };
  }
}
