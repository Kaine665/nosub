/**
 * 播放状态机 —— 纯逻辑,不直接操作播放器。
 * 对应 design.md §5.1-5.3,spec.md §6.1-6.4。
 *
 * 核心职责:
 * - 维护 normal / repeat 两种模式
 * - 处理 A 键的两种语义(normal:进入循环当前 cue;repeat:后退一个 cue)
 * - 用 pendingInternalSeek 标记区分插件 seek 和用户 seek
 *   (探针证实:两者事件流完全相同,必须靠标记区分)
 *
 * 状态机本身不碰 DOM;它通过返回 Intent 让 PlaybackEngine 执行副作用。
 */

import type { Cue } from '../shared/types.js';
import { cueIndex, findCurrentCue, nextCue, previousCue } from './cue-index.js';

/**
 * 播放模式。design §5.1。
 */
export type PlaybackMode =
  | { kind: 'normal' }
  | { kind: 'repeat'; cueId: string };

/**
 * 内部 seek 标记。design §5.1。
 * 用于区分插件自己触发的 seek(循环回到 cue 起点)与用户主动拖动。
 * 探针结论:两种 seek 的 DOM 事件序列完全相同,只能靠此标记区分。
 */
export interface PendingInternalSeek {
  /** 期望的 seek 目标时间(ms) */
  targetMs: number;
  /** 标记过期时间(ms,基于 Date.now() 或 performance.now()) */
  expiresAtMs: number;
}

/**
 * 完整会话状态。design §5.1。
 */
export interface ListeningSession {
  videoId: string;
  trackId: string;
  cues: Cue[];
  activeCueId?: string;
  mode: PlaybackMode;
  pendingInternalSeek?: PendingInternalSeek;
}

/**
 * 状态机产生的意图。调用层(PlaybackEngine)负责执行副作用。
 */
export type SessionIntent =
  | { type: 'none' }
  | { type: 'seek'; targetMs: number; markInternal: boolean }
  | { type: 'play' }
  | { type: 'exitLoop' }
  | { type: 'cleanup' };

/** pendingInternalSeek 标记的有效时长(ms) */
const INTERNAL_SEEK_WINDOW_MS = 500;
/** 判定 seek 是否"接近目标"的容差(ms) */
const SEEK_TARGET_TOLERANCE_MS = 200;

/**
 * 内部 seek 标记的容差与窗口。design §5.4 参数校准由真实视频测试(T21)完成。
 */
export const SEEK_PARAMS = {
  INTERNAL_SEEK_WINDOW_MS,
  SEEK_TARGET_TOLERANCE_MS,
} as const;

/**
 * 创建新会话。视频或轨道变更时调用。
 */
export function createSession(
  videoId: string,
  trackId: string,
  cues: Cue[],
): ListeningSession {
  return {
    videoId,
    trackId,
    cues,
    mode: { kind: 'normal' },
  };
}

/**
 * 处理 A 键:"回到前一个 cue,并从其起点播放"。
 * spec §6.2,design §5.2。
 *
 * 语义分支:
 * - normal 状态:当前 cue 从头播放并进入循环(spec §4 核心路径第 2 步)
 * - repeat 状态:后退一个 cue 并继续循环(spec §4 第 3 步)
 *
 * 边界:已是第一个 cue 时仍从第一个起点播放并进入循环。
 */
export function handleAKey(
  session: ListeningSession,
  currentTimeMs: number,
): { session: ListeningSession; intent: SessionIntent } {
  // 确定目标 cue
  let targetCue: Cue | undefined;

  if (session.mode.kind === 'normal') {
    // normal:以当前播放位置的 cue 为准,从头循环
    targetCue = findCurrentCue(session.cues, currentTimeMs, session.activeCueId);
  } else {
    // repeat:后退一个 cue
    const currentLoopCueId = session.mode.cueId;
    targetCue = previousCue(session.cues, currentLoopCueId);
  }

  if (!targetCue) {
    return { session, intent: { type: 'none' } };
  }

  const newSession: ListeningSession = {
    ...session,
    mode: { kind: 'repeat', cueId: targetCue.id },
    activeCueId: targetCue.id,
  };

  return {
    session: newSession,
    intent: { type: 'seek', targetMs: targetCue.startMs, markInternal: true },
  };
}

/**
 * 处理 D 键:行动单一,不混杂。
 * - repeat → 只退出循环(停在当前句)
 * - normal → 跳到下一个 cue
 *
 * 边界:已是最后一个 cue 时不做任何事。
 */
export function handleDKey(
  session: ListeningSession,
): { session: ListeningSession; intent: SessionIntent } {
  // repeat: 退出循环, 停在当前句
  if (session.mode.kind === 'repeat') {
    return {
      session: {
        ...session,
        mode: { kind: 'normal' },
        activeCueId: session.mode.cueId, // 保留当前句为 active
      },
      intent: { type: 'exitLoop' },
    };
  }

  // normal: 跳到下一个 cue
  const target = nextCue(session.cues, session.activeCueId);
  if (!target) {
    // 已是最后一个: 不做任何事
    return { session, intent: { type: 'none' } };
  }

  return {
    session: { ...session, activeCueId: target.id },
    intent: { type: 'seek', targetMs: target.startMs, markInternal: false },
  };
}

/**
 * 标记一个内部 seek(插件自己即将 seek 回 cue 起点)。
 * PlaybackEngine 在执行 seek 前调用此函数设置标记。
 */
export function markInternalSeek(
  session: ListeningSession,
  targetMs: number,
  nowMs: number,
): ListeningSession {
  return {
    ...session,
    pendingInternalSeek: {
      targetMs,
      expiresAtMs: nowMs + INTERNAL_SEEK_WINDOW_MS,
    },
  };
}

/**
 * 清除过期的内部 seek 标记。
 */
export function clearExpiredInternalSeek(
  session: ListeningSession,
  nowMs: number,
): ListeningSession {
  if (!session.pendingInternalSeek) return session;
  if (session.pendingInternalSeek.expiresAtMs < nowMs) {
    const { pendingInternalSeek: _, ...rest } = session;
    return rest;
  }
  return session;
}

/**
 * 判定一次 seek 事件是否为"用户主动 seek"(应退出循环)。
 * 探针证实:不能靠事件类型区分,只能靠 pendingInternalSeek 标记。
 *
 * 返回 true 表示这是用户主动拖动,应退出循环。
 */
export function isUserSeek(
  session: ListeningSession,
  seekedTimeMs: number,
  nowMs: number,
): boolean {
  const pending = session.pendingInternalSeek;
  if (!pending) return true;
  if (nowMs > pending.expiresAtMs) return true; // 标记已过期

  // 在窗口内,且 seek 落点接近目标 → 视为插件 seek
  const diff = Math.abs(seekedTimeMs - pending.targetMs);
  return diff > SEEK_TARGET_TOLERANCE_MS;
}

/**
 * 处理用户主动 seek(拖动到 cue 外)。
 * spec §6.4:用户主动拖动到当前 cue 以外 → 退出循环。
 *
 * 若用户拖动仍在当前循环 cue 内,不退出(允许在句内微调)。
 */
export function handleUserSeek(
  session: ListeningSession,
  seekedTimeMs: number,
): { session: ListeningSession; intent: SessionIntent } {
  if (session.mode.kind !== 'repeat') {
    // normal 状态:更新 active cue 即可
    const newActive = findCurrentCue(session.cues, seekedTimeMs);
    return {
      session: { ...session, activeCueId: newActive?.id },
      intent: { type: 'none' },
    };
  }

  const repeatCueId = (session.mode as { kind: 'repeat'; cueId: string }).cueId;
  const currentLoopCue = session.cues.find((c) => c.id === repeatCueId);

  // 用户拖动仍在当前 cue 内 → 不退出,但下次循环会回到起点
  if (currentLoopCue && seekedTimeMs >= currentLoopCue.startMs && seekedTimeMs < currentLoopCue.endMs) {
    return { session, intent: { type: 'none' } };
  }

  // 拖到 cue 外 → 退出循环
  const newActive = findCurrentCue(session.cues, seekedTimeMs);
  return {
    session: {
      ...session,
      mode: { kind: 'normal' },
      activeCueId: newActive?.id,
    },
    intent: { type: 'exitLoop' },
  };
}

/**
 * 处理视频或轨道变更:销毁会话,清空所有状态。
 * spec §6.4,design §5.2。
 */
export function handleMediaChange(): { session: null; intent: SessionIntent } {
  return { session: null, intent: { type: 'cleanup' } };
}

/**
 * 更新当前播放位置对应的 active cue。
 * 由 PlaybackEngine 的轮询定期调用。
 * repeat 状态下不更新 activeCue(循环锁定在 cueId)。
 */
export function updateActiveCue(
  session: ListeningSession,
  currentTimeMs: number,
): ListeningSession {
  if (session.mode.kind === 'repeat') return session;

  const current = findCurrentCue(session.cues, currentTimeMs, session.activeCueId);
  if (current?.id === session.activeCueId) return session;
  return { ...session, activeCueId: current?.id };
}

// 重新导出 cue-index 的工具,方便单文件引用
export { cueIndex };
