import { describe, it, expect } from 'vitest';
import {
  isValidCue,
  filterValidCues,
  sortCues,
  normalizeCues,
  findCueAtTime,
  findCurrentCue,
  previousCue,
  nextCue,
  cueIndex,
} from '../../src/playback/cue-index.js';
import type { Cue } from '../../src/shared/types.js';
import lzeFixture from '../fixtures/lze-cues-first20.json' with { type: 'json' };

// 真实 fixture:LZArpRwziE8 前 20 条 ASR cue,毫秒精度
const FIXTURE_CUES: Cue[] = lzeFixture.cues.map((c, i) => ({
  id: `cue-${i}`,
  startMs: c.startMs,
  endMs: c.endMs,
  text: c.text,
}));

describe('isValidCue', () => {
  it('接受正常的 cue', () => {
    expect(isValidCue({ id: 'a', startMs: 0, endMs: 100, text: 'hi' })).toBe(true);
  });
  it('拒绝负时间', () => {
    expect(isValidCue({ id: 'a', startMs: -1, endMs: 100, text: 'hi' })).toBe(false);
  });
  it('拒绝 endMs <= startMs', () => {
    expect(isValidCue({ id: 'a', startMs: 100, endMs: 100, text: 'hi' })).toBe(false);
    expect(isValidCue({ id: 'a', startMs: 100, endMs: 50, text: 'hi' })).toBe(false);
  });
  it('拒绝空文本', () => {
    expect(isValidCue({ id: 'a', startMs: 0, endMs: 100, text: '   ' })).toBe(false);
    expect(isValidCue({ id: 'a', startMs: 0, endMs: 100, text: '' })).toBe(false);
  });
  it('拒绝非有限数', () => {
    expect(isValidCue({ id: 'a', startMs: NaN, endMs: 100, text: 'hi' })).toBe(false);
    expect(isValidCue({ id: 'a', startMs: 0, endMs: Infinity, text: 'hi' })).toBe(false);
  });
});

describe('filterValidCues', () => {
  it('过滤掉无效 cue,保留有效的', () => {
    const input: Cue[] = [
      { id: 'ok', startMs: 0, endMs: 100, text: 'good' },
      { id: 'empty', startMs: 0, endMs: 100, text: '' },
      { id: 'neg', startMs: -5, endMs: 100, text: 'bad' },
    ];
    expect(filterValidCues(input)).toHaveLength(1);
    expect(filterValidCues(input)[0].id).toBe('ok');
  });
});

describe('sortCues', () => {
  it('按 startMs 升序排序', () => {
    const input: Cue[] = [
      { id: 'c', startMs: 300, endMs: 400, text: 'c' },
      { id: 'a', startMs: 100, endMs: 200, text: 'a' },
      { id: 'b', startMs: 200, endMs: 300, text: 'b' },
    ];
    const sorted = sortCues(input);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
  it('同 startMs 按 endMs 升序', () => {
    const input: Cue[] = [
      { id: 'long', startMs: 100, endMs: 300, text: 'x' },
      { id: 'short', startMs: 100, endMs: 150, text: 'y' },
    ];
    expect(sortCues(input).map((c) => c.id)).toEqual(['short', 'long']);
  });
  it('不改原数组', () => {
    const input: Cue[] = [
      { id: 'b', startMs: 200, endMs: 300, text: 'b' },
      { id: 'a', startMs: 100, endMs: 200, text: 'a' },
    ];
    sortCues(input);
    expect(input[0].id).toBe('b'); // 原数组未变
  });
});

describe('normalizeCues', () => {
  it('过滤 + 排序', () => {
    const input: Cue[] = [
      { id: 'bad', startMs: -1, endMs: 100, text: 'x' },
      { id: 'c', startMs: 300, endMs: 400, text: 'c' },
      { id: 'a', startMs: 100, endMs: 200, text: 'a' },
    ];
    const result = normalizeCues(input);
    expect(result.map((c) => c.id)).toEqual(['a', 'c']);
  });
});

describe('findCueAtTime', () => {
  it('命中区间 [start, end) 返回该 cue', () => {
    const cues = FIXTURE_CUES;
    // 第 0 条:160-6879
    expect(findCueAtTime(cues, 160)?.id).toBe('cue-0');
    expect(findCueAtTime(cues, 5000)?.id).toBe('cue-0');
    expect(findCueAtTime(cues, 6878)?.id).toBe('cue-0');
  });
  it('endMs 是开区间边界', () => {
    const cues = FIXTURE_CUES;
    // 第 0 条 endMs=6879,第 1 条 startMs=6879
    expect(findCueAtTime(cues, 6879)?.id).toBe('cue-1'); // 越过 endMs
  });
  it('间隙返回 undefined', () => {
    const cues: Cue[] = [
      { id: 'a', startMs: 0, endMs: 100, text: 'a' },
      { id: 'b', startMs: 200, endMs: 300, text: 'b' },
    ];
    expect(findCueAtTime(cues, 150)).toBeUndefined();
  });
  it('时间在第一个 cue 之前返回 undefined', () => {
    expect(findCueAtTime(FIXTURE_CUES, 0)).toBeUndefined(); // 第一条 startMs=160
  });
  it('重叠时选 startMs 更晚的', () => {
    const cues: Cue[] = [
      { id: 'early', startMs: 100, endMs: 400, text: 'early' },
      { id: 'late', startMs: 200, endMs: 500, text: 'late' },
    ];
    expect(findCueAtTime(cues, 300)?.id).toBe('late');
  });
});

describe('findCurrentCue', () => {
  it('命中区间返回该 cue', () => {
    expect(findCurrentCue(FIXTURE_CUES, 5000)?.id).toBe('cue-0');
  });
  it('间隙且有 active cue 时保留 active(直到下一 cue 开始)', () => {
    const cues: Cue[] = [
      { id: 'a', startMs: 0, endMs: 100, text: 'a' },
      { id: 'b', startMs: 200, endMs: 300, text: 'b' },
    ];
    // 时间 150 在 a 和 b 间隙,active=a 应保留
    expect(findCurrentCue(cues, 150, 'a')?.id).toBe('a');
  });
  it('间隙且无 active 时回退到时间之前最近的', () => {
    const cues: Cue[] = [
      { id: 'a', startMs: 0, endMs: 100, text: 'a' },
      { id: 'b', startMs: 200, endMs: 300, text: 'b' },
    ];
    expect(findCurrentCue(cues, 150)?.id).toBe('a');
  });
  it('active 越过下一 cue 开始时不再保留 active', () => {
    const cues: Cue[] = [
      { id: 'a', startMs: 0, endMs: 100, text: 'a' },
      { id: 'b', startMs: 200, endMs: 300, text: 'b' },
    ];
    // 时间 250 命中 b,即使 active=a 也应返回 b
    expect(findCurrentCue(cues, 250, 'a')?.id).toBe('b');
  });
  it('时间在所有 cue 之前返回 undefined', () => {
    expect(findCurrentCue(FIXTURE_CUES, 0)).toBeUndefined();
  });
  it('空列表返回 undefined', () => {
    expect(findCurrentCue([], 100, 'x')).toBeUndefined();
  });
});

describe('previousCue', () => {
  it('返回前一个 cue', () => {
    expect(previousCue(FIXTURE_CUES, 'cue-3')?.id).toBe('cue-2');
  });
  it('已是第一个时仍返回第一个(spec §6.2 边界)', () => {
    expect(previousCue(FIXTURE_CUES, 'cue-0')?.id).toBe('cue-0');
  });
  it('activeCueId 不存在时返回第一个', () => {
    expect(previousCue(FIXTURE_CUES, undefined)?.id).toBe('cue-0');
    expect(previousCue(FIXTURE_CUES, 'nonexistent')?.id).toBe('cue-0');
  });
  it('空列表返回 undefined', () => {
    expect(previousCue([], 'x')).toBeUndefined();
  });
});

describe('nextCue', () => {
  it('返回下一个 cue', () => {
    expect(nextCue(FIXTURE_CUES, 'cue-3')?.id).toBe('cue-4');
  });
  it('已是最后一个时返回 undefined(spec §6.3 边界)', () => {
    const last = FIXTURE_CUES[FIXTURE_CUES.length - 1];
    expect(nextCue(FIXTURE_CUES, last.id)).toBeUndefined();
  });
  it('activeCueId 不存在时返回第一个', () => {
    expect(nextCue(FIXTURE_CUES, undefined)?.id).toBe('cue-0');
  });
  it('空列表返回 undefined', () => {
    expect(nextCue([], 'x')).toBeUndefined();
  });
});

describe('cueIndex', () => {
  it('返回 cue 的索引', () => {
    expect(cueIndex(FIXTURE_CUES, 'cue-5')).toBe(5);
  });
  it('不存在返回 -1', () => {
    expect(cueIndex(FIXTURE_CUES, 'nope')).toBe(-1);
  });
  it('undefined id 返回 -1', () => {
    expect(cueIndex(FIXTURE_CUES, undefined)).toBe(-1);
  });
});

describe('真实 fixture 集成', () => {
  it('LZArpRwziE8 前 20 条 cue 全部有效', () => {
    expect(FIXTURE_CUES.every(isValidCue)).toBe(true);
  });
  it('fixture 已按 startMs 升序', () => {
    const sorted = sortCues(FIXTURE_CUES);
    expect(sorted.map((c) => c.id)).toEqual(FIXTURE_CUES.map((c) => c.id));
  });
  it('第 0 条 cue startMs=160, endMs=6879', () => {
    expect(FIXTURE_CUES[0].startMs).toBe(160);
    expect(FIXTURE_CUES[0].endMs).toBe(6879);
  });
  it('连续 cue 前后衔接:前一条 endMs = 后一条 startMs', () => {
    // LZArpRwziE8 的 ASR cue 是首尾相接的
    for (let i = 0; i < FIXTURE_CUES.length - 1; i++) {
      expect(FIXTURE_CUES[i].endMs).toBe(FIXTURE_CUES[i + 1].startMs);
    }
  });
});
