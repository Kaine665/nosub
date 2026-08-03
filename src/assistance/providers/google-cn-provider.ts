/**
 * 中文翻译提供方 —— 基于 Google Translate 免费端点。
 * Content script 有 host_permissions, 可直接 fetch。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('dict-cn');
const API = 'https://translate.googleapis.com/translate_a/single';

async function translateText(text: string): Promise<string | null> {
  try {
    const url = `${API}?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as unknown[][];
    return ((data[0] as Array<[string]> | undefined) ?? [])
      .map(x => x[0]).join('').trim() || null;
  } catch {
    return null;
  }
}

export class GoogleCnProvider implements DefinitionProvider {
  readonly name = 'google-cn';
  readonly language = 'zh-CN';

  /** 将英文释义批量译为中文(单次请求, 避免逐条超时) */
  async translate(enResult: DefinitionResult): Promise<DefinitionResult | null> {
    const sources = enResult.entries.slice(0, 5);
    if (!sources.length) return null;

    try {
      // 用特殊分隔符拼接, 一次请求翻译全部
      const SEP = '\n---\n';
      const joined = sources.map(e => e.definition).join(SEP);
      const cnRaw = await translateText(joined);
      if (!cnRaw) return null;

      // 按分隔符切开
      const cnParts = cnRaw.split(/[-–—]{2,}/).map(s => s.trim()).filter(Boolean);

      const entries: DefinitionEntry[] = [];
      for (let i = 0; i < sources.length && i < cnParts.length; i++) {
        entries.push({
          partOfSpeech: sources[i].partOfSpeech,
          definition: cnParts[i],
          example: sources[i].example,
        });
      }

      return entries.length ? { language: 'zh-CN', entries } : null;
    } catch (err) {
      log.debug('CN translate failed:', (err as Error).message);
      return null;
    }
  }

  async lookup(word: string): Promise<DefinitionResult | null> {
    const text = await translateText(word);
    if (!text) return null;
    return {
      language: 'zh-CN',
      entries: [{ partOfSpeech: '', definition: text }],
    };
  }
}
