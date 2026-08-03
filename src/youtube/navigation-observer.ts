/**
 * NavigationObserver —— 检测 YouTube SPA 导航 + videoId 变化。
 * design §6.4。
 *
 * 职责(单一):把"YouTube 内部切了视频"变成可订阅事件。
 * 不负责 dispose/recreate 旧会话 —— 那是 bootstrap 的活。
 *
 * 检测策略(探针 §4):
 * - 主路径:yt-navigate-finish 事件(YouTube 自己抛)
 * - 兜底:popstate + URL 轮询(防 YouTube 改事件名导致漏判)
 * - 双保险:两种信号都归一到 videoId 变化判定
 */

/** 导航事件 */
export type NavigationEvent =
  | { type: 'videochange'; videoId: string; fromVideoId: string | undefined }
  | { type: 'leave-watch' }; // 离开 /watch(去首页/搜索页等)

export type NavigationListener = (event: NavigationEvent) => void;

/** 从 URL 提取 videoId */
export function extractVideoId(url: string = location.href): string | null {
  const m = url.match(/[?&]v=([\w-]{11})/);
  return m?.[1] ?? null;
}

/** 当前是否在 /watch 视频页 */
export function isWatchPage(url: string = location.href): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'www.youtube.com' && u.pathname === '/watch';
  } catch {
    return false;
  }
}

export class NavigationObserver {
  private listeners = new Set<NavigationListener>();
  private currentVideoId: string | null = null;
  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastUrl: string = location.href;

  /** 绑定的 DOM 事件处理器(用于 dispose) */
  private readonly boundOnNavigateFinish: () => void;
  private readonly boundOnPopState: () => void;
  private readonly boundOnUrlPoll: () => void;

  constructor() {
    this.boundOnNavigateFinish = () => this.checkForChange();
    this.boundOnPopState = () => this.checkForChange();
    this.boundOnUrlPoll = () => this.checkForChange();
  }

  /** 启动监听 */
  start(): void {
    if (this.disposed) return;
    // 同步 lastUrl:构造函数和 start() 之间可能发生了 URL 变化(tests 常见)
    this.lastUrl = location.href;
    this.currentVideoId = isWatchPage() ? extractVideoId() : null;

    // 主路径:YouTube SPA 导航完成事件
    window.addEventListener('yt-navigate-finish', this.boundOnNavigateFinish);
    // 兜底 1:浏览器前进/后退
    window.addEventListener('popstate', this.boundOnPopState);
    // 兜底 2:URL 轮询(防 yt-navigate-finish 被改/漏抛;1s 间隔够轻)
    this.pollTimer = setInterval(this.boundOnUrlPoll, 1000);
  }

  /** 订阅导航事件,返回取消函数 */
  subscribe(listener: NavigationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 当前 videoId(无则 null) */
  getCurrentVideoId(): string | null {
    return this.currentVideoId;
  }

  /** 销毁,移除所有监听 */
  dispose(): void {
    this.disposed = true;
    window.removeEventListener('yt-navigate-finish', this.boundOnNavigateFinish);
    window.removeEventListener('popstate', this.boundOnPopState);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.listeners.clear();
  }

  /** 检测 URL/videoId 是否变化,变化则通知 */
  private checkForChange(): void {
    if (this.disposed) return;
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;

    const wasWatch = this.currentVideoId !== null;
    const nowWatch = isWatchPage();
    const newVideoId = nowWatch ? extractVideoId() : null;

    // 离开 /watch
    if (wasWatch && !nowWatch) {
      this.currentVideoId = null;
      this.emit({ type: 'leave-watch' });
      return;
    }

    // videoId 变化(含首次进入 /watch)
    if (newVideoId && newVideoId !== this.currentVideoId) {
      const fromVideoId = this.currentVideoId ?? undefined;
      this.currentVideoId = newVideoId;
      this.emit({ type: 'videochange', videoId: newVideoId, fromVideoId });
    }
  }

  private emit(event: NavigationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个监听器异常不影响其他(design §13.2)
      }
    }
  }
}
