/**
 * ListeningUI —— 视频画面上的精听界面(编排器)。
 *
 * 职责: 订阅 ViewState → 分发给子组件 → 组装 DOM → 绑定事件。
 * 不直接渲染任何 UI 细节 —— 那些在 components/ 里。
 */

import type { SessionController, ViewState } from '../content/session-controller.js';
import { DictionaryService } from '../assistance/dictionary-service.js';

import { renderSubtitle } from './components/subtitle-display.js';
import { renderControlBar } from './components/control-bar.js';
import { WordPopup } from './components/word-popup.js';

// CSS 以字符串导入, 注入 Shadow DOM
import nosubCSS from './styles/nosub.css?raw';

export interface ListeningUIOptions {
  shadow: ShadowRoot;
  controller: SessionController;
}

const dictionary = new DictionaryService();

export class ListeningUI {
  private shadow: ShadowRoot;
  private controller: SessionController;
  private root: HTMLElement;
  private unsub: (() => void) | null = null;
  private popup: WordPopup;
  private currentCueText = '';
  private currentCueId: string | null = null;
  /** 弹层打开时的 cue / 单词, 用于重绘后恢复高亮与锚点 */
  private popupCueId: string | null = null;
  private activeWord: string | null = null;

  constructor(opts: ListeningUIOptions) {
    this.shadow = opts.shadow;
    this.controller = opts.controller;
    this.popup = new WordPopup(dictionary, opts.controller.getState().interfaceLanguage ?? 'en');

    this.shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = nosubCSS;
    this.shadow.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'nosub-overlay';
    this.shadow.appendChild(this.root);

    this.render(opts.controller.getState());
    this.unsub = opts.controller.subscribe((s) => this.render(s));
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.popup.dismiss();
    this.shadow.innerHTML = '';
  }

  // ---- 编排 ----

  private render(state: ViewState): void {
    const cueId = state.activeCue?.id ?? null;

    // 换句时关闭查词卡, 避免挡画面 / 锚点错乱
    if (this.popup.isOpen && this.popupCueId && cueId !== this.popupCueId) {
      this.popup.dismiss();
    }

    if (state.activeCue) {
      this.currentCueText = state.activeCue.text;
      this.currentCueId = state.activeCue.id;
    } else {
      this.currentCueId = null;
    }

    const cueHtml = renderSubtitle({
      cue: state.activeCue,
      revealLevel: state.revealLevel,
      isRepeating: state.isRepeating,
      translationAvailable: state.translationAvailable,
      locale: state.interfaceLanguage,
    });

    const barHtml = renderControlBar({
      revealLevel: state.revealLevel,
      isRepeating: state.isRepeating,
      status: state.status,
      playbackRate: state.playbackRate,
      errorMessage: state.errorMessage,
      locale: state.interfaceLanguage,
    });

    this.root.innerHTML = cueHtml + barHtml;

    // 同句重绘(如翻译返回)时恢复单词高亮, 保证弹层锚点可测
    if (this.popup.isOpen && this.activeWord && cueId === this.popupCueId) {
      const match = [...this.root.querySelectorAll('.nosub-word')].find(
        (el) => (el as HTMLElement).dataset.word?.toLowerCase() === this.activeWord,
      ) as HTMLElement | undefined;
      match?.classList.add('active');
    }

    this.root.querySelectorAll('.nosub-word').forEach((el) => {
      el.addEventListener('click', (e) => this.handleWordClick(e));
    });
    this.root.querySelector('[data-action="exit-loop"]')
      ?.addEventListener('click', () => this.controller.requestNext());
  }

  private handleWordClick(e: Event): void {
    const span = (e.target as HTMLElement).closest('.nosub-word') as HTMLElement | null;
    const word = span?.dataset.word;
    if (!word || !span) return;

    this.root.querySelectorAll('.nosub-word.active').forEach((el) => el.classList.remove('active'));
    span.classList.add('active');

    const measure = () => {
      const wordEl = this.root.querySelector('.nosub-word.active') as HTMLElement | null;
      const cueEl = this.root.querySelector('.nosub-cue-box') as HTMLElement | null;
      const target = wordEl ?? (span.isConnected ? span : null);
      if (!target) return null;
      const wordRect = target.getBoundingClientRect();
      // 断开节点的 rect 全是 0, 不可用
      if (wordRect.width === 0 && wordRect.height === 0) return null;
      const cueRect = cueEl?.getBoundingClientRect() ?? wordRect;
      return { wordRect, cueRect };
    };

    const anchor = measure();
    if (!anchor) return;

    // show() 内部会先 dismiss 并触发旧 onDismiss, 因此状态要在 show 之后再挂
    this.popup.show(word, anchor, this.currentCueText, measure);
    this.activeWord = word.toLowerCase();
    this.popupCueId = this.currentCueId;
    this.popup.onDismiss = () => {
      this.activeWord = null;
      this.popupCueId = null;
      this.root.querySelectorAll('.nosub-word.active').forEach((el) => el.classList.remove('active'));
    };
  }
}
