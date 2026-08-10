/**
 * SessionLifecycle —— 管理 YouTube 视频切换时的资源生命周期。
 * design §6.4, tasks T08。
 *
 * 职责:
 * - 检测到 videochange 时:dispose 旧 player/caption adapter、清空 UI 容器
 * - 新视频就绪后:创建新 player adapter 并 attach、重挂 UI 容器
 * - 保证幂等:不重复创建、不重复监听
 * - 并发安全:快速切视频时,晚到的 stale 会话不会覆盖新会话
 *
 * 不负责:播放状态机逻辑(T09)、UI 内容(T12)、字幕加载触发(T09)。
 * 它只提供"当前会话的 adapter 句柄",由 T09 SessionController 使用。
 *
 * 构造函数接受可选工厂函数用于测试注入;
 * 生产环境不传,默认使用 YouTube 真实适配器。
 */

import { YouTubePlayerAdapter } from '../youtube/youtube-player-adapter.js';
import type { PlayerAdapter } from '../youtube/player-adapter.js';
import { YouTubeCaptionAdapter } from '../youtube/youtube-caption-adapter.js';
import type { CaptionAdapter } from '../youtube/caption-adapter.js';
import { NavigationObserver, type NavigationEvent } from '../youtube/navigation-observer.js';
import { unmountAppContainer, mountAppContainer } from './app-container.js';
import { logger } from '../shared/logger.js';
import { pageBridge } from '../youtube/page-bridge.js';

const log = logger.createLogger('lifecycle');

/** 工厂函数类型——用于测试注入 */
export type PlayerAdapterFactory = (videoId: string) => PlayerAdapter;
export type CaptionAdapterFactory = () => CaptionAdapter;

export interface ActiveSession {
  videoId: string;
  player: PlayerAdapter;
  captions: CaptionAdapter;
}

export type SessionLifecycleListener = (
  event:
    | { type: 'session-started'; session: ActiveSession }
    | { type: 'session-ending'; videoId: string }
    | { type: 'no-session' },
) => void;

export class SessionLifecycle {
  private observer = new NavigationObserver();
  private listeners = new Set<SessionLifecycleListener>();
  private active: ActiveSession | null = null;
  private disposed = false;
  /** 并发守卫:每次 navigation 递增,startSession 提交时检查是否为最新 */
  private sessionGen = 0;
  /** 工厂函数——生产环境不传,用 YouTube 真实实现;测试可注入 fake */
  private readonly playerFactory: PlayerAdapterFactory;
  private readonly captionFactory: CaptionAdapterFactory;

  constructor(
    playerFactory?: PlayerAdapterFactory,
    captionFactory?: CaptionAdapterFactory,
  ) {
    this.playerFactory = playerFactory ?? ((videoId) => new YouTubePlayerAdapter(videoId));
    this.captionFactory = captionFactory ?? (() => new YouTubeCaptionAdapter());
  }

  /** 启动生命周期管理 */
  async start(): Promise<void> {
    if (this.disposed) return;
    // 启动 pageBridge,并行等待主世界 MAIN world 脚本给 snapshot
    pageBridge.start();
    this.observer.subscribe((event) => this.handleNavigation(event));
    this.observer.start();

    // 首次:若已在视频页,直接初始化(也用 gen 防并发)
    if (this.observer.getCurrentVideoId()) {
      const gen = ++this.sessionGen;
      await this.startSession(this.observer.getCurrentVideoId()!, gen);
    } else {
      this.emit({ type: 'no-session' });
    }
  }

  /** 订阅会话生命周期事件 */
  subscribe(listener: SessionLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 当前活跃会话(可能为 null) */
  getActiveSession(): ActiveSession | null {
    return this.active;
  }

  dispose(): void {
    this.disposed = true;
    this.endSession();
    this.observer.dispose();
    this.listeners.clear();
  }

  private async handleNavigation(event: NavigationEvent): Promise<void> {
    if (this.disposed) return;

    if (event.type === 'leave-watch') {
      this.endSession();
      this.emit({ type: 'no-session' });
      return;
    }

    if (event.type === 'videochange') {
      // 并发守卫:每次 navigation 递增 generation
      const gen = ++this.sessionGen;
      // 先结束旧会话(无论新旧 videoId 是否相同,统一重建,保证干净)
      this.endSession();
      // SPA 切视频后,主世界的 ytInitialPlayerResponse 会被 YouTube 替换;
      // 让 pageBridge 重新请求一次 snapshot
      pageBridge.requestSnapshot();
      await this.startSession(event.videoId, gen);
    }
  }

  /**
   * 创建新会话:挂 player、挂 UI 容器。
   * @param gen 可选 generation——非 undefined 时只在 gen === this.sessionGen 时提交,
   *            防止快速切视频时 stale 异步完成覆盖新会话。
   */
  private async startSession(videoId: string, gen?: number): Promise<void> {
    if (this.disposed) return;
    log.info('startSession:', videoId, gen !== undefined ? `gen=${gen}` : '');

    const player = this.playerFactory(videoId);
    const attached = await player.attach(8000);
    if (this.disposed) {
      player.dispose();
      return;
    }
    if (!attached) {
      log.warn('startSession: player attach 超时(8s 未找到 <video>)');
      player.dispose();
      this.emit({ type: 'no-session' });
      return;
    }

    const captions = this.captionFactory();
    // 设置 videoId 到 adapter (用于字幕缓存)
    if ('setVideoId' in captions) {
      (captions as { setVideoId: (id: string) => void }).setVideoId(videoId);
    }
    // 关键:等 YouTube 字幕元数据就绪(SPA 下 captions 异步填充,
    // document_idle 时可能还没到 → isAvailable 误判 false)
    const captionsReady = await captions.waitForReady(10000);
    if (this.disposed) {
      player.dispose();
      captions.dispose();
      return;
    }

    // 并发守卫:如果此 startSession 的 gen 已过时(期间有新 navigation),
    // 丢弃本会话,不覆盖更新的那一个
    if (gen !== undefined && gen !== this.sessionGen) {
      log.warn('startSession: gen 过时(当前=', this.sessionGen, '本=', gen, '),丢弃');
      player.dispose();
      captions.dispose();
      return;
    }

    if (!captionsReady) {
      log.warn('startSession: captions 元数据等待超时,仍继续(UI 会显示 unsupported)');
    }
    mountAppContainer();
    log.debug('startSession: player + captions 就绪,容器已挂');

    this.active = { videoId, player, captions };
    this.emit({ type: 'session-started', session: this.active });
  }

  /** 结束会话:dispose adapter、清 UI(tasks T08: 切视频必清) */
  private endSession(): void {
    if (!this.active) return;
    const endingVideoId = this.active.videoId;
    this.emit({ type: 'session-ending', videoId: endingVideoId });

    this.active.player.dispose();
    this.active.captions.dispose();
    unmountAppContainer();
    this.active = null;
  }

  private emit(event: Parameters<SessionLifecycleListener>[0]): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个监听器异常不影响其他(design §13.2)
      }
    }
  }
}
