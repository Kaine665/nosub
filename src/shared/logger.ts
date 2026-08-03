/**
 * nosub 统一日志系统。
 *
 * 设计:
 * - 前缀 `[nosub]` + 模块标签,便于在 YouTube 嘈杂的控制台里筛
 * - 分级:debug/info/warn/error,生产可关 debug
 * - 全局开关,运行时可调 nosub.logger 调级别
 * - 所有日志走这里,不允许散落的 console.log(design §13.4)
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

class Logger {
  /** 当前最低输出级别(低于此级别的不输出) */
  level: LogLevel = 'info';

  /** 模块工厂:createLogger('caption') → 带标签的 logger */
  createLogger(module: string): ModuleLogger {
    return new ModuleLogger(module, this);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

class ModuleLogger {
  constructor(
    private readonly module: string,
    private readonly root: Logger,
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.root.level];
  }

  private prefix(level: LogLevel): string {
    const tag = level === 'error' ? '✗' : level === 'warn' ? '!' : level === 'info' ? 'ℹ' : '·';
    return `%c[nosub:${this.module}] ${tag}`;
  }

  private style(level: LogLevel): string {
    const colors: Record<LogLevel, string> = {
      debug: 'color:#888',
      info: 'color:#06c',
      warn: 'color:#c80',
      error: 'color:#c00;font-weight:bold',
      silent: '',
    };
    return colors[level];
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    console.log(this.prefix('debug'), this.style('debug'), message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    console.log(this.prefix('info'), this.style('info'), message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.prefix('warn'), this.style('warn'), message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return;
    console.error(this.prefix('error'), this.style('error'), message, ...args);
  }
}

/** 全局 logger 实例 */
export const logger = new Logger();

// 暴露到 window 便于运行时调试:(nosub as any).logger.setLevel('debug')
if (typeof window !== 'undefined') {
  (window as unknown as { nosub?: { logger: Logger } }).nosub = {
    ...(window as unknown as { nosub?: object }).nosub,
    logger,
  };
}
