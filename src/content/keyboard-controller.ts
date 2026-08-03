/**
 * KeyboardController —— design §7, tasks T11。
 *
 * 把按键事件映射到 SessionController 的意图。
 * 职责单一:监听 keydown,过滤后调用 controller 的对应方法。
 *
 * 过滤规则(design §7):
 * - event.defaultPrevented → 跳过
 * - ctrl/meta/alt 组合键 → 跳过(不抢 YouTube 原生快捷键)
 * - 焦点在 input/textarea/select/contenteditable → 跳过(不抢用户输入)
 * - event.repeat → 跳过(长按防瞬间跨多 cue)
 * - 插件未启用或无字幕会话 → 跳过
 *
 * 大小写不敏感(A 和 a 等价),符合"目标语字幕显隐"等场景的用户预期。
 */

import type { SessionController } from './session-controller.js';

export interface KeyboardControllerOptions {
  /** 判断插件是否启用(禁用时不拦截按键) */
  isEnabled: () => boolean;
}

const TARGET_KEYS = new Set(['a', 'd', 's', 'e']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

export class KeyboardController {
  private controller: SessionController;
  private options: KeyboardControllerOptions;
  private bound: ((e: KeyboardEvent) => void) | null = null;

  constructor(controller: SessionController, options: KeyboardControllerOptions) {
    this.controller = controller;
    this.options = options;
  }

  /** 启动监听 */
  attach(): void {
    if (this.bound) return; // 幂等
    const handler = (e: KeyboardEvent) => this.handleKey(e);
    this.bound = handler;
    window.addEventListener('keydown', handler, true); // capture 阶段,优先于 YouTube
  }

  /** 停止监听 */
  detach(): void {
    if (this.bound) {
      window.removeEventListener('keydown', this.bound, true);
      this.bound = null;
    }
  }

  private handleKey(e: KeyboardEvent): void {
    // 过滤规则(顺序按性能:便宜的先判)
    if (e.defaultPrevented) return;
    if (e.repeat) return; // 长按重复
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.options.isEnabled()) return;
    if (isEditableTarget(e.target)) return;

    const key = e.key.toLowerCase();
    if (!TARGET_KEYS.has(key)) return;

    // 命中目标键 → 映射到意图
    switch (key) {
      case 'a':
        this.controller.requestLoopBack();
        break;
      case 'd':
        this.controller.requestNext();
        break;
      case 's':
        this.controller.toggleReveal();
        break;
      case 'e':
        this.controller.togglePlaybackRate();
        break;
    }
    e.preventDefault(); // 阻止 YouTube 原生行为(如 a 键不触发其它)
  }
}
