/**
 * YouTube Player Adapter 实现。
 *
 * 直接操作页面 <video> 元素,不依赖 IFrame API(探针 B2 确认直接 currentTime= 可行,
 * IFrame API 需 postMessage 往返 + onReady,在本场景纯属添乱)。
 *
 * 所有 DOM 访问集中在此文件。YouTube 页面结构变化时只改这里(design §13.4)。
 */

import type { PlayerAdapter, PlayerEvent, PlayerEventListener } from './player-adapter.js';

/** 获取 <video> 元素的选择器。YouTube 多年稳定,但若变化只改这里。 */
const VIDEO_SELECTOR = 'video.html5-main-video, video';

export class YouTubePlayerAdapter implements PlayerAdapter {
  private listeners = new Set<PlayerEventListener>();
  private video: HTMLVideoElement | null = null;
  private disposed = false;
  private videoId: string;

  /** 绑定到 video 的事件处理器,用于 dispose 时移除 */
  private boundHandlers: Array<{ event: string; handler: EventListener }> = [];

  constructor(videoId: string) {
    this.videoId = videoId;
  }

  /**
   * 等待并绑定 <video> 元素。
   * YouTube 是 SPA,<video> 可能在 content script 注入后才创建。
   * 返回 false 表示超时未找到。
   */
  async attach(timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.disposed) {
      const video = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
      if (video) {
        this.bindVideo(video);
        return true;
      }
      await sleep(100);
    }
    return false;
  }

  private bindVideo(video: HTMLVideoElement): void {
    // 先清理旧的绑定(防止重复 attach 时事件叠加)
    if (this.video && this.boundHandlers.length > 0) {
      for (const { event, handler } of this.boundHandlers) {
        this.video.removeEventListener(event, handler);
      }
      this.boundHandlers = [];
    }

    this.video = video;
    const on = (event: string, handler: (e: Event) => void) => {
      video.addEventListener(event, handler);
      this.boundHandlers.push({ event, handler });
    };

    on('timeupdate', () => this.emit({ type: 'timeupdate', currentTimeMs: this.ms() }));
    on('play', () => this.emit({ type: 'play' }));
    on('pause', () => this.emit({ type: 'pause' }));
    on('seeking', () => this.emit({ type: 'seek', currentTimeMs: this.ms() }));
    on('ended', () => this.emit({ type: 'ended' }));
  }

  private ms(): number {
    return (this.video?.currentTime ?? 0) * 1000;
  }

  private emit(event: PlayerEvent): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个监听器异常不影响其他(design §13.2)
      }
    }
  }

  isReady(): boolean {
    return this.video !== null && !this.disposed;
  }

  getCurrentTimeMs(): number {
    return this.ms();
  }

  seekToMs(timeMs: number): void {
    if (this.video) this.video.currentTime = timeMs / 1000;
  }

  async play(): Promise<void> {
    try {
      await this.video?.play();
    } catch {
      // autoplay 可能被拒,忽略(design §13.2)
    }
  }

  pause(): void {
    this.video?.pause();
  }

  isPaused(): boolean {
    return this.video?.paused ?? true;
  }

  getPlaybackRate(): number {
    return this.video?.playbackRate ?? 1;
  }

  setPlaybackRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate;
  }

  getVideoId(): string {
    return this.videoId;
  }

  /** 更新 videoId(SPA 导航切到新视频时) */
  setVideoId(videoId: string): void {
    if (this.videoId !== videoId) {
      this.videoId = videoId;
      this.emit({ type: 'videochange', videoId });
    }
  }

  subscribe(listener: PlayerEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const { event, handler } of this.boundHandlers) {
      this.video?.removeEventListener(event, handler);
    }
    this.boundHandlers = [];
    this.listeners.clear();
    this.video = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
