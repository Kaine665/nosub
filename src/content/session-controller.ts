/**
 * SessionController —— design §3.1, tasks T09。
 *
 * 中央协调器:持有 player / caption adapters / 播放状态。
 * 对外暴露"意图"(requestLoopBack/requestNext/...)和只读 ViewState。
 * UI 和键盘控制器不直接碰播放器,只通过此 Controller。
 *
 * 不负责:
 * - 循环调度的高频轮询(T10 PlaybackEngine)
 * - DOM 事件绑定(T11 KeyboardController)
 * - UI 渲染(T12)
 *
 * Controller 自身用 FakePlayerAdapter 可完整测试(design §13.2)。
 */

import type { PlayerAdapter } from '../youtube/player-adapter.js';
import type { CaptionAdapter } from '../youtube/caption-adapter.js';
import type { CaptionTrack, Cue, UserSettings } from '../shared/types.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import {
  createSession,
  handleAKey,
  handleDKey,
  handleMediaChange,
  handleUserSeek,
  isUserSeek,
  markInternalSeek,
  updateActiveCue,
  type ListeningSession,
} from '../playback/playback-state.js';
import { findCurrentCue } from '../playback/cue-index.js';
import { logger } from '../shared/logger.js';
import type { Scheduler } from '../playback/playback-engine.js';
import { rafScheduler } from '../playback/playback-engine.js';
import { TranslationService } from '../assistance/translation-service.js';
import { GoogleTranslateProvider } from '../assistance/providers/google-translate-provider.js';
import { resolveLocale, t, type AppLocale } from '../shared/i18n.js';

const log = logger.createLogger('controller');

/** F 键循环的播放速率 */
const PLAYBACK_RATES: number[] = [1.0, 0.8, 0.6];

/** S 键字幕揭示挡位 */
export type RevealLevel = 0 | 1 | 2;
// 0 = 隐藏(normal 无 / loop 白块), 1 = 字幕, 2 = 字幕+翻译

/** UI 订阅的派生状态。design §8.2。 */
export interface ViewState {
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  activeCue?: Cue;
  isRepeating: boolean;
  /** S 键挡位: 0=隐藏 1=首字母 2=完整 3=完整+翻译 */
  revealLevel: RevealLevel;
  /** 翻译是否已配置 (有 TranslationProvider 且能返回结果) */
  translationAvailable: boolean;
  /** 当前播放速率 */
  playbackRate: number;
  interfaceLanguage: AppLocale;
  /** null while account status is loading; translation remains available until resolved. */
  isPro?: boolean;
  upgradeRequired?: boolean;
  errorMessage?: string;
}

export type ViewStateListener = (state: ViewState) => void;

export class SessionController {
  private player: PlayerAdapter;
  private captions: CaptionAdapter;
  private session: ListeningSession | null = null;
  private track: CaptionTrack | null = null;
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<ViewStateListener>();
  /** 字幕 ticker:正常播放时用 rAF 跟踪当前 cue(T12 字幕组件) */
  private tickerId: number | null = null;
  /** 翻译服务 */
  private translation: TranslationService;
  /** S 键挡位: 正常和循环各记各的 */
  private normalLevel: RevealLevel = 0;
  private loopLevel: RevealLevel = 0;
  private proAccess: boolean | null = null;
  private upgradeRequired = false;
  private lastView: ViewState = {
    status: 'loading',
    isRepeating: false,
    revealLevel: 0,
    translationAvailable: false,
    playbackRate: 1,
    interfaceLanguage: 'en',
  };

  constructor(
    player: PlayerAdapter,
    captions: CaptionAdapter,
    private readonly scheduler: Scheduler = rafScheduler,
    translation?: TranslationService,
  ) {
    this.player = player;
    this.captions = captions;
    this.translation = translation ?? new TranslationService([new GoogleTranslateProvider()]);
    // 订阅播放器 seek 事件,判定是否用户主动拖动
    this.player.subscribe((event) => {
      if (event.type === 'seek') {
        this.handleSeekEvent(event.currentTimeMs);
      }
    });
  }

  /** 初始化:加载字幕轨道 */
  async init(videoId: string): Promise<void> {
    log.info('init: videoId', videoId);
    const locale = resolveLocale(this.settings.interfaceLanguage);
    this.emit({ status: 'loading', isRepeating: false, revealLevel: 0, translationAvailable: this.isTranslationAvailable(), playbackRate: this.player.getPlaybackRate(), interfaceLanguage: locale });

    if (!this.captions.isAvailable()) {
      log.warn('init: captions.isAvailable() 返回 false → unsupported');
      this.emit({ status: 'unsupported', isRepeating: false, revealLevel: 0, translationAvailable: false, playbackRate: 1, interfaceLanguage: locale, errorMessage: t('videoHasNoCaptions', locale) });
      return;
    }

    try {
      const tracks = await this.captions.listTracks();
      log.debug('init: listTracks 返回', tracks.length, '条');
      if (tracks.length === 0) {
        log.warn('init: listTracks 为空 → unsupported');
        this.emit({ status: 'unsupported', isRepeating: false, revealLevel: 0, translationAvailable: false, playbackRate: 1, interfaceLanguage: locale, errorMessage: t('videoHasNoCaptions', locale) });
        return;
      }
      const preferred = (this.settings.targetLanguage ?? 'en').toLowerCase();
      const selected = tracks.find((track) => track.languageCode.toLowerCase() === preferred)
        ?? tracks.find((track) => track.languageCode.toLowerCase().startsWith(`${preferred}-`))
        ?? tracks.find((track) => track.languageCode.toLowerCase().startsWith('en'))
        ?? tracks[0];
      const loaded = await this.captions.loadTrack(selected.id);
      this.track = loaded;
      this.session = createSession(videoId, loaded.id, loaded.cues);
      log.info('init: 就绪, cue 数', loaded.cues.length);
      this.startTicker(); // 启动字幕跟踪
      this.emit(this.deriveState());
    } catch (e) {
      log.error('init: 加载失败', (e as Error).message);
      this.emit({ status: 'error', isRepeating: false, revealLevel: 0, translationAvailable: false, playbackRate: 1, interfaceLanguage: locale, errorMessage: t('captionLoadFailed', locale) });
    }
  }

  /** 意图:循环回退(对应 A 键) */
  requestLoopBack(): void {
    if (!this.session) return;
    const now = this.player.getCurrentTimeMs();
    const { session, intent } = handleAKey(this.session, now);
    this.session = session;
    // 每次进入循环或切到前一句时, 重置挡位为隐藏(0)
    if (this.session.mode.kind === 'repeat') {
      this.loopLevel = 0;
    }
    if (intent.type === 'seek' && typeof intent.targetMs === 'number') {
      this.session = markInternalSeek(this.session, intent.targetMs, Date.now());
    }
    log.debug('requestLoopBack: mode=', this.session.mode.kind);
    this.emit(this.deriveState());
  }

  /** 意图:下一句(对应 D 键) */
  requestNext(): void {
    if (!this.session) return;
    const { session, intent } = handleDKey(this.session);
    this.session = session;
    // requestNext 不依赖 PlaybackEngine(退出循环,engine 收到 stopLoop),
    // 所以这里自己执行 seek。
    if (intent.type === 'seek' && typeof intent.targetMs === 'number') {
      if (intent.markInternal) {
        this.session = markInternalSeek(this.session, intent.targetMs, Date.now());
      }
      this.player.seekToMs(intent.targetMs);
      void this.player.play();
    }
    this.emit(this.deriveState());
  }

  /** 意图:S 键 — 循环挡位 0→1→2→3→0 */
  toggleReveal(): void {
    const repeating = this.session?.mode.kind === 'repeat';
    const current = repeating ? this.loopLevel : this.normalLevel;
    const next = ((current + 1) % 3) as RevealLevel;
    if (next === 2 && this.proAccess === false) {
      this.upgradeRequired = true;
      this.emit(this.deriveState());
      return;
    }
    this.upgradeRequired = false;
    if (repeating) this.loopLevel = next;
    else this.normalLevel = next;
    this.emit(this.deriveState());
    // 到挡位 2 时, 预加载当前 cue 翻译
    const activeLevel = this.session?.mode.kind === 'repeat' ? this.loopLevel : this.normalLevel;
    if (activeLevel === 2 && this.session?.activeCueId) {
      this.prefetchTranslations(this.session.activeCueId);
    }
  }

  /** 意图:切换播放速度(对应 F 键)。循环 1.0 → 0.8 → 0.6 → 1.0 */
  togglePlaybackRate(): void {
    const current = this.player.getPlaybackRate();
    const idx = PLAYBACK_RATES.indexOf(current);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    this.player.setPlaybackRate(next);
    log.debug('playbackRate:', current, '→', next);
    this.emit(this.deriveState());
  }

  /** 播放器 seek 事件处理:判定是用户拖动还是插件内部 seek */
  private handleSeekEvent(seekedTimeMs: number): void {
    if (!this.session) return;
    const now = Date.now();
    const isUser = isUserSeek(this.session, seekedTimeMs, now);
    if (isUser) {
      const { session, intent } = handleUserSeek(this.session, seekedTimeMs);
      if (session === this.session && intent.type === 'none') {
        return; // session 未变且无意图:不 emit,避免触发 startLoop 重入
      }
      this.session = session;
      this.applyIntent(intent);
      this.emit(this.deriveState());
    }
  }

  /**
   * 由 PlaybackEngine(T10)周期调用,更新 active cue。
   * 也可由 controller 自己的定时器驱动(此处留接口,T10 实现)。
   */
  onTick(currentTimeMs: number): void {
    if (!this.session) return;
    const prevCueId = this.session.activeCueId;
    const updated = updateActiveCue(this.session, currentTimeMs);
    if (updated !== this.session) {
      this.session = updated;
      this.emit(this.deriveState());
      // active cue 变了 → 预加载翻译(不管当前挡位, 提前准备)
      const newCueId = this.session.activeCueId;
      if (newCueId && newCueId !== prevCueId) {
        this.prefetchTranslations(newCueId);
      }
    }
  }

  /**
   * 执行状态机产生的意图(副作用)。
   * 标记内部 seek、seek 播放器、播放。
   */
  private applyIntent(intent: { type: string; targetMs?: number; markInternal?: boolean }): void {
    if (intent.type === 'seek' && typeof intent.targetMs === 'number') {
      // 先标记内部 seek,再执行(标记窗口覆盖即将触发的 seek 事件)
      if (intent.markInternal && this.session) {
        this.session = markInternalSeek(this.session, intent.targetMs, Date.now());
      }
      this.player.seekToMs(intent.targetMs);
      void this.player.play();
    }
    // exitLoop / cleanup / none:无播放器副作用
  }

  /** 从 session + settings 派生只读 ViewState */
  private deriveState(): ViewState {
    if (!this.session || !this.track) {
      return {
        status: 'loading',
        isRepeating: false,
        revealLevel: this.getActiveLevel(),
        translationAvailable: this.isTranslationAvailable(),
        playbackRate: this.player.getPlaybackRate(),
        interfaceLanguage: resolveLocale(this.settings.interfaceLanguage),
        isPro: this.proAccess === true,
        upgradeRequired: this.upgradeRequired,
      };
    }
    const activeCueId = this.session.activeCueId;
    const activeCue = activeCueId ? this.track.cues.find((c) => c.id === activeCueId) : undefined;
    return {
      status: 'ready',
      activeCue,
      isRepeating: this.session.mode.kind === 'repeat',
      revealLevel: this.getActiveLevel(),
      translationAvailable: this.isTranslationAvailable(),
      playbackRate: this.player.getPlaybackRate(),
      interfaceLanguage: resolveLocale(this.settings.interfaceLanguage),
      isPro: this.proAccess === true,
      upgradeRequired: this.upgradeRequired,
    };
  }

  /** 当前活跃的挡位(正常 vs 循环) */
  private getActiveLevel(): RevealLevel {
    return this.session?.mode.kind === 'repeat' ? this.loopLevel : this.normalLevel;
  }

  /** 订阅 ViewState 变化 */
  subscribe(listener: ViewStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 当前 ViewState(快照,返回最后一次 emit 的状态) */
  getState(): ViewState {
    return this.lastView;
  }

  /** 当前 session(供 T10 PlaybackEngine 使用) */
  getSession(): ListeningSession | null {
    return this.session;
  }

  /** 当前轨道 */
  getTrack(): CaptionTrack | null {
    return this.track;
  }

  /** 更新设置(T13 持久化加载时调用) */
  updateSettings(settings: Partial<UserSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.normalLevel = this.settings.showTranslatedCaption
      ? 2
      : this.settings.showTargetCaption ? 1 : 0;
    this.emit(this.deriveState());
  }

  /** Apply the account entitlement loaded by the extension background. */
  setProAccess(isPro: boolean): void {
    this.proAccess = isPro;
    if (!isPro) {
      if (this.normalLevel === 2) this.normalLevel = 1;
      if (this.loopLevel === 2) this.loopLevel = 1;
    }
    this.emit(this.deriveState());
  }

  private isTranslationAvailable(): boolean {
    return this.settings.translationLanguage !== 'off' && this.translation.hasProvider();
  }

  /** 销毁会话(视频/轨道变更) */
  dispose(): void {
    this.stopTicker();
    this.translation.clearCache();
    const result = handleMediaChange();
    this.session = result.session;
    this.track = null;
    this.listeners.clear();
  }

  // ---- 翻译 ----

  /** 预加载范围:当前 cue 前后各多少条 */
  private static readonly PREFETCH_RANGE = 10;

  /**
   * 预翻译当前 cue 前后各 N 条。
   * 当前 cue 优先,其余后台静默加载。
   */
  private prefetchTranslations(centerCueId: string): void {
    if (!this.track || !this.isTranslationAvailable()) return;

    const cues = this.track.cues;
    const centerIdx = cues.findIndex((c) => c.id === centerCueId);
    if (centerIdx < 0) return;

    const range = SessionController.PREFETCH_RANGE;
    const start = Math.max(0, centerIdx - range);
    const end = Math.min(cues.length - 1, centerIdx + range);

    // 逐条翻译(TranslationService 内部有缓存,已翻译的秒返回)
    for (let i = centerIdx; i <= end; i++) {
      void this.translateOne(cues[i]);
    }
    for (let i = centerIdx - 1; i >= start; i--) {
      void this.translateOne(cues[i]);
    }
  }

  /** 翻译单条 cue,成功/失败后如果是 active cue 则重新 emit */
  private async translateOne(cue: Cue): Promise<void> {
    if (cue.translatedText || cue.translationFailed || !this.isTranslationAvailable()) return;

    try {
      const result = await this.translation.translate({
        text: cue.text,
        sourceLanguage: this.settings.targetLanguage ?? 'en',
        targetLanguage: this.settings.translationLanguage ?? 'zh-CN',
      });
      if (result) {
        cue.translatedText = result.translatedText;
        cue.translationFailed = false;
      } else {
        cue.translationFailed = true;
      }
      if (this.session?.activeCueId === cue.id) {
        this.emit(this.deriveState());
      }
    } catch (err) {
      cue.translationFailed = true;
      log.warn('translateOne failed:', (err as Error).message);
      if (this.session?.activeCueId === cue.id) {
        this.emit(this.deriveState());
      }
    }
  }

  // ---- 字幕 ticker ----

  /** 启动正常播放时的字幕跟踪(rAF 轮询 active cue) */
  private startTicker(): void {
    if (this.tickerId !== null) return; // 幂等
    const tick = (): void => {
      if (this.tickerId === null) return; // 已停止
      this.onTick(this.player.getCurrentTimeMs());
      this.tickerId = this.scheduler.requestFrame(tick);
    };
    this.tickerId = this.scheduler.requestFrame(tick);
  }

  /** 停止字幕跟踪 */
  private stopTicker(): void {
    if (this.tickerId !== null) {
      this.scheduler.cancelFrame(this.tickerId);
      this.tickerId = null;
    }
  }

  private emit(state: ViewState): void {
    this.lastView = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // 单个监听器异常不影响其他(design §13.2)
      }
    }
  }
}

export { findCurrentCue };
