/**
 * Caption Adapter —— design §6.1。
 * 业务层只依赖此接口,具体字幕获取方式不散落到 UI 或播放层。
 * 探针证实:timedtext 端点因 PO Token 失效,走 get_transcript InnerTube 端点。
 */

import type { CaptionTrack, CaptionTrackSummary } from '../shared/types.js';

/**
 * CaptionAdapter 接口。design §6.1。
 */
export interface CaptionAdapter {
  /** 列出可用的字幕轨道(不含 cue 数据) */
  listTracks(): Promise<CaptionTrackSummary[]>;
  /** 加载指定轨道,返回完整 cue */
  loadTrack(trackId: string): Promise<CaptionTrack>;
  /** 当前是否可用(页面有字幕数据) */
  isAvailable(): boolean;
  /**
   * 等待字幕元数据就绪(如 YouTube SPA 下 captions 异步填充)。
   * 返回 true 表示就绪,false 表示超时。
   * 假适配器可直接返回 true。
   */
  waitForReady(timeoutMs?: number): Promise<boolean>;
  /** 销毁,清理监听 */
  dispose(): void;
}
