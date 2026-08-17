/**
 * 有道词典 jsonapi —— 简明英汉。
 * 原始义项偏长，经质量关卡裁成短义项后才采用。
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { buildCleanZhLines } from '../zh-gloss-quality.js';
import { logger } from '../../shared/logger.js';
import { proxyFetch } from '../../shared/proxy-fetch.js';

const log = logger.createLogger('dict-youdao');
const API = 'https://dict.youdao.com/jsonapi';

interface YoudaoTr {
  l?: { i?: string[] | string };
}
interface YoudaoTrs {
  pos?: string;
  tr?: YoudaoTr[];
}
interface YoudaoWord {
  trs?: YoudaoTrs[];
}

export class YoudaoZhProvider implements DefinitionProvider {
  readonly name = 'youdao-zh';
  readonly language = 'zh_CN';

  async lookup(word: string): Promise<DefinitionResult | null> {
    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!clean || clean.length < 2) return null;

    try {
      const url = `${API}?${new URLSearchParams({ q: clean, le: 'en' }).toString()}`;
      const resp = await proxyFetch('dict-fetch', url, 5000);
      if (!resp.ok || !resp.body) return null;
      const data = resp.body as {
        ec?: { word?: YoudaoWord[] };
        fanyi?: { tran?: string };
      };

      const raw: Array<{ pos: string; definition: string }> = [];
      for (const w of data.ec?.word ?? []) {
        for (const trs of w.trs ?? []) {
          const pos = trs.pos ?? '';
          for (const tr of trs.tr ?? []) {
            const i = tr.l?.i;
            const text = Array.isArray(i) ? i.join('') : (i ?? '');
            if (text.trim()) raw.push({ pos, definition: text.trim() });
          }
        }
      }

      // 机器翻译兜底（也要过质量关）
      if (!raw.length && data.fanyi?.tran) {
        raw.push({ pos: '', definition: data.fanyi.tran });
      }

      const lines = buildCleanZhLines(raw);
      if (!lines.length) {
        log.debug('youdao rejected by quality gate:', clean);
        return null;
      }

      const entries: DefinitionEntry[] = lines.map((l) => ({
        partOfSpeech: l.pos,
        definition: l.text,
      }));
      return { language: 'zh_CN', entries };
    } catch (err) {
      log.debug('youdao failed:', (err as Error).message);
      return null;
    }
  }
}
