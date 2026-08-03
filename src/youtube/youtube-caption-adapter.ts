/**
 * YouTube Caption Adapter 实现。
 *
 * 走探针验证的方案 B(technical-spike.md §1.2):
 * - context: 直接复刻页面 yt.config_.INNERTUBE_CONTEXT 整个对象
 * - params: 从 ytInitialData.engagementPanels[].getTranscriptEndpoint.params 取
 * - 端点:POST youtubei/v1/get_transcript
 *
 * 业务层只通过 CaptionAdapter 接口访问字幕,不直接碰这些页面私有对象。
 */

import type { CaptionAdapter } from './caption-adapter.js';
import { parseTranscriptResponse, pickPreferredTrack, toTrackSummary, trackIdOf } from './caption-parser.js';
import type { CaptionTrack, CaptionTrackSummary, Cue, RawCaptionTrack } from '../shared/types.js';
import { AppError } from '../shared/errors.js';
import { normalizeCues } from '../playback/cue-index.js';
import { logger } from '../shared/logger.js';
import { pageBridge } from './page-bridge.js';

const log = logger.createLogger('caption');

/** 主世界 playerResponse 的最小结构(由 pageBridge 回传) */
interface PlayerResponseLike {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: RawCaptionTrack[];
    };
  };
}

/** 从 bridge snapshot 读原始 track 列表 */
function readRawTracks(): RawCaptionTrack[] {
  const snap = pageBridge.getSnapshot();
  if (!snap) return [];
  const pr = snap.playerResponse as PlayerResponseLike | null;
  const captions = pr?.captions;
  const tracks = captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) {
    log.debug('readRawTracks: 无 track。snapshot 存在:', !!snap, 'captions 存在:', !!captions, 'playerResponse 存在:', !!pr);
  }
  return tracks;
}

/** 从 bridge snapshot 的 initialData 里递归找 getTranscriptEndpoint.params */
function findTranscriptParams(): string | null {
  const snap = pageBridge.getSnapshot();
  const data = snap?.initialData as { engagementPanels?: unknown[] } | null;
  if (!data?.engagementPanels) return null;

  const found: string[] = [];
  const walk = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    const o = obj as Record<string, unknown>;
    if (o.getTranscriptEndpoint && typeof o.getTranscriptEndpoint === 'object') {
      const params = (o.getTranscriptEndpoint as { params?: unknown }).params;
      if (typeof params === 'string') found.push(params);
    }
    for (const key in o) {
      const val = o[key];
      if (val && typeof val === 'object') walk(val);
    }
  };
  walk(data.engagementPanels);

  return found[0] ?? null;
}

export class YouTubeCaptionAdapter implements CaptionAdapter {
  /**
   * 等待字幕元数据就绪(YouTube SPA 下 ytInitialPlayerResponse.captions
   * 在 document_idle 后才异步填充)。
   * @param timeoutMs 最长等待时间,默认 10s
   * @returns 就绪(至少能读到 captions 结构)返回 true,超时返回 false
   */
  async waitForReady(timeoutMs = 10000): Promise<boolean> {
    // 委托给 pageBridge —— 它通过主世界注入脚本读数据,
    // 绕过 content script 隔离世界看不到 ytInitialPlayerResponse 的问题
    return pageBridge.waitForReady(timeoutMs);
  }

  async listTracks(): Promise<CaptionTrackSummary[]> {
    const raw = readRawTracks();
    log.debug('listTracks: 原始 track 数', raw.length);
    if (raw.length > 0) {
      log.debug('track 列表', raw.map((t) => `${t.languageCode}/${t.kind ?? 'manual'}`));
    }
    return raw.map((r, i) => toTrackSummary(r, i));
  }

  async loadTrack(trackId: string): Promise<CaptionTrack> {
    const tracks = readRawTracks();
    const index = this.parseIndexFromId(trackId);
    const raw = tracks[index];
    if (!raw) {
      log.error('loadTrack: 轨道不存在', trackId, '已有', tracks.length);
      throw new AppError('TRACK_LOAD_FAILED', `字幕轨道不存在: ${trackId}`);
    }

    const params = findTranscriptParams();
    if (!params) {
      log.error('loadTrack: 未找到 getTranscriptEndpoint params');
      throw new AppError(
        'TRACK_LOAD_FAILED',
        '页面未提供 getTranscriptEndpoint params(可能未点开 transcript 面板或视频无字幕)',
      );
    }
    log.debug('loadTrack: params token 长度', params.length);

    // 关键:INNERTUBE_CONTEXT 不能通过 postMessage 传(content script 隔离世界读不到,
    // 序列化又会丢字段导致 400 FAILED_PRECONDITION)。
    // 所以 fetch 在 MAIN world 的 page-script 里执行,只把解析后的响应 JSON 传回来。
    log.debug('loadTrack: 走 MAIN world bridge fetch', raw.languageCode, raw.kind ?? 'manual');
    let data: unknown;
    try {
      data = await pageBridge.fetchTranscript(params, raw.languageCode, raw.kind);
    } catch (e) {
      log.error('loadTrack: MAIN world fetch 失败', (e as Error).message);
      throw new AppError('TRACK_LOAD_FAILED', `get_transcript 失败: ${(e as Error).message}`);
    }

    const rawCues = parseTranscriptResponse(data);
    log.debug('loadTrack: 解析出 cue 数', rawCues.length);
    if (rawCues.length === 0) {
      log.error('loadTrack: 响应未解析出任何 cue');
      throw new AppError('TRACK_LOAD_FAILED', 'get_transcript 响应未解析出任何 cue');
    }

    const cues: Cue[] = normalizeCues(
      rawCues.map((c, i) => ({
        id: `cue-${i}`,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
      })),
    );

    log.info('loadTrack: 成功加载', cues.length, '条 cue');
    return {
      id: trackId,
      languageCode: raw.languageCode,
      label: raw.name ?? raw.languageCode,
      isAutoGenerated: raw.kind === 'asr',
      cues,
    };
  }

  isAvailable(): boolean {
    const tracks = readRawTracks();
    const available = tracks.length > 0;
    log.debug('isAvailable:', available, 'track 数', tracks.length);
    return available;
  }

  dispose(): void {
    // 当前无监听器需要清理;保留方法以满足接口契约
  }

  private parseIndexFromId(trackId: string): number {
    // 格式 track-<index>-<lang>-<kind>
    const parts = trackId.split('-');
    const idx = Number(parts[1]);
    return Number.isFinite(idx) ? idx : 0;
  }

}

export { pickPreferredTrack, trackIdOf };
