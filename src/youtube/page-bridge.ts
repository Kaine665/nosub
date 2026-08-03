/**
 * PageBridge —— content script 与 MAIN world 的通信桥梁。
 *
 * 主世界脚本由 manifest world:MAIN content_script 注入(page-script.ts),
 * 通过 postMessage 回传 snapshot 和 transcript 响应。
 * content script(隔离世界)通过此 bridge 收发消息。
 *
 * 字幕获取最终策略:不构造请求(复刻 body 400),而是触发 YouTube 的
 * transcript 按钮,拦截响应后用 proxy 传回。
 */

import { logger } from '../shared/logger.js';

const log = logger.createLogger('bridge');

/** 从主世界抓取的 YouTube 数据快照 */
export interface YouTubePageSnapshot {
  playerResponse: unknown;
  initialData: unknown;
  innerTubeApiKey?: string;
}

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class PageBridge {
  private injected = false;
  private latestSnapshot: YouTubePageSnapshot | null = null;
  private listener: ((e: MessageEvent) => void) | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private cachedProxyResponse: unknown = null;
  private reqId = 0;

  /** 开始监听(主世界脚本由 manifest content_scripts world:MAIN 注入) */
  start(): void {
    if (this.injected) return;
    this.injected = true;

    // 监听主世界回传的消息
    this.listener = (e: MessageEvent) => {
      if (e.source !== window) return;
      const data = e.data as { __nosub?: boolean; type?: string; payload?: unknown; reqId?: number };
      if (!data?.__nosub) return;
      switch (data.type) {
        case 'snapshot':
          this.latestSnapshot = data.payload as YouTubePageSnapshot;
          log.debug('收到 snapshot: playerResponse:', !!this.latestSnapshot.playerResponse, 'initialData:', !!this.latestSnapshot.initialData);
          break;
        case 'transcript-response': {
          // proxy 响应(reqId=-2):resolve 所有 pending 请求
          if (data.reqId === -2) {
            this.cachedProxyResponse = data.payload;
            for (const r of this.pendingRequests.values()) { clearTimeout(r.timer); r.resolve(data.payload); }
            this.pendingRequests.clear();
          } else {
            const req = this.pendingRequests.get(String(data.reqId ?? -1));
            if (req) { this.pendingRequests.delete(String(data.reqId)); clearTimeout(req.timer); req.resolve(data.payload); }
          }
          break;
        }
        case 'transcript-error': {
          const req = this.pendingRequests.get(String(data.reqId ?? -1));
          if (req) {
            this.pendingRequests.delete(String(data.reqId));
            clearTimeout(req.timer);
            const p = data.payload as { error?: string; status?: number };
            req.reject(new Error(p?.error ?? `HTTP ${p?.status ?? '?'}`));
          }
          break;
        }
      }
    };
    window.addEventListener('message', this.listener);
    log.debug('bridge 已启动,等待主世界 snapshot');
  }

  /** 请求主世界重读一次(SPA 切视频后数据变了) */
  requestSnapshot(): void {
    window.postMessage({ __nosub: true, type: 'request-snapshot' }, '*');
  }

  /**
   * 获取字幕数据。
   * 最终策略:触发 YouTube 自己的 transcript 请求,拦截响应后返回。
   * 如果已有缓存的 proxy 响应,立即返回;否则挂起等 proxy。
   */
  fetchTranscript(_params: string, _languageCode: string, _kind?: string, timeoutMs = 15000): Promise<unknown> {
    // 已有缓存的 proxy 响应(上一个视频的 transcript 已拦截过)
    if (this.cachedProxyResponse) {
      const r = this.cachedProxyResponse;
      this.cachedProxyResponse = null; // 每次只用一次,防旧数据混入新视频
      return Promise.resolve(r);
    }
    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new Error('fetchTranscript 超时(请点击视频页面上的"显示文字版"按钮以触发字幕加载)'));
      }, timeoutMs);
      this.pendingRequests.set(String(id), { resolve, reject, timer });
      // 触发 MAIN world 的主动 transcript 按钮点击
      window.postMessage({ __nosub: true, type: 'trigger-transcript' }, '*');
      log.debug('fetchTranscript: 请求触发 transcript, 等待 proxy...');
    });
  }

  /**
   * 等待 snapshot 就绪(主世界已读到 captions 等)。
   * 轮询:每次 requestSnapshot 触发主世界回传,检查 payload。
   */
  async waitForReady(timeoutMs = 10000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.latestSnapshot?.playerResponse) {
        // 进一步检查 captions 字段存在(即使无字幕,captions 字段也会是确定状态)
        const pr = this.latestSnapshot.playerResponse as { captions?: unknown };
        if (pr?.captions !== undefined) {
          log.debug('waitForReady: 就绪');
          return true;
        }
      }
      this.requestSnapshot();
      await new Promise((r) => setTimeout(r, 200));
    }
    log.warn('waitForReady: 超时');
    return false;
  }

  /** 获取最新 snapshot */
  getSnapshot(): YouTubePageSnapshot | null {
    return this.latestSnapshot;
  }

  dispose(): void {
    if (this.listener) {
      window.removeEventListener('message', this.listener);
      this.listener = null;
    }
    this.latestSnapshot = null;
    this.injected = false;
  }
}

/** 单例 bridge —— 整个 content script 共享一个 */
export const pageBridge = new PageBridge();
