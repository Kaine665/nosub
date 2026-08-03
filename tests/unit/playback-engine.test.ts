/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { PlaybackEngine, LOOP_PARAMS } from '../../src/playback/playback-engine.js';
import type { Scheduler } from '../../src/playback/playback-engine.js';
import { FakePlayerAdapter } from './fake-player-adapter.js';
import type { Cue } from '../../src/shared/types.js';

/**
 * 可控调度器:不自动跑,测试手动调用 runFrame() 触发回调。
 * 这样循环逻辑可纯单测,不依赖真实 rAF。
 */
class FakeScheduler implements Scheduler {
  private nextId = 1;
  private queue: Array<{ id: number; cb: () => void }> = [];
  private cancelled = new Set<number>();

  requestFrame(cb: () => void): number {
    const id = this.nextId++;
    this.queue.push({ id, cb });
    return id;
  }

  cancelFrame(id: number): void {
    this.cancelled.add(id);
  }

  /** 触发所有待执行的 frame 回调 */
  runFrame(): void {
    const pending = this.queue.filter((f) => !this.cancelled.has(f.id));
    this.queue = [];
    for (const f of pending) {
      if (!this.cancelled.has(f.id)) f.cb();
    }
  }

  pendingCount(): number {
    return this.queue.filter((f) => !this.cancelled.has(f.id)).length;
  }
}

const CUE: Cue = { id: 'c1', startMs: 1000, endMs: 2000, text: 'one' };

function makeEngine(scheduler: FakeScheduler, onIteration?: () => void) {
  const player = new FakePlayerAdapter();
  const engine = new PlaybackEngine(player, { scheduler, onIteration });
  return { player, engine };
}

describe('PlaybackEngine.startLoop', () => {
  it('启动时 seek 到 cue 起点(带 offset)并播放', () => {
    const scheduler = new FakeScheduler();
    const { player, engine } = makeEngine(scheduler);
    engine.startLoop(CUE);
    expect(player.getCurrentTimeMs()).toBe(CUE.startMs + LOOP_PARAMS.START_OFFSET_MS);
    expect(player.isPaused()).toBe(false);
    engine.dispose();
  });

  it('到 cue 结束 → seek 回绝对起点(不累加漂移)', () => {
    const scheduler = new FakeScheduler();
    let iterations = 0;
    const { player, engine } = makeEngine(scheduler, () => iterations++);
    engine.startLoop(CUE);
    const seekBack = CUE.startMs + LOOP_PARAMS.START_OFFSET_MS;

    player.tickTo(CUE.endMs - 30);
    scheduler.runFrame();

    expect(iterations).toBe(1);
    expect(player.getCurrentTimeMs()).toBe(seekBack);
    engine.dispose();
  });

  it('10 轮循环无累积漂移', () => {
    const scheduler = new FakeScheduler();
    let iterations = 0;
    const { player, engine } = makeEngine(scheduler, () => iterations++);
    engine.startLoop(CUE);
    const expectedSeek = CUE.startMs + LOOP_PARAMS.START_OFFSET_MS;

    for (let i = 0; i < 10; i++) {
      // 1. 时间到 cue 末尾 → tick seek 回起点
      player.tickTo(CUE.endMs - 30);
      scheduler.runFrame();
      expect(player.getCurrentTimeMs()).toBe(expectedSeek);
      // 2. 模拟下一帧:currentTime 已更新到起点,clear justSeeked
      player.tickTo(expectedSeek);
      scheduler.runFrame();
    }
    expect(iterations).toBe(10);
    engine.dispose();
  });

  it('暂停时停止轮询', () => {
    const scheduler = new FakeScheduler();
    const { player, engine } = makeEngine(scheduler);
    engine.startLoop(CUE);
    expect(engine.isLooping()).toBe(true);

    player.pause();
    player.tickTo(1500);
    scheduler.runFrame();
    expect(player.getCurrentTimeMs()).toBe(1500); // 未被 seek
    expect(scheduler.pendingCount()).toBe(0);
    expect(engine.isLooping()).toBe(true);
    engine.dispose();
  });

  it('stopLoop 后不再 seek', () => {
    const scheduler = new FakeScheduler();
    const { player, engine } = makeEngine(scheduler);
    engine.startLoop(CUE);
    engine.stopLoop();
    expect(engine.isLooping()).toBe(false);

    player.tickTo(CUE.endMs - 30);
    scheduler.runFrame();
    expect(player.getCurrentTimeMs()).toBe(CUE.endMs - 30);
    engine.dispose();
  });

  it('dispose 清理调度和监听', () => {
    const scheduler = new FakeScheduler();
    const { engine } = makeEngine(scheduler);
    engine.startLoop(CUE);
    engine.dispose();
    expect(engine.isLooping()).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('到 cue 结束不播放下一 cue 的内容(立即 seek 回)', () => {
    const scheduler = new FakeScheduler();
    const { player, engine } = makeEngine(scheduler);
    engine.startLoop(CUE);
    player.tickTo(CUE.endMs + 5);
    scheduler.runFrame();
    expect(player.getCurrentTimeMs()).toBeLessThan(CUE.endMs);
    engine.dispose();
  });
});

describe('PlaybackEngine 容差参数', () => {
  it('END_TOLERANCE_MS=60(探针实测 5.6ms,10 倍余量)', () => {
    expect(LOOP_PARAMS.END_TOLERANCE_MS).toBe(60);
  });
  it('START_OFFSET_MS=10(避开上一 cue 边界)', () => {
    expect(LOOP_PARAMS.START_OFFSET_MS).toBe(10);
  });
});
