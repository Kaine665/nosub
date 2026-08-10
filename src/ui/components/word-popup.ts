/**
 * WordPopup —— 查词卡片。
 *
 * 只显示浏览器当前语言的释义 (zh → 中文, 其他 → 英文)。
 * 音标/音频始终来自英文词典源。
 */

import { DictionaryService, type WordDefinition } from '../../assistance/dictionary-service.js';
import { DictionaryRouter, type DictLocale } from '../../assistance/dictionary-router.js';
import type { DefinitionProvider, DefinitionEntry } from '../../assistance/definition-provider.js';
import { buildCleanZhLines } from '../../assistance/zh-gloss-quality.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { t, type AppLocale } from '../../shared/i18n.js';

const CARD = { width: 380 };
const GAP_ABOVE_CUE = 10; // 卡片底边与字幕顶边的间距
const VIEW_MARGIN = 8;
const TATOEBA = 'https://tatoeba.org/en/api_v0/search';
const DICT_SERVER = 'http://43.130.246.125';
const YOUDAO_AUDIO = 'https://dict.youdao.com/dictvoice';
const MAX_SENSES = 4;
const MAX_EXAMPLES = 2;
const MAX_EXAMPLE_LEN = 110;

/** Lucide-style icons (inline SVG, no CDN / CSP issues on YouTube) */
const ICON_VOLUME = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

function interFontFaces(): string {
  const w400 = chrome.runtime.getURL('public/fonts/Inter-400.woff2');
  const w600 = chrome.runtime.getURL('public/fonts/Inter-600.woff2');
  const w700 = chrome.runtime.getURL('public/fonts/Inter-700.woff2');
  return `
@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url('${w400}') format('woff2')}
@font-face{font-family:'Inter';font-style:normal;font-weight:600;font-display:swap;src:url('${w600}') format('woff2')}
@font-face{font-family:'Inter';font-style:normal;font-weight:700;font-display:swap;src:url('${w700}') format('woff2')}
`;
}

/** 定位锚点: 单词 + 字幕区(卡片应落在字幕上方) */
export interface PopupAnchor {
  wordRect: DOMRect;
  cueRect: DOMRect;
}

const POS_CN: Record<string, string> = {
  noun: '名词', verb: '动词', adjective: '形容词', adverb: '副词',
  preposition: '介词', pronoun: '代词', pron: '代词', conjunction: '连词', conj: '连词',
  interjection: '感叹词', determiner: '限定词', name: '专有名词',
  adj: '形容词', adv: '副词', n: '名词', v: '动词', prep: '介词',
};
const POS_ORDER: Record<string, number> = {
  preposition: 1, prep: 1, adverb: 1, adv: 1, adjective: 2, adj: 2,
  verb: 3, v: 3, noun: 4, n: 4, pronoun: 5, conjunction: 5, conj: 5,
  interjection: 6, determiner: 6,
};

/** 规范词性短码；不认识的返回 null（前端丢弃） */
const POS_CANON: Record<string, string> = {
  n: 'n', noun: 'n', 'n.': 'n',
  v: 'v', verb: 'v', 'v.': 'v',
  adj: 'adj', adjective: 'adj', 'adj.': 'adj',
  adv: 'adv', adverb: 'adv', 'adv.': 'adv',
  prep: 'prep', preposition: 'prep', 'prep.': 'prep',
  conj: 'conj', conjunction: 'conj', 'conj.': 'conj',
  pron: 'pron', pronoun: 'pron',
  int: 'int', interjection: 'int',
  det: 'det', determiner: 'det',
};

const ZH_CONJ_HINT = /^(虽然|尽管|即使|就算|纵然|哪怕|不论|无论|要是|假如|如果)/;
const ZH_ADV_HINT = /^(然而|不过|可是|但是|反而|的确|确实|当然|几乎|已经|仍然|依然|也|还|就|才)/;

interface SenseLine {
  /** 短码: adv / conj / n … */
  pos: string;
  /** 义项文本: "然而" 或 "虽然;尽管" 或 "xxx,yyy;zzz" */
  text: string;
}

function canonPos(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  return POS_CANON[key] ?? null;
}

function splitPosTokens(raw: string): string[] {
  return raw
    .split(/[\/|,，、]+/)
    .map((p) => canonPos(p))
    .filter((p): p is string => !!p);
}

/** 从复合词性 + 中文释义推断该义项所属词性 */
function resolvePosForSense(rawPos: string, sense: string, locale: AppLocale): string | null {
  const tokens = splitPosTokens(rawPos);
  if (tokens.length === 1) return tokens[0];
  if (tokens.length === 0) return null;

  if (locale === 'zh_CN') {
    if (tokens.includes('conj') && ZH_CONJ_HINT.test(sense)) return 'conj';
    if (tokens.includes('adv') && ZH_ADV_HINT.test(sense)) return 'adv';
  }

  // 无法细分时：不猜，整组复合词性不合格 → 丢弃复合，改用第一个可用 token
  // 但若多个义项会全部落在同一 POS，后面再合并
  return tokens[0];
}

/**
 * 校验义项原子文本：
 * - 逗号分隔 = 同义近义，保留
 * - 中文 UI：只要简体普通话；粤语/繁体残留/长句一律丢弃
 */
const CANTONESE_MARK = /[啲嘢咗嘅冇係唔哋佢攞嚟嗰噉咁乜睇緊]/;
/** 常见繁体残留（toSimplified 未覆盖或粤繁混用） */
const TRAD_LEFTOVER = /[東車門開關時會過來對動學書畫頭長見說話語讀寫處號國後當發個種經網點還這進萬盡結給從樣應實張帶幫確認讓邊達選遠連愛爾爭變單親產壓廠義樂機殺沒聽員師戰據歷業價勢務醫區協參氣線組總專導轉輕農運無與則際難證題驗圖團場塊備傳傷僅億優兒內兩別劃劇勵匯卻噸嚴肅獎孫寧寶將屆屢層屬幹廳彈懷態憑戀戲戶掃掛採捨擊攝權歐歡歲歸毀決況滿漸潔潛潤濃濕灘烏煙熱牆獨獲環監眾睜礙礎禮穩競紀約納純級紛統絲維綜練繼續繪繞縱織縮績論於並稱類該須啟顯觸觀覽訊鍵鎖鐘鐵鏡閉閱陰陽雜離雲霧靜頁項預領頻顏願飲館駕騙鬆鬍鬥鹵鹹麵黃黨齊龍龜麼]/;

function isValidAtomicSense(sense: string, locale: AppLocale): boolean {
  const s = sense.trim();
  if (!s) return false;
  if (/[;；]/.test(s)) return false; // 分号应在合并层，不在原子义项里
  if (locale === 'zh_CN') {
    if (s.length > 24) return false;
    if (/[a-zA-Z]{4,}/.test(s)) return false; // 中文 UI 不要英文释义句
    if (/[。！？]/.test(s)) return false;
    if (CANTONESE_MARK.test(s) || TRAD_LEFTOVER.test(s)) return false;
  } else {
    if (s.length > 80) return false;
    if (/[.!?]/.test(s) && s.length > 48) return false;
  }
  return true;
}

function isValidSenseLine(line: SenseLine, locale: AppLocale): boolean {
  if (!canonPos(line.pos)) return false;
  const atoms = line.text.split(';').map((x) => x.trim()).filter(Boolean);
  if (!atoms.length) return false;
  return atoms.every((a) => {
    // 原子内允许逗号同义：a,b,c
    const parts = a.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    return parts.length > 0 && parts.every((p) => isValidAtomicSense(p, locale));
  });
}

/**
 * 按词性合并：
 *   adv 然而
 *   conj 虽然;尽管
 * 不合格式的直接丢弃。
 */
function isAcceptableAtom(atom: string, locale: AppLocale): boolean {
  if (isValidAtomicSense(atom, locale)) return true;
  const parts = atom.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => isValidAtomicSense(p, locale));
}

function buildSenseLines(entries: DefinitionEntry[], locale: AppLocale): SenseLine[] {
  const buckets = new Map<string, string[]>();

  for (const e of entries) {
    const raw = preferSimplified(e.definition || '').trim();
    if (!raw) continue;

    // 已是 "a;b" 时拆开再入桶；逗号同义保持在同一原子里
    const atoms = raw.split(/[;；]/).map((x) => x.trim()).filter(Boolean);
    for (const atom of atoms) {
      if (!isAcceptableAtom(atom, locale)) continue;

      const hint = atom.split(/[,，]/)[0]?.trim() || atom;
      const pos = resolvePosForSense(e.partOfSpeech || '', hint, locale);
      if (!pos) continue;

      const list = buckets.get(pos) ?? [];
      const core = coreMeaning(atom);
      if (list.some((x) => {
        const xc = coreMeaning(x);
        return xc === core || xc.includes(core) || core.includes(xc);
      })) continue;
      list.push(atom);
      buckets.set(pos, list);
    }
  }

  const lines: SenseLine[] = [];
  for (const [pos, senses] of buckets) {
    const line: SenseLine = { pos, text: senses.slice(0, 6).join(';') };
    if (isValidSenseLine(line, locale)) lines.push(line);
  }

  lines.sort((a, b) => (POS_ORDER[a.pos] ?? 5) - (POS_ORDER[b.pos] ?? 5));
  return lines.slice(0, MAX_SENSES);
}

function posLabelText(pos: string, locale: AppLocale): string {
  return locale === 'zh_CN' ? (POS_CN[pos] || pos) : pos;
}

function coreMeaning(def: string): string {
  return def.replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '').trim();
}

/** 简繁转换（覆盖 Wiktionary 常见繁体） */
const T2S: Record<string, string> = {
  '開':'开','關':'关','雖':'虽','體':'体','爲':'为','為':'为','時':'时','會':'会',
  '過':'过','來':'来','對':'对','動':'动','學':'学','書':'书','畫':'画','馬':'马','魚':'鱼','鳥':'鸟',
  '頭':'头','門':'门','間':'间','長':'长','電':'电','風':'风','飛':'飞','見':'见','說':'说','話':'话',
  '語':'语','讀':'读','寫':'写','處':'处','號':'号','國':'国','後':'后','當':'当','發':'发','裡':'里',
  '個':'个','種':'种','經':'经','網':'网','點':'点','還':'还','這':'这','進':'进','臺':'台','萬':'万',
  '盡':'尽','結':'结','給':'给','從':'从','樣':'样','應':'应','實':'实','張':'张','帶':'带','幫':'帮',
  '確':'确','認':'认','讓':'让','邊':'边','達':'达','選':'选','遠':'远','連':'连','愛':'爱','爾':'尔',
  '爭':'争','變':'变','單':'单','親':'亲','產':'产','壓':'压','廠':'厂','義':'义','樂':'乐','機':'机',
  '殺':'杀','沒':'没','聽':'听','員':'员','師':'师','戰':'战','據':'据','歷':'历','業':'业','價':'价',
  '勢':'势','務':'务','醫':'医','區':'区','協':'协','參':'参','麼':'么','氣':'气','線':'线','組':'组',
  '總':'总','專':'专','導':'导','轉':'转','車':'车','輕':'轻','農':'农','運':'运','無':'无','與':'与',
  '則':'则','際':'际','難':'难','證':'证','題':'题','驗':'验','圖':'图','團':'团','場':'场','塊':'块',
  '備':'备','傳':'传','傷':'伤','僅':'仅','億':'亿','優':'优','兒':'儿','內':'内','兩':'两','別':'别',
  '劃':'划','劇':'剧','勵':'励','匯':'汇','卻':'却','噸':'吨','嚴':'严','肅':'肃','獎':'奖','孫':'孙',
  '寧':'宁','寶':'宝','將':'将','屆':'届','屢':'屡','層':'层','屬':'属','幹':'干','廳':'厅','彈':'弹',
  '彙':'汇','徹':'彻','徵':'征','誌':'志','懷':'怀','態':'态','憑':'凭','戀':'恋','戲':'戏','戶':'户',
  '掃':'扫','掛':'挂','採':'采','捨':'舍','擊':'击','攝':'摄','權':'权','歐':'欧','歡':'欢','歲':'岁',
  '歸':'归','毀':'毁','決':'决','況':'况','滿':'满','漸':'渐','潔':'洁','潛':'潜','潤':'润','濃':'浓',
  '濕':'湿','灘':'滩','烏':'乌','煙':'烟','熱':'热','牆':'墙','獨':'独','獲':'获','環':'环','癥':'症',
  '監':'监','眾':'众','睜':'睁','瞭':'了','礙':'碍','礎':'础','禮':'礼','穩':'稳','競':'竞','紀':'纪',
  '約':'约','納':'纳','純':'纯','級':'级','紛':'纷','統':'统','絲':'丝','維':'维','綜':'综','練':'练',
  '繼':'继','續':'续','繪':'绘','繞':'绕','縱':'纵','織':'织','縮':'缩','績':'绩','論':'论','於':'于',
  '並':'并','稱':'称','類':'类','該':'该','須':'须','啟':'启','顯':'显','觸':'触','觀':'观','覽':'览',
  '訊':'讯','鍵':'键','鎖':'锁','鐘':'钟','鐵':'铁','鏡':'镜','閉':'闭','閱':'阅','陽':'阳','陰':'阴',
  '雜':'杂','離':'离','雲':'云','霧':'雾','靜':'静','頁':'页','項':'项','預':'预','領':'领','頻':'频',
  '顏':'颜','願':'愿','飲':'饮','館':'馆','駕':'驾','騙':'骗','鬆':'松','鬍':'胡','鬥':'斗','鹵':'卤',
  '鹹':'咸','麵':'面','黃':'黄','黨':'党','齊':'齐','龍':'龙','龜':'龟',
};

function toSimplified(text: string): string {
  return [...text].map(c => T2S[c] || c).join('');
}

/** Wiktionary 常给「繁體 /简体」——优先取斜线后的简体侧 */
function preferSimplified(text: string): string {
  const parts = text.split(/\s*\/\s*/);
  if (parts.length >= 2) {
    const right = parts[parts.length - 1].trim();
    if (right) return toSimplified(right);
  }
  return toSimplified(text);
}

const router = new DictionaryRouter();

export class WordPopup {
  private el: HTMLElement | null = null;
  private dict: DictionaryService;
  /** EN 参考 Provider (始终提供音标/发音) */
  private refProvider: DefinitionProvider;
  /** 用户语言 Provider (提供释义) */
  private langProvider: DefinitionProvider;
  private audio: HTMLAudioElement | null = null;
  private blobUrl: string | null = null;
  private anchor: PopupAnchor | null = null;
  private getAnchor: (() => PopupAnchor | null) | null = null;
  private onReposition: (() => void) | null = null;
  private onDocClick: ((ev: MouseEvent) => void) | null = null;
  private onEsc: ((ev: KeyboardEvent) => void) | null = null;
  /** 递增以作废进行中的异步查词, 防止快切单词写错卡片 */
  private lookupGen = 0;
  private locale: DictLocale;
  /** 当前查词，用于发音服务器兜底 */
  private currentWord = '';

  constructor(dict: DictionaryService, locale: DictLocale = 'en') {
    this.dict = dict;
    this.locale = locale;
    this.langProvider = router.getProvider(locale);
    this.refProvider = router.getReferenceProvider();
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
    this.currentWord = word;
    this.anchor = anchor;
    this.getAnchor = getAnchor ?? null;
    this.el = this.buildShell(word);
    document.body.appendChild(this.el);
    this.place();
    this.bindReposition();

    // 并行: EN 参考(音标/例句) + 用户语言释义 + Tatoeba
    Promise.all([
      this.dict.lookup(word),          // dictDef — 本地 GCIDE / Free Dict 兜底
      this.refProvider.lookup(word),   // enResult — EN 参考数据(音标/发音)
      this.langProvider.lookup(word),  // langResult — 用户语言释义
      this.fetchTatoeba(word),         // tatoeba 例句
      this.fetchServerExamples(word),  // 服务器例句兜底
    ]).then(async ([dictDef, enResult, langResult, tatoeba, serverExs]) => {
      if (gen !== this.lookupGen || !this.el) return;
      const b = this.el.querySelector('[data-card-body]') as HTMLElement | null;
      if (!b) return;
      if (!dictDef && !enResult && !langResult) {
        b.innerHTML = this.renderEmpty();
        this.place();
        return;
      }

      b.innerHTML = this.render(
        enResult?.entries ?? null,
        langResult?.entries ?? null,
        dictDef,
        cueText,
        [...tatoeba, ...serverExs],
      );
      this.bindAudio(b);
      this.place();
    });
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
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) return [];
      const d = (await r.json()) as { results?: Array<{ text: string }> };
      return (d.results ?? []).map(x => x.text).filter(t => t.length < 120);
    } catch { return []; }
  }

  /** 服务器例句兜底（Tatoeba/本地都空时）——直连，不经 SW */
  private async fetchServerExamples(word: string): Promise<string[]> {
    try {
      const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
      if (!clean) return [];
      const r = await fetch(
        `${DICT_SERVER}/api/word/en/${encodeURIComponent(clean)}`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (!r.ok) return [];
      const d = (await r.json()) as { examples?: string[] };
      return (d.examples ?? []).filter(t => t.length > 0 && t.length < 140);
    } catch { return []; }
  }

  private buildShell(word: string): HTMLElement {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', zIndex: '99999', width: `${CARD.width}px`,
      left: '0', top: '0', // place() 会立刻改成真实坐标
      background: 'rgba(18,18,24,0.96)', color: '#e8e8e8',
      border: '1px solid rgba(255,255,255,0.1)', borderRadius: '18px', padding: '0',
      fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 16px 56px rgba(0,0,0,0.6)', backdropFilter: 'blur(28px)',
      pointerEvents: 'auto', animation: 'nc-in 0.2s ease-out',
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    });
    el.innerHTML = `<style>
${interFontFaces()}
@keyframes nc-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes nc-rot{to{transform:rotate(360deg)}}
.nc-spin{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,0.15);border-top-color:#fff;border-radius:50%;animation:nc-rot 0.7s linear infinite}
.nc-audio{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:none;background:rgba(110,198,255,0.14);color:#8fd0ff;cursor:pointer;transition:all 0.15s;padding:0}
.nc-audio:hover{background:rgba(110,198,255,0.25);color:#fff}
.nc-audio.err{color:#ff8a80;background:rgba(255,100,100,0.18)}
.nc-audio:disabled{opacity:0.35;cursor:default}
.nc-close{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);cursor:pointer;flex:0 0 auto;padding:0;transition:all 0.15s}
.nc-close:hover{background:rgba(255,255,255,0.12);color:#fff}
.nc-pos{flex:0 0 auto;font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 6px;margin-top:2px;white-space:nowrap}
.nc-sec{font-size:10px;font-weight:700;color:rgba(255,255,255,0.28);letter-spacing:0.6px;text-transform:uppercase;margin:10px 0 8px}
.nc-sec-ex{margin-top:20px}
.nc-ex{font-size:12.5px;color:rgba(255,255,255,0.5);line-height:1.5;padding:6px 0 6px 10px;border-left:2px solid rgba(110,198,255,0.25);font-style:italic}
.nc-ex+.nc-ex{margin-top:8px}
.nc-ipa{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:rgba(255,255,255,0.62);letter-spacing:-0.01em}
.nc-body::-webkit-scrollbar{width:4px}
.nc-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:10px}
</style>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 0;flex:0 0 auto;">
        <div>
          <div style="font-size:26px;font-weight:700;color:#fff;letter-spacing:-0.02em;line-height:1.1;">${escapeHtml(word)}</div>
          <div data-phonetic style="display:none;align-items:center;gap:10px;margin-top:8px;font-size:12px;color:rgba(255,255,255,0.4);"></div>
        </div>
        <button data-close class="nc-close" type="button" aria-label="Close">${ICON_CLOSE}</button>
      </div>
      <div data-card-body class="nc-body" style="padding:16px 18px;font-size:14px;line-height:1.5;max-height:360px;overflow-y:auto;flex:1 1 auto;min-height:0;">
        <div style="display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.35);"><span class="nc-spin"></span>${t('lookingUp', this.locale)}</div>
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
    _cueText: string | undefined,
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
    // 中文：统一过质量关卡（禁繁体/粤语/非中文）；英文走原合并逻辑
    const senseLines = this.locale === 'zh_CN'
      ? buildCleanZhLines(sourceEntries.map((e) => ({
          pos: e.partOfSpeech,
          definition: e.definition,
        }))).map((l) => ({ pos: l.pos, text: l.text }))
      : buildSenseLines(sourceEntries, this.locale);
    const p: string[] = [];

    // 释义 —— 按词性一行：adv 然而 / conj 虽然;尽管；不合格式已丢弃
    p.push(`<div class="nc-sec">${this.locale === 'zh_CN' ? '释义' : 'Senses'}</div>`);
    if (senseLines.length) {
      senseLines.forEach((line, i) => {
        const border = i ? 'border-top:1px solid rgba(255,255,255,0.05);' : '';
        const pos = posLabelText(line.pos, this.locale);
        p.push(`<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 0;${border}">
          ${pos ? `<span class="nc-pos">${escapeHtml(pos)}</span>` : ''}
          <span style="color:rgba(255,255,255,0.85);font-size:13.5px;line-height:1.45;">${escapeHtml(line.text)}</span>
        </div>`);
      });
    } else {
      p.push('<div style="color:rgba(255,255,255,0.2);font-size:12px;font-style:italic;">暂无释义</div>');
    }

    // 例句 —— 短句优先，超长段落丢掉
    const dictExs: string[] = [];
    const pushEx = (ex?: string) => {
      if (!ex) return;
      const s = ex.trim();
      if (!s || s.length > MAX_EXAMPLE_LEN) return;
      if (dictExs.includes(s)) return;
      dictExs.push(s);
    };
    for (const e of (enEntries ?? [])) pushEx(e.example);
    for (const e of (langEntries ?? [])) pushEx(e.example);
    for (const ex of tatoeba) pushEx(ex);
    const allExs = dictExs.slice(0, MAX_EXAMPLES);
    p.push(`<div class="nc-sec nc-sec-ex">${this.locale === 'zh_CN' ? '例句' : 'Examples'}</div>`);
    if (allExs.length) {
      for (const ex of allExs) {
        p.push(`<div class="nc-ex">"${escapeHtml(ex)}"</div>`);
      }
    } else {
      p.push('<div style="color:rgba(255,255,255,0.2);font-size:12px;font-style:italic;">暂无例句</div>');
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
    const word = this.currentWord.replace(/[^a-zA-Z'-]/g, '').toLowerCase();

    // 有音标/音频，或至少有单词（可走服务器发音兜底）时显示
    if (!uk && !us && !auUK && !auUS && !word) { slot.style.display = 'none'; return; }

    const row = (label: string, ipa: string, audio: string, accent: 'uk' | 'us', title: string) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.28);text-transform:uppercase;letter-spacing:-0.01em;">${label}</span>
        ${ipa ? `<span class="nc-ipa" style="font-size:12px;">${escapeHtml(ipa)}</span>` : ''}
        <button class="nc-audio" data-audio="${escapeHtml(audio)}" data-word="${escapeHtml(word)}" data-accent="${accent}" title="${title}" type="button" aria-label="${title}">${ICON_VOLUME}</button>
      </span>`;

    const parts: string[] = [];
    parts.push(row('UK', uk, auUK, 'uk', t('britishPronunciation', this.locale)));
    parts.push(row('US', us || uk, auUS, 'us', t('americanPronunciation', this.locale)));

    slot.innerHTML = parts.join('<span style="width:1px;height:12px;background:rgba(255,255,255,0.1);margin:0 2px;"></span>');
    slot.style.display = 'flex';
    this.bindAudio(slot);
  }

  private bindAudio(root: HTMLElement): void {
    root.querySelectorAll('.nc-audio').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = btn as HTMLElement;
        void this.playPronunciation(el.dataset.audio || '', el);
      });
    });
  }

  private flashAudioError(btn: HTMLElement): void {
    const prev = btn.getAttribute('title') || t('pronunciation', this.locale);
    btn.classList.add('err');
    btn.setAttribute('title', t('playbackFailed', this.locale));
    window.setTimeout(() => {
      btn.classList.remove('err');
      btn.setAttribute('title', prev);
    }, 1600);
  }

  /**
   * 直接用 Audio(url) 播放。
   * Google TTS 不回 CORS，fetch+blob 会失败；<audio src> 播跨域音频不需要 CORS。
   */
  private async playDirect(url: string): Promise<boolean> {
    try {
      if (this.audio) {
        this.audio.pause();
        this.audio.removeAttribute('src');
      }
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
      const audio = new Audio(url);
      this.audio = audio;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 通过 service worker fetch 播放。
   * SW 有 host_permissions，不受页面 mixed content / CSP 限制。
   * 用于 HTTP 音频源（我们的 dict server）在 YouTube HTTPS 页面上被拦的情况。
   */
  private async playViaSW(url: string): Promise<boolean> {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'audio-fetch',
        url,
      });
      if (!resp?.ok || !resp.body) return false;

      // base64 → blob → 播放
      const bin = atob(resp.body as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: resp.contentType || 'audio/mpeg' });
      const blobUrl = URL.createObjectURL(blob);

      if (this.audio) {
        this.audio.pause();
        this.audio.removeAttribute('src');
      }
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
      }
      this.blobUrl = blobUrl;
      const audio = new Audio(blobUrl);
      this.audio = audio;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  /** 发音主源 Google TTS（Audio 直链）；有道 / 日本服务器兜底 */
  private async playPronunciation(_url: string, btn?: HTMLElement): Promise<void> {
    const word = (btn?.dataset.word || this.currentWord).replace(/[^a-zA-Z'-]/g, '').toLowerCase();
    const accent = (btn?.dataset.accent === 'uk' ? 'uk' : 'us') as 'uk' | 'us';
    if (!word) {
      if (btn) this.flashAudioError(btn);
      return;
    }

    const tl = accent === 'uk' ? 'en-GB' : 'en-US';
    const google = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${tl}&q=${encodeURIComponent(word)}`;
    if (await this.playDirect(google)) return;

    const youdaoType = accent === 'uk' ? 1 : 2;
    const youdao = `${YOUDAO_AUDIO}?audio=${encodeURIComponent(word)}&type=${youdaoType}`;
    if (await this.playDirect(youdao)) return;

    // 自己的 dict server (HTTP)——走 SW fetch 绕开 mixed content 拦截
    const fallback = `${DICT_SERVER}/api/audio/${encodeURIComponent(word)}?accent=${accent}`;
    if (await this.playViaSW(fallback)) return;

    if (btn) this.flashAudioError(btn);
  }

  private renderEmpty(): string {
    return `<span style="color:rgba(255,255,255,0.28);font-style:italic;">${t('noDefinition', this.locale)}</span>`;
  }
}
