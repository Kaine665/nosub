/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListeningUI } from '../../src/ui/listening-ui.js';
import type { ViewState } from '../../src/content/session-controller.js';

function makeMockController(state: Partial<ViewState>) {
  const fullState: ViewState = {
    playbackRate: 1, revealLevel: 0, translationAvailable: false, interfaceLanguage: 'en',
    ...state,
  } as ViewState;
  return {
    _state: fullState,
    getState: () => fullState,
    getCueWindow: vi.fn(() => fullState.activeCue ? [fullState.activeCue] : []),
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
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
  });
});

// ========== 控制栏 ==========

describe('控制栏', () => {
  it('所有状态都显示 NOSUB 品牌', () => {
    for (const status of ['loading', 'unsupported', 'error'] as const) {
      const { shadow } = setup({ status, isRepeating: false });
      expect(shadow.textContent).toContain('NOSUB');
    }
  });

  it('正常播放显示 Repeat / Captions / Next / Speed', () => {
    const { shadow } = setup({ status: 'ready', isRepeating: false });
    expect(shadow.textContent).toContain('Repeat');
    expect(shadow.textContent).toContain('Captions');
    expect(shadow.textContent).toContain('Next');
    expect(shadow.textContent).toContain('Speed');
  });

  it('循环中动态显示 Previous 和 Exit', () => {
    const { shadow } = setup({ status: 'ready', isRepeating: true });
    expect(shadow.textContent).toContain('Previous');
    expect(shadow.textContent).toContain('Exit');
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

  it('免费用户的 Pro 提示显示在翻译行，不占用控制栏', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 2,
      isRepeating: false, translationAvailable: true, isPro: false,
    });
    const translationLine = shadow.querySelector('.nosub-cue-line.translated');
    expect(translationLine?.textContent).toContain('Translation is a Pro feature');
    expect(translationLine?.querySelector('[data-action="open-upgrade"]')).toBeTruthy();
    expect(shadow.querySelector('.nosub-bar [data-action="open-upgrade"]')).toBeNull();
  });

  it('点击翻译行升级按钮会直接请求打开套餐页', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 2,
      isRepeating: false, translationAvailable: true, isPro: false,
    });
    (shadow.querySelector('[data-action="open-upgrade"]') as HTMLElement).click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'billing:open-upgrade' });
  });

  it('挡位 2 无翻译: 英文界面显示 translation off 占位', () => {
    const { shadow } = setup({
      status: 'ready', activeCue: cue, revealLevel: 2,
      isRepeating: false, translationAvailable: false,
    });
    expect(shadow.textContent).toContain('Translation is off');
  });

  it('简体中文界面显示中文控制文案', () => {
    const { shadow } = setup({ status: 'ready', isRepeating: false, interfaceLanguage: 'zh_CN' });
    expect(shadow.textContent).toContain('重听');
    expect(shadow.textContent).toContain('字幕');
    expect(shadow.textContent).toContain('下一句');
    expect(shadow.textContent).toContain('倍速');
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
