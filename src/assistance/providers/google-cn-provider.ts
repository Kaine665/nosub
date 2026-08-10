/**
 * 中文翻译提供方 —— Google Translate 免费端点（短词兜底）。
 * 输出必须通过质量关卡，否则视为失败。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { buildCleanZhLines } from '../zh-gloss-quality.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('dict-cn');
const API = 'https://translate.googleapis.com/translate_a/single';

async function translateText(text: string): Promise<string | null> {
  try {
    const url = `${API}?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown[][];
    return ((data[0] as Array<[string]> | undefined) ?? [])
      .map((x) => x[0])
      .join('')
      .trim() || null;
  } catch {
    return null;
  }
}

export class GoogleCnProvider implements DefinitionProvider {
  readonly name = 'google-cn';
  readonly language = 'zh-CN';

  async translate(enResult: DefinitionResult): Promise<DefinitionResult | null> {
    const sources = enResult.entries.slice(0, 5);
    if (!sources.length) return null;

    try {
      const SEP = '\n---\n';
      const joined = sources.map((e) => e.definition).join(SEP);
      const cnRaw = await translateText(joined);
      if (!cnRaw) return null;

      const cnParts = cnRaw.split(/[-–—]{2,}/).map((s) => s.trim()).filter(Boolean);
      const raw = sources
        .slice(0, cnParts.length)
        .map((e, i) => ({ pos: e.partOfSpeech, definition: cnParts[i] }));
      const lines = buildCleanZhLines(raw);
      if (!lines.length) return null;

      const entries: DefinitionEntry[] = lines.map((l, i) => ({
        partOfSpeech: l.pos || sources[i]?.partOfSpeech || '',
        definition: l.text,
        example: sources[i]?.example,
      }));
      return { language: 'zh-CN', entries };
    } catch (err) {
      log.debug('CN translate failed:', (err as Error).message);
      return null;
    }
  }

  async lookup(word: string): Promise<DefinitionResult | null> {
    const text = await translateText(word);
    if (!text) return null;
    const lines = buildCleanZhLines([{ pos: '', definition: text }]);
    if (!lines.length) return null;
    return {
      language: 'zh-CN',
      entries: lines.map((l) => ({ partOfSpeech: l.pos, definition: l.text })),
    };
  }
}
