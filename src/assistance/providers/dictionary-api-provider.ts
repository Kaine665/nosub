/**
 * 英文释义提供方 —— 基于 Free Dictionary API (Wiktionary)。
 * 请求经 background service worker 代发，避免 YouTube 页面 CORS 限制。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { logger } from '../../shared/logger.js';
import { proxyFetch } from '../../shared/proxy-fetch.js';

const log = logger.createLogger('dict-en');
const API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

export class DictionaryApiProvider implements DefinitionProvider {
  readonly name = 'dictionaryapi';
  readonly language = 'en';

  async lookup(word: string): Promise<DefinitionResult | null> {
    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!clean || clean.length < 2) return null;

    try {
      const resp = await proxyFetch(
        'dict-fetch',
        `${API}/${encodeURIComponent(clean)}`,
        4500,
      );
      if (!resp.ok || !resp.body) return null;

      const data = resp.body as Array<{
        phonetic?: string;
        phonetics?: Array<{ text?: string; audio?: string }>;
        meanings?: Array<{
          partOfSpeech: string;
          definitions: Array<{ definition: string; example?: string }>;
        }>;
      }>;
      const entry = data?.[0];
      if (!entry?.meanings) return null;

      const entries: DefinitionEntry[] = [];
      for (const m of entry.meanings) {
        for (const d of m.definitions) {
          entries.push({
            partOfSpeech: m.partOfSpeech,
            definition: d.definition,
            example: d.example,
          });
        }
      }

      const phonetics = entry.phonetics ?? [];
      const uk = phonetics.find((p) => /(?:uk|gb)/i.test(p.audio ?? ''));
      const us = phonetics.find((p) => /us/i.test(p.audio ?? ''));
      const first = phonetics.find((p) => p.text || p.audio);
      const fallbackText = entry.phonetic ?? first?.text;

      return {
        language: 'en',
        entries,
        phonetic: fallbackText,
        phoneticUK: uk?.text ?? fallbackText,
        phoneticUS: us?.text ?? fallbackText,
        audioUK: uk?.audio,
        audioUS: us?.audio,
      };
    } catch (err) {
      log.debug('EN lookup failed:', (err as Error).message);
      return null;
    }
  }
}
