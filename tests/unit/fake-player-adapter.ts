/**
 * FakePlayerAdapter —— 用于单元/集成测试的可控 PlayerAdapter。
 * design §13.2 要求用假播放器验证业务行为。
 *
 * 不依赖真实 DOM,所有状态由测试代码驱动。
 */

import type { PlayerAdapter, PlayerEvent, PlayerEventListener } from '../../src/youtube/player-adapter.js';

export class FakePlayerAdapter implements PlayerAdapter {
  private listeners = new Set<PlayerEventListener>();
  private currentTimeMs = 0;
  private paused = true;
  private rate = 1;
  private readonly vid: string;

  constructor(videoId = 'fake-video') {
    this.vid = videoId;
  }

  // —— 测试驱动 API ——
  /** 测试用:直接设置当前时间(模拟播放器进度) */
  tickTo(timeMs: number): void {
    this.currentTimeMs = timeMs;
    this.emit({ type: 'timeupdate', currentTimeMs: timeMs });
  }

  /** 测试用:模拟用户 seek */
  simulateUserSeek(timeMs: number): void {
    this.currentTimeMs = timeMs;
    this.emit({ type: 'seek', currentTimeMs: timeMs });
  }

  /** 测试用:模拟播放结束 */
  simulateEnded(): void {
    this.emit({ type: 'ended' });
  }

  private emit(event: PlayerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  // —— PlayerAdapter 实现 ——
  getCurrentTimeMs(): number {
    return this.currentTimeMs;
  }

  seekToMs(timeMs: number): void {
    this.currentTimeMs = timeMs;
  }

  async play(): Promise<void> {
    this.paused = false;
    this.emit({ type: 'play' });
  }

  pause(): void {
    this.paused = true;
    this.emit({ type: 'pause' });
  }

  isPaused(): boolean {
    return this.paused;
  }

  getVideoId(): string {
    return this.vid;
  }

  subscribe(listener: PlayerEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
  }

  isReady(): boolean {
    return true;
  }

  async attach(_timeoutMs?: number): Promise<boolean> {
    return true; // 假适配器:模拟"就绪"
  }

  getPlaybackRate(): number {
    return this.rate;
  }

  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }
}
