/**
 * TranslationService —— 字幕翻译抽象层。
 *
 * 统一接口,不管底层是 Google Translate / DeepL / LLM / 本地词典,
 * 业务层只依赖此接口。
 *
 * design §9: 外部服务可降级,翻译失败不影响精听核心。
 * design §16.3: 翻译服务来源为开放决策,此接口隔离具体实现。
 */

import { logger } from '../shared/logger.js';

const log = logger.createLogger('translate');

// ---- 公共类型 ----

/** 翻译请求 */
export interface TranslationRequest {
  /** 要翻译的文本(通常是一条 cue) */
  text: string;
  /** 源语言(ISO 639-1,如 "en") */
  sourceLanguage: string;
  /** 目标语言(ISO 639-1,如 "zh-CN") */
  targetLanguage: string;
  /** 当前 cue 的上下文(可选,供 LLM 类服务参考) */
  context?: {
    videoId: string;
    cueId: string;
  };
}

/** 翻译结果 */
export interface TranslationResult {
  /** 翻译后的文本 */
  translatedText: string;
  /** 使用的服务名(用于日志/调试) */
  service: string;
  /** 置信度 0-1(可选,部分服务提供) */
  confidence?: number;
}

// ---- 抽象接口 ----

/**
 * 翻译提供方接口。每个具体服务实现此接口。
 * design §9.1: 服务接口必须有超时和失败降级。
 */
export interface TranslationProvider {
  /** 服务名称(如 "google", "deepl", "llm") */
  readonly name: string;

  /**
   * 翻译单条文本。
   * 失败时返回 null,不抛异常(由 TranslationService 统一处理降级)。
   */
  translate(request: TranslationRequest): Promise<TranslationResult | null>;

  /** 当前是否可用(网络检查/配额检查) */
  isAvailable(): Promise<boolean>;
}

// ---- 服务编排 ----

export class TranslationService {
  /** 按优先级排列的提供方,第一个可用的胜出 */
  private providers: TranslationProvider[];
  /** 翻译缓存: key = `${text}|${target}` */
  private cache = new Map<string, TranslationResult>();
  /** 当前激活的提供方(null=未探测) */
  private activeProvider: TranslationProvider | null | undefined;
  /** 上一次翻译失败时, 激活 provider 是否就是 google(用于 UI 给出区域建议) */
  private lastGoogleFailed = false;

  constructor(providers: TranslationProvider[]) {
    this.providers = providers;
  }

  /** 同步检查:是否配置了任何 provider(不代表网络通) */
  hasProvider(): boolean {
    return this.providers.length > 0;
  }

  /** 获取所有 provider(用于外部设置 API Key) */
  getProviders(): TranslationProvider[] {
    return this.providers;
  }

  /** Google 最近一次翻译是否失败(用于 UI 给出区域兜底建议) */
  wasGoogleJustFailed(): boolean {
    return this.lastGoogleFailed;
  }

  /** 根据用户 locale 推荐区域翻译服务 */
  static recommendProvider(locale: string): { name: string; label: string; url: string } | null {
    const lang = locale.toLowerCase();
    if (lang.startsWith('zh')) return { name: 'baidu', label: '百度翻译', url: 'https://fanyi-api.baidu.com/api/trans/product/desktop' };
    if (lang.startsWith('ru')) return { name: 'yandex', label: 'Yandex Translate', url: 'https://translate.yandex.com/developers/keys' };
    if (lang.startsWith('ko')) return { name: 'papago', label: 'Papago (Naver)', url: 'https://developers.naver.com/docs/papago/papago-nmt-overview.md' };
    return null;
  }

  /**
   * 翻译单条文本。
   *
   * 策略:
   * 1. 查缓存(同一句不重复请求, 切视频不清缓存)
   * 2. 用已探测的 activeProvider
   * 3. 网络失败时静默重试 2 次, 间隔 1s
   * 4. 全部失败 → 返回 null(UI 显示"暂无翻译")
   */
  async translate(request: TranslationRequest): Promise<TranslationResult | null> {
    const cacheKey = `${request.text}|${request.targetLanguage}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      log.debug('cache hit:', request.text.slice(0, 30));
      return cached;
    }

    // 探测可用 provider(仅首次)
    if (this.activeProvider === undefined) {
      this.activeProvider = await this.detectProvider();
    }

    if (this.activeProvider === null) {
      log.debug('无可用翻译服务');
      return null;
    }

    const providerName = this.activeProvider.name;
    const retryDelays = [2000, 5000];
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const result = await this.activeProvider.translate(request);
        if (result) {
          this.lastGoogleFailed = false;
          this.cache.set(cacheKey, result);
          if (this.cache.size > 500) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) this.cache.delete(firstKey);
          }
          return result;
        }
      } catch (err) {
        log.warn(`翻译失败 (attempt ${attempt + 1}/${retryDelays.length + 1}):`, (err as Error).message);
      }
      if (attempt < retryDelays.length) {
        await new Promise(r => setTimeout(r, retryDelays[attempt]));
      }
    }

    // 全部重试失败: 如果当前只有 google provider, 标记以便 UI 给出区域建议
    if (providerName === 'google') {
      this.lastGoogleFailed = true;
    }
    return null;
  }

  /** 批量翻译(用于预加载整个轨道的翻译) */
  async translateBatch(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<Map<number, TranslationResult>> {
    const results = new Map<number, TranslationResult>();
    // 逐条翻译(大部分免费 API 不支持真正的批量)
    for (let i = 0; i < texts.length; i++) {
      const result = await this.translate({
        text: texts[i],
        sourceLanguage,
        targetLanguage,
      });
      if (result) results.set(i, result);
    }
    return results;
  }

  /** 重置 provider 探测(切视频时调用, 但不清翻译缓存) */
  clearCache(): void {
    // 不清 cache —— 同一句话在不同视频里翻译结果一样, 没必要重新请求
    this.activeProvider = undefined; // 重新探测 provider 可用性
  }

  // ---- 内部 ----

  private async detectProvider(): Promise<TranslationProvider | null> {
    for (const p of this.providers) {
      try {
        if (await p.isAvailable()) {
          log.info('翻译服务就绪:', p.name);
          return p;
        }
      } catch {
        // 继续试下一个
      }
    }
    log.warn('所有翻译服务均不可用');
    return null;
  }
}
