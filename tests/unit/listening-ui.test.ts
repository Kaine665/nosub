/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListeningUI } from '../../src/ui/listening-ui.js';
import type { ViewState } from '../../src/content/session-controller.js';

function makeMockController(state: Partial<ViewState>) {
  const fullState: ViewState = {
    playbackRate: 1, revealLevel: 0, translationAvailable: false,
    ...state,
  } as ViewState;
  return {
    _state: fullState,
    getState: () => fullState,
    subscribe: vi.fn((cb: (s: ViewState) => void) => {
      (mockController as unknown as { _emit: (s: ViewState) => void })._emit = cb;
      return () => {};
    }),
    requestNext: vi.fn(),
    requestLoopBack: vi.fn(),
    toggleReveal: vi.fn(),
    togglePlaybackRate: vi.fn(),
    _emit: (_s: ViewState) => {},
  };
}

let mockController: ReturnType<typeof makeMockController>;

function setup(state: Partial<ViewState>): { shadow: ShadowRoot; ui: ListeningUI } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  mockController = makeMockController(state);
  const ui = new ListeningUI({ shadow, controller: mockController as never });
  return { shadow, ui };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ========== 控制栏 ==========

describe('控制栏', () => {
  it('所有状态都显示 NOSUB 品牌', () => {
    for (const status of ['loading', 'unsupported', 'error'] as const) {
      const { shadow } = setup({ status, isRepeating: false });
      expect(shadow.textContent).toContain('NOSUB');
    }
  });

  it('ready 显示 S/A/E 控制项', () => {
    const { shadow } = setup({ status: 'ready', isRepeating: false });
    expect(shadow.textContent).toContain('S');
    expect(shadow.textContent).toContain('循环');
  });

  it('revealLevel=0 时 S 显示 ○', () => {
    const { shadow } = setup({ status: 'ready', revealLevel: 0, isRepeating: false });
    expect(shadow.textContent).toContain('○');
  });

  it('revealLevel=1 时 S 显示 ①', () => {
    const { shadow } = setup({ status: 'ready', revealLevel: 1, isRepeating: false });
    expect(shadow.textContent).toContain('①');
  });

  it('revealLevel=2 时 S 显示 ②', () => {
    const { shadow } = setup({ status: 'ready', revealLevel: 2, isRepeating: false });
    expect(shadow.textContent).toContain('②');
  });
});

// ========== 字幕揭示 ==========

describe('字幕揭示挡位', () => {
  const cue = { id: 'c1', startMs: 0, endMs: 100, text: 'hello world' };

  it('挡位 0 + normal: 不显示字幕', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 0, isRepeating: false,
    });
    expect(shadow.textContent).not.toContain('hello');
  });

  it('挡位 0 + repeat: 白色圆角块遮挡, 字母不可见', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 0, isRepeating: true,
    });
    const words = shadow.querySelectorAll('.nosub-word');
    expect(words.length).toBe(2);
    expect(words[0].classList.contains('nosub-word-hidden')).toBe(true);
    // 字母 color: transparent — 不在屏幕上显示但仍在 DOM 中
    const restSpan = words[0].querySelector('.nosub-letter-rest') as HTMLElement;
    expect(restSpan).toBeTruthy();
  });

  it('挡位 1: 显示完整单词', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 1, isRepeating: false,
    });
    expect(shadow.textContent).toContain('hello');
    expect(shadow.textContent).toContain('world');
    expect(shadow.querySelectorAll('.nosub-word').length).toBe(2);
  });

  it('挡位 2: 完整单词 + 翻译', () => {
    const { shadow } = setup({
      status: 'ready',
      activeCue: { ...cue, translatedText: '你好世界' },
      revealLevel: 2, isRepeating: false,
    });
    expect(shadow.textContent).toContain('hello');
    expect(shadow.textContent).toContain('你好世界');
  });

  it('挡位 2 无翻译: 显示翻译未配置占位', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 2,
      isRepeating: false, translationAvailable: false,
    });
    expect(shadow.textContent).toContain('翻译未配置');
  });
});

// ========== 循环 ==========

describe('循环模式', () => {
  it('循环时显示循环指示器', () => {
    const { shadow } = setup({
      status: 'ready', revealLevel: 1, isRepeating: true,
      activeCue: { id: 'c1', startMs: 0, endMs: 100, text: 'x' },
    });
    expect(shadow.querySelector('.nosub-loop-indicator.visible')).toBeTruthy();
  });

  it('退出循环按钮调用 requestNext', () => {
    const { shadow } = setup({
      status: 'ready', revealLevel: 2, isRepeating: true,
      activeCue: { id: 'c1', startMs: 0, endMs: 100, text: 'x' },
    });
    (shadow.querySelector('[data-action="exit-loop"]') as HTMLElement)?.click();
    expect(mockController.requestNext).toHaveBeenCalledTimes(1);
  });
});

// ========== dispose ==========

describe('dispose', () => {
  it('dispose 清空 Shadow DOM', () => {
    const { shadow, ui } = setup({
      status: 'ready', revealLevel: 2, isRepeating: false,
      activeCue: { id: 'c1', startMs: 0, endMs: 100, text: 'x' },
    });
    ui.dispose();
    expect(shadow.innerHTML).toBe('');
  });
});
