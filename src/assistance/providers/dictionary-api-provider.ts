/**
 * 英文释义提供方 —— 基于 Free Dictionary API (Wiktionary)。
 * Content script 有 host_permissions, 可直接 fetch。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('dict-en');
const API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

export class DictionaryApiProvider implements DefinitionProvider {
  readonly name = 'dictionaryapi';
  readonly language = 'en';

  async lookup(word: string): Promise<DefinitionResult | null> {
    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!clean || clean.length < 2) return null;

    try {
      const resp = await fetch(`${API}/${encodeURIComponent(clean)}`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) return null;

      const data = (await resp.json()) as Array<{
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

      return { language: 'en', entries };
    } catch (err) {
      log.debug('EN lookup failed:', (err as Error).message);
      return null;
    }
  }
}
