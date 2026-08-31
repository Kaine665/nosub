/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyboardController } from '../../src/content/keyboard-controller.js';
import type { SessionController } from '../../src/content/session-controller.js';

function makeMockController() {
  return {
    toggleFocusedListening: vi.fn(),
    requestLoopBack: vi.fn(),
    requestNext: vi.fn(),
    toggleReveal: vi.fn(),
    togglePlaybackRate: vi.fn(),
  };
}

function pressKey(opts: {
  key: string;
  target?: HTMLElement;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: opts.key,
    bubbles: true,
    cancelable: true,
    repeat: opts.repeat ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
  });
  if (opts.defaultPrevented) {
    Object.defineProperty(event, 'defaultPrevented', { value: true });
  }
  // 派发到 target 或 document.body
  (opts.target ?? document.body).dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('KeyboardController 按键映射', () => {
  it('Q 键 → toggleFocusedListening', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'q' });
    expect(mock.toggleFocusedListening).toHaveBeenCalledTimes(1);
    kc.detach();
  });

  it('A 键 → requestLoopBack', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'a' });
    expect(mock.requestLoopBack).toHaveBeenCalledTimes(1);
    kc.detach();
  });

  it('D 键 → requestNext', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'd' });
    expect(mock.requestNext).toHaveBeenCalledTimes(1);
    kc.detach();
  });

  it('S 键 → toggleReveal', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 's' });
    expect(mock.toggleReveal).toHaveBeenCalledTimes(1);
    kc.detach();
  });

  it('E 键 → togglePlaybackRate', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'e' });
    expect(mock.togglePlaybackRate).toHaveBeenCalledTimes(1);
    kc.detach();
  });

  it('大小写不敏感(Q 和 q 等价)', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'Q' });
    expect(mock.toggleFocusedListening).toHaveBeenCalledTimes(1);
    kc.detach();
  });

  it('非目标键不触发任何意图', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'x' });
    pressKey({ key: 'b' });
    pressKey({ key: 'Enter' });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
    kc.detach();
  });
});

describe('KeyboardController 过滤规则', () => {
  it('YouTube 搜索框输入 wasd 不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    const input = document.createElement('input');
    document.body.appendChild(input);
    pressKey({ key: 'a', target: input });
    pressKey({ key: 's', target: input });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
    expect(mock.toggleReveal).not.toHaveBeenCalled();
    kc.detach();
  });

  it('textarea 中不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    pressKey({ key: 'e', target: ta });
    expect(mock.togglePlaybackRate).not.toHaveBeenCalled();
    kc.detach();
  });

  it('contenteditable 元素中不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    pressKey({ key: 'd', target: div });
    expect(mock.requestNext).not.toHaveBeenCalled();
    kc.detach();
  });

  it('组合键 Ctrl+A 不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'a', ctrlKey: true });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
    kc.detach();
  });

  it('组合键 Cmd+D (Mac) 不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'd', metaKey: true });
    expect(mock.requestNext).not.toHaveBeenCalled();
    kc.detach();
  });

  it('组合键 Alt+S 不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 's', altKey: true });
    expect(mock.toggleReveal).not.toHaveBeenCalled();
    kc.detach();
  });

  it('长按(repeat=true)不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'a', repeat: true });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
    kc.detach();
  });

  it('插件禁用时不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => false });
    kc.attach();
    pressKey({ key: 'a' });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
    kc.detach();
  });

  it('defaultPrevented 的事件不触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    pressKey({ key: 'a', defaultPrevented: true });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
    kc.detach();
  });
});

describe('KeyboardController attach/detach', () => {
  it('detach 后不再触发', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    kc.detach();
    pressKey({ key: 'a' });
    expect(mock.requestLoopBack).not.toHaveBeenCalled();
  });

  it('重复 attach 幂等(不重复监听)', () => {
    const mock = makeMockController();
    const kc = new KeyboardController(mock as unknown as SessionController, { isEnabled: () => true });
    kc.attach();
    kc.attach(); // 第二次应无效果
    pressKey({ key: 'a' });
    expect(mock.requestLoopBack).toHaveBeenCalledTimes(1); // 只触发一次
    kc.detach();
  });
});
