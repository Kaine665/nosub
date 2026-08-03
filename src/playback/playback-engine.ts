/**
 * PlaybackEngine —— design §5.4, tasks T10。
 *
 * 基于 cue 边界的循环调度。探针验证过的方案:
 * - rAF 轮询 currentTime,到 cue 结束 → seek 回绝对起点(不累加时间差,0 漂移)
 * - 暂停时停 rAF(节省开销),继续播放时恢复
 * - 页面隐藏时停 rAF(visibilitychange)
 *
 * 引擎自己不持有 session(那是 SessionController 的活),而是接收
 * "循环目标 cue"+ player 引用,执行循环调度。
 * SessionController 在进入 repeat 时 startLoop,退出时 stopLoop。
 */

import type { Cue } from '../shared/types.js';
import type { PlayerAdapter } from '../youtube/player-adapter.js';
import { logger } from '../shared/logger.js';

const log = logger.createLogger('engine');

/** 循环容差参数。探针实测:END_TOLERANCE 5.6ms,60ms 留 10 倍余量 */
export const LOOP_PARAMS = {
  END_TOLERANCE_MS: 60,
  START_OFFSET_MS: 10,
} as const;

/**
 * 调度器抽象 —— 默认用 requestAnimationFrame,测试可注入假调度器。
 * 这样 PlaybackEngine 的循环逻辑不依赖浏览器 API,可纯单测(design §13.1)。
 */
export interface Scheduler {
  /** 请求下一帧回调,返回取消 id */
  requestFrame(cb: () => void): number;
  /** 取消回调 */
  cancelFrame(id: number): void;
}

/** 默认浏览器 rAF 调度器 */
export const rafScheduler: Scheduler = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

export class PlaybackEngine {
  private player: PlayerAdapter;
  private scheduler: Scheduler;
  private loopCue: Cue | null = null;
  private frameId: number | null = null;
  /** 刚执行了 seek,下一帧跳过边界判定(防抖,避免 seek 后 currentTime 未更新导致反复 seek) */
  private justSeeked = false;
  private onIteration: () => void;
  private visibilityHandler: (() => void) | null = null;

  constructor(
    player: PlayerAdapter,
    options: {
      scheduler?: Scheduler;
      /** 每完成一轮循环时回调(UI 可用于计数/动效) */
      onIteration?: () => void;
    },
  ) {
    this.player = player;
    this.scheduler = options.scheduler ?? rafScheduler;
    this.onIteration = options.onIteration ?? (() => {});
  }

  /**
   * 启动 cue 循环。
   * 立即 seek 到 cue 起点并开始播放,然后 rAF 轮询。
   */
  startLoop(cue: Cue): void {
    const sameCue = this.loopCue?.id === cue.id;
    if (sameCue) {
      // 同一个 cue:只恢复播放,不重新 seek(避免 seek→event→startLoop 无限重入)
      if (this.player.isPaused()) void this.player.play();
      return;
    }
    this.stopLoop();
    this.loopCue = cue;
    this.justSeeked = false;
    this.player.seekToMs(cue.startMs + LOOP_PARAMS.START_OFFSET_MS);
    void this.player.play();
    this.scheduleTick();

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.cancelScheduled();
      } else if (this.loopCue && !this.player.isPaused()) {
        this.scheduleTick();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /** 停止循环(不改变播放位置) */
  stopLoop(): void {
    this.loopCue = null;
    this.cancelScheduled();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /** 当前是否在循环 */
  isLooping(): boolean {
    return this.loopCue !== null;
  }

  /** 销毁 */
  dispose(): void {
    this.stopLoop();
  }

  private scheduleTick(): void {
    if (this.frameId !== null) return;
    this.frameId = this.scheduler.requestFrame(() => {
      this.frameId = null;
      this.tick();
    });
  }

  private cancelScheduled(): void {
    if (this.frameId !== null) {
      this.scheduler.cancelFrame(this.frameId);
      this.frameId = null;
    }
  }

  private tick(): void {
    if (!this.loopCue) { log.debug('tick: 无 loopCue, 停止'); return; }
    if (this.player.isPaused()) { return; } // 暂停,不调日志(太频繁)

    const now = this.player.getCurrentTimeMs();
    const cue = this.loopCue;

    if (this.justSeeked) {
      if (now < cue.endMs - LOOP_PARAMS.END_TOLERANCE_MS) {
        this.justSeeked = false;
      }
    } else if (now >= cue.endMs - LOOP_PARAMS.END_TOLERANCE_MS) {
      log.debug('tick: 到末尾, seek 回起点 +10ms');
      this.player.seekToMs(cue.startMs + LOOP_PARAMS.START_OFFSET_MS);
      this.justSeeked = true;
      this.onIteration();
    }

    this.scheduleTick();
  }
}
