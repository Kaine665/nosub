/**
 * Cue 索引与选择 —— 纯函数,不依赖 DOM。
 * 对应 design.md §5.3,spec.md §5.2。
 *
 * 选择规则(design §5.3):
 * 1. 时间处于 [startMs, endMs) 时选中该 cue。
 * 2. cue 重叠时,优先选择开始时间更晚且包含当前时间的 cue。
 * 3. 字幕间隙内:有会话状态则保留最近已激活 cue;无状态则选当前时间之前最近的 cue。
 * 4. 前后切换以当前激活 cue 的索引为基准。
 */

import type { Cue } from '../shared/types.js';

/**
 * 判断 cue 是否有效。design §4 约束:
 * - 非负时间
 * - endMs > startMs
 * - 非空文本
 */
export function isValidCue(cue: Cue): boolean {
  return (
    Number.isFinite(cue.startMs) &&
    Number.isFinite(cue.endMs) &&
    cue.startMs >= 0 &&
    cue.endMs > cue.startMs &&
    typeof cue.text === 'string' &&
    cue.text.trim().length > 0
  );
}

/**
 * 过滤无效 cue。
 */
export function filterValidCues(cues: readonly Cue[]): Cue[] {
  return cues.filter(isValidCue);
}

/**
 * 按 startMs 升序排序。返回新数组,不改原数组。
 * 重叠 cue 间,同 startMs 时按 endMs 升序(确定性)。
 */
export function sortCues(cues: readonly Cue[]): Cue[] {
  return [...cues].sort((a, b) =>
    a.startMs !== b.startMs
      ? a.startMs - b.startMs
      : a.endMs - b.endMs,
  );
}

/**
 * 规范化:过滤 + 排序。返回有序、有效的 cue 数组。
 */
export function normalizeCues(cues: readonly Cue[]): Cue[] {
  return sortCues(filterValidCues(cues));
}

/**
 * 在 cue 列表中找当前时间点所在的 cue。
 * 实现 design §5.3 规则 1 和 2:
 * - 命中 [startMs, endMs) 的 cue 中,选 startMs 更晚的(更精确贴合"当前正在显示")
 *
 * 前提:cues 已 normalizeCues(有序、有效)。
 * 无命中返回 undefined。
 */
export function findCueAtTime(cues: readonly Cue[], timeMs: number): Cue | undefined {
  let match: Cue | undefined;
  for (const cue of cues) {
    if (timeMs < cue.startMs) break; // 有序,越界即停
    if (timeMs >= cue.startMs && timeMs < cue.endMs) {
      // 重叠时选 startMs 更晚的:因为有序,后面的 startMs 更大,继续找
      match = cue;
    }
  }
  return match;
}

/**
 * 在间隙或任意时间点,找"应当视为当前"的 cue。
 * 实现 design §5.3 规则 3:
 * - 若 activeCueId 命中且时间未越过其 endMs → 保留(active 会持续到下一 cue 开始)
 * - 否则:命中区间的 cue 优先;间隙时取当前时间之前最近的 cue
 *
 * 这与 findCueAtTime 的区别:间隙里不返回 undefined,而是回退到最近的已过 cue。
 * "最近"指:在当前时间之前(startMs <= timeMs)且 startMs 最大的。
 *
 * 前提:cues 已 normalizeCues。
 */
export function findCurrentCue(
  cues: readonly Cue[],
  timeMs: number,
  activeCueId?: string,
): Cue | undefined {
  if (cues.length === 0) return undefined;

  // 1. 优先:精确命中
  const hit = findCueAtTime(cues, timeMs);
  if (hit) return hit;

  // 2. active cue 仍生效(spec §5.2:间隙中保留最近激活 cue 直到下一个开始)
  if (activeCueId) {
    const activeIdx = cues.findIndex((c) => c.id === activeCueId);
    if (activeIdx >= 0) {
      const active = cues[activeIdx];
      const next = cues[activeIdx + 1];
      // active 尚未被时间越过其 endMs(虽不在区间内,但间隙),且下一 cue 未开始
      if (timeMs >= active.startMs && (!next || timeMs < next.startMs)) {
        return active;
      }
    }
  }

  // 3. 回退:时间之前最近的 cue
  let fallback: Cue | undefined;
  for (const cue of cues) {
    if (cue.startMs <= timeMs) fallback = cue;
    else break;
  }
  return fallback;
}

/**
 * 取当前激活 cue 的前一个 cue。design §5.3 规则 4。
 * 用于 A 键:"回到前一个 cue"(spec §6.2)。
 *
 * 若 activeCueId 不存在或已是第一个,返回第一个 cue(spec §6.2 边界:
 * "已经是第一个 cue 时,仍从第一个 cue 起点播放")。
 */
export function previousCue(
  cues: readonly Cue[],
  activeCueId: string | undefined,
): Cue | undefined {
  if (cues.length === 0) return undefined;
  if (!activeCueId) return cues[0];

  const idx = cues.findIndex((c) => c.id === activeCueId);
  if (idx <= 0) return cues[0]; // 不存在或已是第一个 → 第一个
  return cues[idx - 1];
}

/**
 * 取当前激活 cue 的下一个 cue。design §5.3 规则 4。
 * 用于 D 键:"前进到下一个 cue"(spec §6.3)。
 *
 * 若已是最后一个,返回 undefined(spec §6.3 边界:
 * "已经是最后一个 cue 时,退出循环,但不越过视频结尾")。
 */
export function nextCue(
  cues: readonly Cue[],
  activeCueId: string | undefined,
): Cue | undefined {
  if (cues.length === 0) return undefined;
  if (!activeCueId) return cues[0];

  const idx = cues.findIndex((c) => c.id === activeCueId);
  if (idx < 0) return cues[0];
  if (idx >= cues.length - 1) return undefined; // 最后一个 → 无
  return cues[idx + 1];
}

/**
 * 找 cue 在列表中的索引。不存在返回 -1。
 */
export function cueIndex(cues: readonly Cue[], cueId: string | undefined): number {
  if (!cueId) return -1;
  return cues.findIndex((c) => c.id === cueId);
}
