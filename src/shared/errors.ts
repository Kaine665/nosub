/**
 * nosub 错误类型。design §12。
 * 核心错误(播放器/字幕)和辅助服务错误分开,辅助错误只影响对应面板。
 */
export type AppErrorCode =
  | 'PLAYER_UNAVAILABLE'
  | 'CAPTIONS_UNAVAILABLE'
  | 'TRACK_LOAD_FAILED'
  | 'TRANSLATION_UNAVAILABLE'
  | 'DICTIONARY_FAILED'
  | 'EXPLANATION_FAILED';

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(
    code: AppErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }

  /** 是否为核心错误(影响精听主流程) */
  isCoreError(): boolean {
    return (
      this.code === 'PLAYER_UNAVAILABLE' ||
      this.code === 'CAPTIONS_UNAVAILABLE' ||
      this.code === 'TRACK_LOAD_FAILED'
    );
  }
}
