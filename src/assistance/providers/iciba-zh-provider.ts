/**
 * 金山词霸移动端建议接口 —— 短义项、简体为主。
 * https://dict-mobile.iciba.com/interface/index.php?c=word&m=getsuggest&...
 */

import type { DefinitionProvider, DefinitionEntry, DefinitionResult } from '../definition-provider.js';
import { buildCleanZhLines, canonPos } from '../zh-gloss-quality.js';
import { logger } from '../../shared/logger.js';

const log = logger.createLogger('dict-iciba');
const API = 'https://dict-mobile.iciba.com/interface/index.php';

interface IcibaMean {
  part?: string;
  means?: string[];
}

interface IcibaMessage {
  means?: IcibaMean[];
}

export class IcibaZhProvider implements DefinitionProvider {
  readonly name = 'iciba-zh';
  readonly language = 'zh_CN';

  async lookup(word: string): Promise<DefinitionResult | null> {
    const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    if (!clean || clean.length < 2) return null;

    try {
      const url =
        `${API}?c=word&m=getsuggest&nums=1&is_need_mean=1&word=${encodeURIComponent(clean)}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!resp.ok) return null;
      const data = (await resp.json()) as { message?: IcibaMessage[] };
      const item = data.message?.[0];
      if (!item?.means?.length) return null;

      const raw: Array<{ pos: string; definition: string }> = [];
      for (const m of item.means) {
        const pos = m.part ?? '';
        for (const sense of m.means ?? []) {
          if (sense?.trim()) raw.push({ pos, definition: sense.trim() });
        }
      }

      const lines = buildCleanZhLines(raw);
      if (!lines.length) {
        log.debug('iciba rejected by quality gate:', clean);
        return null;
      }

      const entries: DefinitionEntry[] = lines.map((l) => ({
        partOfSpeech: l.pos || (canonPos(raw[0]?.pos ?? '') ?? ''),
        definition: l.text,
      }));
      return { language: 'zh_CN', entries };
    } catch (err) {
      log.debug('iciba failed:', (err as Error).message);
      return null;
    }
  }
}
