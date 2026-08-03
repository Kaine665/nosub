/**
 * Player Adapter —— design §6.3。
 * 集中封装所有对 YouTube 播放器 DOM / 页面对象的访问。
 * 业务层只依赖此接口,不直接碰 <video> 或页面私有对象。
 */

/** 播放器事件 */
export type PlayerEvent =
  | { type: 'timeupdate'; currentTimeMs: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; currentTimeMs: number }
  | { type: 'ended' }
  | { type: 'videochange'; videoId: string };

export type PlayerEventListener = (event: PlayerEvent) => void;

/**
 * PlayerAdapter 接口。design §6.3。
 * 时间统一用毫秒。
 */
export interface PlayerAdapter {
  /** 当前播放位置(ms) */
  getCurrentTimeMs(): number;
  /** seek 到指定位置(ms)。探针证实直接 video.currentTime = 即可 */
  seekToMs(timeMs: number): void;
  /** 播放 */
  play(): Promise<void>;
  /** 暂停 */
  pause(): void;
  /** 是否暂停 */
  isPaused(): boolean;
  /** 当前视频 ID */
  getVideoId(): string;
  /** 订阅播放器事件,返回取消订阅函数 */
  subscribe(listener: PlayerEventListener): () => void;
  /** 销毁,移除所有监听器和定时器 */
  dispose(): void;
  /** 播放器是否就绪 */
  isReady(): boolean;
  /** 获取播放速率 (1.0 正常) */
  getPlaybackRate(): number;
  /** 设置播放速率 */
  setPlaybackRate(rate: number): void;
  /**
   * 等待播放器元素就绪(如 YouTube <video> 元素出现在 DOM)。
   * 返回 true 表示就绪,false 表示超时。
   * 假适配器可直接返回 true。
   */
  attach(timeoutMs?: number): Promise<boolean>;
}
