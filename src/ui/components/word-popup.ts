/**
 * WordPopup —— 查词卡片。
 *
 * 只显示浏览器当前语言的释义 (zh → 中文, 其他 → 英文)。
 * 音标/音频始终来自英文词典源。
 */

import { DictionaryService, type WordDefinition } from '../../assistance/dictionary-service.js';
import { DictionaryApiProvider } from '../../assistance/providers/dictionary-api-provider.js';
import { GoogleCnProvider } from '../../assistance/providers/google-cn-provider.js';
import type { DefinitionProvider, DefinitionEntry } from '../../assistance/definition-provider.js';
import { escapeHtml } from '../../shared/html-utils.js';

const CARD = { width: 380 };
const GAP_ABOVE_CUE = 10; // 卡片底边与字幕顶边的间距
const VIEW_MARGIN = 8;
const TATOEBA = 'https://tatoeba.org/en/api_v0/search';
const MAX_SENSES = 4;
const MAX_EXAMPLES = 2;

/** 定位锚点: 单词 + 字幕区(卡片应落在字幕上方) */
export interface PopupAnchor {
  wordRect: DOMRect;
  cueRect: DOMRect;
}

const POS_CN: Record<string, string> = {
  noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词',
  preposition: '介词', pronoun: '代词', conjunction: '连词',
  interjection: '感叹词', determiner: '限定词',
};
const POS_ORDER: Record<string, number> = {
  preposition: 1, adverb: 1, adjective: 2, verb: 3, noun: 4,
  pronoun: 5, conjunction: 5, interjection: 6, determiner: 6,
};

function trim(text: string, max = 100): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const breakAt = Math.max(
    slice.lastIndexOf('，'),
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf('、'),
    slice.lastIndexOf(' '),
    slice.lastIndexOf(','),
  );
  return (breakAt > max * 0.5 ? slice.slice(0, breakAt) : slice) + '…';
}

function posLabelText(pos: string): string {
  return POS_CN[pos] || pos;
}

function coreMeaning(def: string): string {
  return def.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '').trim();
}

/** 去掉机器翻译产生的近义重复项 */
function dedupeEntries(entries: DefinitionEntry[]): DefinitionEntry[] {
  const out: DefinitionEntry[] = [];
  for (const e of entries) {
    const core = coreMeaning(e.definition);
    if (!core) continue;
    if (out.some((x) => {
      const xc = coreMeaning(x.definition);
      return xc === core || xc.includes(core) || core.includes(xc);
    })) continue;
    out.push(e);
  }
  return out;
}

function sortEntries(entries: DefinitionEntry[]): DefinitionEntry[] {
  return [...entries].sort((a, b) =>
    (POS_ORDER[a.partOfSpeech] ?? 5) - (POS_ORDER[b.partOfSpeech] ?? 5));
}

export class WordPopup {
  private el: HTMLElement | null = null;
  private dict: DictionaryService;
  private enProvider = new DictionaryApiProvider();
  private cnProvider = new GoogleCnProvider();
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private langProvider: DefinitionProvider;
  private anchor: PopupAnchor | null = null;
  private getAnchor: (() => PopupAnchor | null) | null = null;
  private onReposition: (() => void) | null = null;
  private onDocClick: ((ev: MouseEvent) => void) | null = null;
  private onEsc: ((ev: KeyboardEvent) => void) | null = null;
  /** 递增以作废进行中的异步查词, 防止快切单词写错卡片 */
  private lookupGen = 0;

  constructor(dict: DictionaryService) {
    this.dict = dict;
    // 用浏览器 UI 语言(不受 YouTube 页面 lang 属性影响)
    const lang = (typeof chrome !== 'undefined' && chrome.i18n
      ? chrome.i18n.getUILanguage()
      : (typeof navigator !== 'undefined' ? navigator.language : 'en')
    ).toLowerCase();
    this.langProvider = lang.startsWith('zh') ? this.cnProvider : this.enProvider;
  }

  get isOpen(): boolean {
    return this.el !== null;
  }

  /**
   * @param word 单词
   * @param anchor 初始锚点(单词 + 字幕区)
   * @param cueText 当前字幕文本(语境)
   * @param getAnchor 可选: 内容加载后重新测量锚点(字幕可能因布局变化位移)
   */
  show(
    word: string,
    anchor: PopupAnchor,
    cueText?: string,
    getAnchor?: () => PopupAnchor | null,
  ): void {
    this.dismiss();
    const gen = this.lookupGen;
    this.anchor = anchor;
    this.getAnchor = getAnchor ?? null;
    this.el = this.buildShell(word);
    document.body.appendChild(this.el);
    this.place();
    this.bindReposition();

    Promise.all([
      this.dict.lookup(word),
      this.enProvider.lookup(word),
      this.fetchTatoeba(word),
    ]).then(async ([dictDef, enResult, tatoeba]) => {
      if (gen !== this.lookupGen || !this.el) return;
      const b = this.el.querySelector('[data-card-body]') as HTMLElement | null;
      if (!b) return;
      if (!dictDef && !enResult) {
        b.innerHTML = this.renderEmpty();
        this.place();
        return;
      }

      let langEntries = enResult?.entries ?? null;
      if (!this.isEnLang() && enResult) {
        const cnResult = await this.cnProvider.translate(enResult);
        if (gen !== this.lookupGen || !this.el) return;
        if (cnResult) langEntries = cnResult.entries;
      }

      b.innerHTML = this.render(enResult?.entries ?? null, langEntries, dictDef, cueText, tatoeba);
      this.bindAudio(b);
      this.place();
    });
  }

  private isEnLang(): boolean {
    return this.langProvider.language === 'en';
  }

  onDismiss: (() => void) | null = null;

  dismiss(): void {
    this.lookupGen++; // 作废进行中的异步回调
    this.audio?.pause();
    this.audio = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (this.onReposition) {
      window.removeEventListener('resize', this.onReposition);
      window.removeEventListener('scroll', this.onReposition, true);
      this.onReposition = null;
    }
    if (this.onDocClick) {
      document.removeEventListener('click', this.onDocClick);
      this.onDocClick = null;
    }
    if (this.onEsc) {
      window.removeEventListener('keydown', this.onEsc, true);
      this.onEsc = null;
    }
    this.el?.remove();
    this.el = null;
    this.anchor = null;
    this.getAnchor = null;
    const cb = this.onDismiss;
    this.onDismiss = null;
    cb?.();
  }

  private bindReposition(): void {
    this.onReposition = () => this.place();
    window.addEventListener('resize', this.onReposition);
    // capture: YouTube 内部滚动容器也能触发
    window.addEventListener('scroll', this.onReposition, true);
  }

  /** 动态定位: 卡片贴在字幕上方, 水平靠近被点单词, 并钳制在视口内 */
  private place(): void {
    if (!this.el) return;
    const fresh = this.getAnchor?.();
    if (fresh) this.anchor = fresh;
    const anchor = this.anchor;
    if (!anchor) return;

    const { wordRect, cueRect } = anchor;
    const cardW = this.el.offsetWidth || CARD.width;
    let cardH = this.el.offsetHeight;

    // 垂直: 底边落在字幕顶边上方
    const cueTop = cueRect.top;
    const maxCardH = Math.max(140, cueTop - GAP_ABOVE_CUE - VIEW_MARGIN);
    this.el.style.maxHeight = `${Math.min(420, maxCardH)}px`;

    const body = this.el.querySelector('[data-card-body]') as HTMLElement | null;
    if (body) {
      const headerH = Math.max(56, (this.el.offsetHeight - body.offsetHeight) || 72);
      body.style.maxHeight = `${Math.max(80, Math.min(360, maxCardH - headerH))}px`;
    }

    cardH = this.el.offsetHeight;
    let top = cueTop - GAP_ABOVE_CUE - cardH;
    if (top < VIEW_MARGIN) top = VIEW_MARGIN;

    // 水平: 以单词为中心, 不溢出视口
    const vw = window.innerWidth;
    let left = wordRect.left + wordRect.width / 2 - cardW / 2;
    left = Math.min(Math.max(VIEW_MARGIN, left), Math.max(VIEW_MARGIN, vw - cardW - VIEW_MARGIN));

    Object.assign(this.el.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      bottom: 'auto',
      right: 'auto',
      transform: 'none',
    });
  }

  private async fetchTatoeba(word: string): Promise<string[]> {
    try {
      const url = `${TATOEBA}?query=${encodeURIComponent(word)}&from=eng&to=eng&sort=relevance&limit=4`;
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const d = (await r.json()) as { results?: Array<{ text: string }> };
      return (d.results ?? []).map(x => x.text).filter(t => t.length < 120);
    } catch { return []; }
  }

  private buildShell(word: string): HTMLElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', zIndex: '99999', width: `${CARD.width}px`,
      left: '0', top: '0', // place() 会立刻改成真实坐标
      background: 'rgba(18,18,24,0.96)', color: '#e8e8e8',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '18px', padding: '0',
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      boxShadow: '0 16px 56px rgba(0,0,0,0.6)', backdropFilter: 'blur(28px)',
      pointerEvents: 'auto', animation: 'nc-in 0.2s ease-out',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    });
    el.innerHTML = `<style>
@keyframes nc-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes nc-rot{to{transform:rotate(360deg)}}
.nc-spin{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.15);border-top-color:#fff;border-radius:50%;animation:nc-rot 0.7s linear infinite}
.nc-audio{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.45);cursor:pointer;font-size:13px;transition:all 0.15s;padding:0}
.nc-audio:hover{background:rgba(255,255,255,0.18);color:#fff}
.nc-audio.has{color:#8fd0ff;background:rgba(110,198,255,0.14)}
.nc-audio.err{color:#ff8a80;background:rgba(255,100,100,0.18)}
.nc-audio:disabled{opacity:0.35;cursor:default}
.nc-close{width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);cursor:pointer;font-size:16px;line-height:1;flex:0 0 auto}
.nc-close:hover{background:rgba(255,255,255,0.12);color:#fff}
.nc-pos{flex:0 0 auto;font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 6px;margin-top:2px}
</style>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 0;flex:0 0 auto;">
        <div>
          <div style="font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">${escapeHtml(word)}</div>
          <div data-phonetic style="display:none;align-items:center;gap:10px;margin-top:8px;font-size:12px;color:rgba(255,255,255,0.4);"></div>
        </div>
        <button data-close class="nc-close" type="button">×</button>
      </div>
      <div data-card-body style="padding:14px 18px 16px;font-size:14px;line-height:1.5;max-height:360px;overflow-y:auto;flex:1 1 auto;min-height:0;">
        <div style="display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.35);"><span class="nc-spin"></span>查询中…</div>
      </div>`;
    el.querySelector('[data-close]')!.addEventListener('click', e => { e.stopPropagation(); this.dismiss(); });
    this.onDocClick = (ev: MouseEvent) => {
      if (!el.contains(ev.target as Node)) this.dismiss();
    };
    this.onEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.dismiss();
      }
    };
    setTimeout(() => {
      if (this.onDocClick) document.addEventListener('click', this.onDocClick);
      if (this.onEsc) window.addEventListener('keydown', this.onEsc, true);
    }, 0);
    return el;
  }

  private render(
    enEntries: DefinitionEntry[] | null,
    langEntries: DefinitionEntry[] | null,
    dictDef: WordDefinition | null,
    cueText: string | undefined,
    tatoeba: string[],
  ): string {
    // 音标放进 header
    this.fillPhonetic(dictDef);

    // 在线 EN 失败时, 用本地词典兜底(避免只显示语境没有释义)
    const fallbackEntries: DefinitionEntry[] = (!enEntries && dictDef)
      ? dictDef.meanings.flatMap(m =>
          m.definitions.map(d => ({ partOfSpeech: m.partOfSpeech, definition: d.definition, example: d.example })),
        )
      : [];

    const sourceEntries = langEntries ?? enEntries ?? fallbackEntries;
    const primary = dedupeEntries(sortEntries(sourceEntries)).slice(0, MAX_SENSES);
    const p: string[] = [];

    if (cueText?.trim()) {
      const cue = trim(cueText.trim(), 56);
      p.push(`<div style="font-size:11px;color:rgba(255,255,255,0.28);line-height:1.4;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:6px;">语境 · ${escapeHtml(cue)}</div>`);
    }

    if (primary.length) {
      primary.forEach((e, i) => {
        const border = i ? 'border-top:1px solid rgba(255,255,255,0.05);' : '';
        const size = '13.5px';
        const color = 'rgba(255,255,255,0.85)';
        const pos = posLabelText(e.partOfSpeech);
        p.push(`<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;${border}">
          ${pos ? `<span class="nc-pos">${escapeHtml(pos)}</span>` : ''}
          <span style="color:${color};font-size:${size};line-height:1.45;">${escapeHtml(trim(e.definition, i === 0 ? 100 : 80))}</span>
        </div>`);
      });
    }

    const dictExs: string[] = [];
    for (const e of (enEntries ?? [])) if (e.example && !dictExs.includes(e.example)) dictExs.push(e.example);
    const allExs = [...dictExs, ...tatoeba].slice(0, MAX_EXAMPLES);
    if (allExs.length) {
      p.push(`<div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.28);letter-spacing:0.6px;margin:10px 0 4px;">例句</div>`);
      for (const ex of allExs) {
        p.push(`<div style="font-size:12.5px;color:rgba(255,255,255,0.48);line-height:1.5;padding:6px 0 6px 10px;border-left:2px solid rgba(110,198,255,0.25);">“${escapeHtml(ex)}”</div>`);
      }
    }

    return p.length ? p.join('') : this.renderEmpty();
  }

  private fillPhonetic(def: WordDefinition | null): void {
    if (!this.el) return;
    const slot = this.el.querySelector('[data-phonetic]') as HTMLElement | null;
    if (!slot) return;
    const uk = def?.phoneticUK || def?.phonetic || '';
    const us = def?.phoneticUS || uk;
    const auUK = def?.audioUK || '';
    const auUS = def?.audioUS || '';
    // 有音标或有音频都显示; 音标相同也照样出 UK / US（音频不同）
    if (!uk && !us && !auUK && !auUS) { slot.style.display = 'none'; return; }

    const row = (label: string, ipa: string, audio: string, title: string) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.28);">${label}</span>
        ${ipa ? `<span style="font-family:ui-monospace,monospace;color:rgba(255,255,255,0.62);">${escapeHtml(ipa)}</span>` : ''}
        <button class="nc-audio${audio ? ' has' : ''}" data-audio="${escapeHtml(audio)}" title="${title}" type="button" ${audio ? '' : 'disabled'}>🔊</button>
      </span>`;

    const parts: string[] = [];
    if (uk || auUK) parts.push(row('UK', uk, auUK, '英式发音'));
    // 有美音音频, 或音标与英式不同时显示 US（音标相同也因音频不同而显示）
    if (auUS || (us && us !== uk)) parts.push(row('US', us || uk, auUS, '美式发音'));

    slot.innerHTML = parts.join('<span style="width:1px;height:12px;background:rgba(255,255,255,0.1);margin:0 2px;"></span>');
    slot.style.display = 'flex';
    this.bindAudio(slot);
  }

  private bindAudio(root: HTMLElement): void {
    root.querySelectorAll('[data-audio]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        const url = el.dataset.audio;
        if (!url) return;
        void this.playPronunciation(url, el);
      });
    });
  }

  private flashAudioError(btn: HTMLElement): void {
    const prev = btn.getAttribute('title') || '发音';
    btn.classList.add('err');
    btn.setAttribute('title', '播放失败');
    window.setTimeout(() => {
      btn.classList.remove('err');
      btn.setAttribute('title', prev);
    }, 1600);
  }

  private async playPronunciation(url: string, btn?: HTMLElement): Promise<void> {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) { btn && this.flashAudioError(btn); return; }

      const blob = await resp.blob();
      if (this.audio) this.audio.pause();
      if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.blobUrl);
      await this.audio.play();
    } catch {
      btn && this.flashAudioError(btn);
    }
  }

  private renderEmpty(): string {
    return '<span style="color:rgba(255,255,255,0.28);font-style:italic;">未找到释义</span>';
  }
}
