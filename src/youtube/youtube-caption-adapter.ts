/**
 * YouTube Caption Adapter 实现。
 *
 * 走探针验证的方案 B(technical-spike.md §1.2):
 * - context: 直接复刻页面 yt.config_.INNERTUBE_CONTEXT 整个对象
 * - params: 从 ytInitialData.engagementPanels[].getTranscriptEndpoint.params 取
 * - 端点:POST youtubei/v1/get_transcript
 *
 * 业务层只通过 CaptionAdapter 接口访问字幕,不直接碰这些页面私有对象。
 *
 * 缓存: 按 videoId 缓存完整 CaptionTrack, 切走再回来不重新请求。
 */

import type { CaptionAdapter } from './caption-adapter.js';
import { parseTranscriptResponse, parseJson3Response, pickPreferredTrack, toTrackSummary, trackIdOf } from './caption-parser.js';
import type { CaptionTrack, CaptionTrackSummary, Cue, RawCaptionTrack } from '../shared/types.js';
import { AppError } from '../shared/errors.js';
import { normalizeCues } from '../playback/cue-index.js';
import { logger } from '../shared/logger.js';
import { pageBridge } from './page-bridge.js';
import { t, type AppLocale } from '../shared/i18n.js';

const log = logger.createLogger('caption');

/** 字幕缓存: videoId → CaptionTrack (最多 30 个视频, LRU) */
const SUBTITLE_CACHE = new Map<string, CaptionTrack>();
const CACHE_MAX = 30;

function cacheSubtitle(videoId: string, track: CaptionTrack): void {
  if (SUBTITLE_CACHE.size >= CACHE_MAX) {
    const oldest = SUBTITLE_CACHE.keys().next().value;
    if (oldest) SUBTITLE_CACHE.delete(oldest);
  }
  SUBTITLE_CACHE.set(videoId, track);
}

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
  /** 当前视频 ID(由 lifecycle 设置, 用于缓存) */
  private _videoId: string | null = null;
  private locale: AppLocale = 'en';

  setVideoId(id: string): void { this._videoId = id; }
  setLocale(loc: AppLocale): void { this.locale = loc; }

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

  async loadTrack(trackId: string, videoId?: string): Promise<CaptionTrack> {
    const vid = videoId ?? this._videoId;

    // 缓存命中
    if (vid) {
      const cached = SUBTITLE_CACHE.get(vid);
      if (cached) {
        log.info('loadTrack: 缓存命中', vid);
        return cached;
      }
    }

    const tracks = readRawTracks();
    const index = this.parseIndexFromId(trackId);
    const raw = tracks[index];
    const isAsr = raw?.kind === 'asr';

    // === 路径 B: IOS timedtext (主路径, 不点按钮, 全屏可用) ===
    if (vid) {
      let rawCues: Array<{ startMs: number; endMs: number; text: string }> = [];
      const B_TIMEOUT = 4000;
      const B_RETRIES = 3;
      const B_INTERVAL = 1500;

      for (let attempt = 1; attempt <= B_RETRIES; attempt++) {
        try {
          log.debug(`loadTrack[B/${attempt}]: IOS timedtext`, vid);
          const json3 = await pageBridge.fetchTimedText(vid, B_TIMEOUT);
          rawCues = parseJson3Response(json3);
          if (rawCues.length > 0) {
            log.info(`loadTrack[B]: 成功 (${rawCues.length} cues, 尝试 ${attempt})`);
            break;
          }
          log.debug(`loadTrack[B/${attempt}]: 0 cues, 重试...`);
        } catch (e) {
          log.debug(`loadTrack[B/${attempt}]: 失败`, (e as Error).message);
        }
        if (attempt < B_RETRIES) {
          await new Promise(r => setTimeout(r, B_INTERVAL));
        }
      }

      if (rawCues.length > 0) {
        const track = this.buildTrack(trackId, rawCues, isAsr);
        cacheSubtitle(vid, track);
        return track;
      }
    }

    // === 路径 C: get_transcript 拦截 (兜底) ===
    // 全屏时按钮在 DOM 外, 提醒用户退出全屏
    if (document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement) {
      throw new AppError('TRACK_LOAD_FAILED', t('fullscreenBlocking', this.locale));
    }
    log.info('loadTrack[C]: IOS timedtext 失败, 降级到 get_transcript (按钮方案)');

    if (!raw) {
      throw new AppError('TRACK_LOAD_FAILED', t('trackNotFound', this.locale));
    }

    const params = findTranscriptParams();
    if (!params) {
      throw new AppError('TRACK_LOAD_FAILED', t('transcriptParamsMissing', this.locale));
    }

    let data: unknown;
    try {
      data = await pageBridge.fetchTranscript(params, raw.languageCode, raw.kind);
    } catch (e) {
      throw new AppError('TRACK_LOAD_FAILED', `${t('transcriptFetchFailed', this.locale)}: ${(e as Error).message}`);
    }

    const rawCues = parseTranscriptResponse(data);
    if (rawCues.length === 0) {
      throw new AppError('TRACK_LOAD_FAILED', t('transcriptEmpty', this.locale));
    }

    const track = this.buildTrack(trackId, rawCues, isAsr, raw.name ?? raw.languageCode);
    if (vid) cacheSubtitle(vid, track);
    return track;
  }

  private buildTrack(
    trackId: string,
    rawCues: Array<{ startMs: number; endMs: number; text: string }>,
    isAsr: boolean,
    label?: string,
  ): CaptionTrack {
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
      languageCode: 'en',
      label: label ?? 'English',
      isAutoGenerated: isAsr,
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
