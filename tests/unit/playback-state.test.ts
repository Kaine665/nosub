import { describe, it, expect } from 'vitest';
import {
  createSession,
  handleQKey,
  handleAKey,
  handleDKey,
  markInternalSeek,
  clearExpiredInternalSeek,
  isUserSeek,
  handleUserSeek,
  handleMediaChange,
  updateActiveCue,
  SEEK_PARAMS,
} from '../../src/playback/playback-state.js';
import type { ListeningSession } from '../../src/playback/playback-state.js';
import type { Cue } from '../../src/shared/types.js';

const CUES: Cue[] = [
  { id: 'c0', startMs: 0, endMs: 1000, text: 'zero' },
  { id: 'c1', startMs: 1000, endMs: 2000, text: 'one' },
  { id: 'c2', startMs: 2000, endMs: 3000, text: 'two' },
  { id: 'c3', startMs: 3000, endMs: 4000, text: 'three' },
];

function makeSession(mode: ListeningSession['mode'] = { kind: 'normal' }): ListeningSession {
  return {
    videoId: 'vid',
    trackId: 'track',
    cues: CUES,
    mode,
  };
}

describe('createSession', () => {
  it('创建 normal 状态的会话', () => {
    const s = createSession('v', 't', CUES);
    expect(s.mode.kind).toBe('normal');
    expect(s.cues).toBe(CUES);
    expect(s.activeCueId).toBeUndefined();
    expect(s.pendingInternalSeek).toBeUndefined();
  });
});

describe('handleQKey (Q 键切换精听)', () => {
  it('normal 状态:当前 cue 从头播放并进入精听', () => {
    const session = makeSession();
    const { session: next, intent } = handleQKey(session, 2500);
    expect(next.mode).toEqual({ kind: 'repeat', cueId: 'c2' });
    expect(next.activeCueId).toBe('c2');
    expect(intent).toEqual({ type: 'seek', targetMs: 2000, markInternal: true });
  });

  it('repeat 状态:退出精听并停在当前句', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c1' });
    const { session: next, intent } = handleQKey(session, 1500);
    expect(next.mode).toEqual({ kind: 'normal' });
    expect(next.activeCueId).toBe('c1');
    expect(intent).toEqual({ type: 'exitLoop' });
  });

  it('没有当前 cue 时不进入精听', () => {
    const session = { ...makeSession(), cues: [] };
    const { session: next, intent } = handleQKey(session, 9999);
    expect(next).toBe(session);
    expect(intent).toEqual({ type: 'none' });
  });
});

describe('handleAKey (A 键上一句)', () => {
  it('normal 状态不进入精听', () => {
    const session = makeSession();
    const { session: next, intent } = handleAKey(session);
    expect(next).toBe(session);
    expect(intent).toEqual({ type: 'none' });
  });

  it('repeat 状态:后退一个 cue 并继续精听', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c2' });
    const { session: next, intent } = handleAKey(session);
    expect(next.mode).toEqual({ kind: 'repeat', cueId: 'c1' });
    expect(intent).toEqual({ type: 'seek', targetMs: 1000, markInternal: true });
  });

  it('repeat 状态已是第一句:重新播放第一句', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c0' });
    const { session: next, intent } = handleAKey(session);
    expect(next.mode).toEqual({ kind: 'repeat', cueId: 'c0' });
    expect(intent).toEqual({ type: 'seek', targetMs: 0, markInternal: true });
  });
});

describe('handleDKey (D 键下一句)', () => {
  it('repeat 状态:进入下一句并继续精听', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c1' });
    const { session: next, intent } = handleDKey(session);
    expect(next.mode).toEqual({ kind: 'repeat', cueId: 'c2' });
    expect(next.activeCueId).toBe('c2');
    expect(intent).toEqual({ type: 'seek', targetMs: 2000, markInternal: true });
  });

  it('normal 状态: 前进到下一个 cue', () => {
    const session = { ...makeSession(), activeCueId: 'c1' };
    const { session: next, intent } = handleDKey(session);
    expect(next.mode.kind).toBe('normal');
    expect(next.activeCueId).toBe('c2');
    expect(intent).toEqual({ type: 'seek', targetMs: 2000, markInternal: false });
  });

  it('已是最后一个 cue + normal: 不做任何事', () => {
    const session = { ...makeSession(), activeCueId: 'c3' };
    const { session: next, intent } = handleDKey(session);
    expect(next).toBe(session); // 未变
    expect(intent).toEqual({ type: 'none' });
  });
});

describe('pendingInternalSeek 标记', () => {
  it('markInternalSeek 设置带过期时间的标记', () => {
    const session = makeSession();
    const marked = markInternalSeek(session, 2000, 10000);
    expect(marked.pendingInternalSeek).toEqual({
      targetMs: 2000,
      expiresAtMs: 10000 + SEEK_PARAMS.INTERNAL_SEEK_WINDOW_MS,
    });
  });

  it('isUserSeek:无标记时视为用户 seek', () => {
    const session = makeSession();
    expect(isUserSeek(session, 2000, 10000)).toBe(true);
  });

  it('isUserSeek:标记窗口内且接近目标 → 插件 seek', () => {
    const session = markInternalSeek(makeSession(), 2000, 10000);
    // nowMs 在窗口内,seekedTime 接近 2000
    expect(isUserSeek(session, 2050, 10100)).toBe(false);
  });

  it('isUserSeek:标记窗口内但远离目标 → 用户 seek', () => {
    const session = markInternalSeek(makeSession(), 2000, 10000);
    // seekedTime=5000,远离 target=2000(差 3000 > 容差 200)
    expect(isUserSeek(session, 5000, 10100)).toBe(true);
  });

  it('isUserSeek:标记过期后视为用户 seek', () => {
    const session = markInternalSeek(makeSession(), 2000, 10000);
    // nowMs 远超过期时间
    expect(isUserSeek(session, 2050, 99999)).toBe(true);
  });

  it('clearExpiredInternalSeek 清除过期标记', () => {
    const session = markInternalSeek(makeSession(), 2000, 10000);
    const cleared = clearExpiredInternalSeek(session, 99999);
    expect(cleared.pendingInternalSeek).toBeUndefined();
  });

  it('clearExpiredInternalSeek 保留未过期标记', () => {
    const session = markInternalSeek(makeSession(), 2000, 10000);
    const kept = clearExpiredInternalSeek(session, 10100);
    expect(kept.pendingInternalSeek).toBeDefined();
  });
});

describe('handleUserSeek (用户拖动退出循环判定)', () => {
  it('repeat 状态拖到当前 cue 外 → 退出循环', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c1' });
    const { session: next, intent } = handleUserSeek(session, 3500); // 拖到 c3
    expect(next.mode.kind).toBe('normal');
    expect(intent).toEqual({ type: 'exitLoop' });
  });

  it('repeat 状态拖动仍在当前 cue 内 → 不退出(允许句内微调)', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c1' });
    const { session: next, intent } = handleUserSeek(session, 1500); // 仍在 c1 内
    expect(next.mode.kind).toBe('repeat');
    expect(intent).toEqual({ type: 'none' });
  });

  it('normal 状态拖动 → 更新 active cue,不产生 intent', () => {
    const session = makeSession();
    const { session: next, intent } = handleUserSeek(session, 2500);
    expect(next.activeCueId).toBe('c2');
    expect(intent).toEqual({ type: 'none' });
  });
});

describe('handleMediaChange (视频/轨道变更)', () => {
  it('销毁会话,返回 cleanup intent', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c1' });
    const { session: next, intent } = handleMediaChange();
    expect(next).toBeNull();
    expect(intent).toEqual({ type: 'cleanup' });
    // 确认不依赖原 session(函数无参)
    void session;
  });
});

describe('updateActiveCue', () => {
  it('normal 状态更新 active cue', () => {
    const session = makeSession();
    const updated = updateActiveCue(session, 2500);
    expect(updated.activeCueId).toBe('c2');
  });

  it('repeat 状态不更新 active cue(锁定在循环 cue)', () => {
    const session = makeSession({ kind: 'repeat', cueId: 'c1' });
    const updated = updateActiveCue(session, 3500);
    // activeCueId 保持循环 cue
    expect(updated.activeCueId).toBeUndefined(); // 会话初始无 activeCueId
    expect(updated.mode).toEqual({ kind: 'repeat', cueId: 'c1' });
  });

  it('cue 未变时不产生新对象引用', () => {
    const session = { ...makeSession(), activeCueId: 'c2' };
    const updated = updateActiveCue(session, 2500);
    expect(updated).toBe(session); // 同一引用
  });
});
