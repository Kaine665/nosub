/**
 * SubtitleDisplay —— 字幕三种挡位渲染。
 * 纯函数, 产出 HTML 字符串。三种挡位共用同一 DOM 结构。
 */

import type { Cue } from '../../shared/types.js';
import type { RevealLevel } from '../../content/session-controller.js';
import { escapeHtml, escapeAttr } from '../../shared/html-utils.js';
import { t, type AppLocale } from '../../shared/i18n.js';

export interface SubtitleDisplayProps {
  cue?: Cue;
  revealLevel: RevealLevel;
  isRepeating: boolean;
  translationAvailable: boolean;
  locale?: AppLocale;
}

/**
 * 渲染字幕区(可能在控制栏上方)。
 * @returns HTML 字符串, 无字幕时返回 ''。
 */
export function renderSubtitle(props: SubtitleDisplayProps): string {
  const { cue, revealLevel, isRepeating, translationAvailable, locale = 'en' } = props;
  const hasCue = !!cue;

  // 挡位 0 + normal: 不显示
  // 挡位 0 + repeat: 显示(全遮)
  // 挡位 1+: 显示
  const showCue = hasCue && (revealLevel > 0 || isRepeating);

  if (!showCue) return '';

  const wordClass =
    revealLevel === 0 ? 'nosub-word-hidden' :
    'nosub-word-full';  // level 1 = 完整词, level 2 = 完整词+翻译

  let html = `<div class="nosub-cue-line">${renderWordsUnified(cue!.text, wordClass)}</div>`;

  // 挡位 2: 翻译行
  if (revealLevel >= 2) {
    if (cue!.translatedText) {
      html += `<div class="nosub-cue-line translated">${escapeHtml(cue!.translatedText!)}</div>`;
    } else {
      let msg: string;
      if (cue!.translationFailed) {
        msg = cue!.translationFailed!; // 直接显示具体原因: "网络超时" / "翻译过频" 等
      } else if (translationAvailable) {
        msg = t('translationLoading', locale);
      } else {
        msg = t('translationNotConfigured', locale);
      }
      html += `<div class="nosub-cue-line translated nosub-translation-placeholder">${escapeHtml(msg)}</div>`;
    }
  }

  return `<div class="nosub-cue-box">${html}</div>`;
}

/**
 * 统一渲染: 每个单词产出相同的 DOM 结构。
 * <span class="nosub-word {wordClass}" data-word="hello">
 *   <span class="nosub-letter-first">h</span>
 *   <span class="nosub-letter-rest">ello</span>
 * </span>
 */
function renderWordsUnified(text: string, wordClass: string): string {
  return text.replace(/\S+/g, (word) => {
    const m = word.match(/^([a-zA-Z'-]+)([.,!?;:'"]*)$/);
    if (!m) return escapeHtml(word);

    const raw = m[1];
    const first = raw.charAt(0);
    const rest = raw.slice(1);

    return `<span class="nosub-word ${wordClass}" data-word="${escapeAttr(raw)}">` +
      `<span class="nosub-letter-first">${escapeHtml(first)}</span>` +
      `<span class="nosub-letter-rest">${escapeHtml(rest)}</span>` +
      `</span>${escapeHtml(m[2])}`;
  });
}
