import { describe, expect, it } from 'vitest';
import { buildCleanZhLines } from '../../src/assistance/zh-gloss-quality.js';

describe('buildCleanZhLines', () => {
  it('保留 what 的简体释义并过滤繁体和粤语项', () => {
    const result = buildCleanZhLines([
      { pos: 'det/pron/intj', definition: '什麼 /什么' },
      { pos: 'det/pron/intj', definition: '啥' },
      { pos: 'det/pron/intj', definition: '乜嘢' },
      { pos: 'det/pron/intj', definition: '咩' },
    ]);

    expect(result).toEqual([{ pos: '', text: '什么;啥' }]);
  });
});
