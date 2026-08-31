/**
 * ControlBar —— 永远可见的 Apple 风格控制栏。
 * 纯渲染函数, 不依赖 DOM/SessionController。
 */

import type { RevealLevel } from '../../content/session-controller.js';
import { escapeHtml } from '../../shared/html-utils.js';
import { t, type AppLocale } from '../../shared/i18n.js';

const LEVEL_MARKS = ['○', '①', '②'] as const;

export interface ControlBarProps {
  revealLevel: RevealLevel;
  isRepeating: boolean;
  status: string;
  playbackRate: number;
  errorMessage?: string;
  locale?: AppLocale;
  /** Google 翻译不可用时的区域兜底建议 */
  translationSuggestion?: { name: string; label: string } | null;
}

export function renderControlBar(props: ControlBarProps): string {
  const { revealLevel, isRepeating, status, playbackRate, errorMessage, locale = 'en', translationSuggestion } = props;
  const isReady = status === 'ready';

  const sClass = revealLevel > 0 ? ' on' : '';
  const rateActive = isReady && playbackRate < 1;
  const rateText = rateActive ? ` ${playbackRate}×` : '';
  const firstLabel = isRepeating ? t('previous', locale) : t('repeat', locale);

  let statusText = '';
  if (!isReady) {
    if (status === 'loading') statusText = t('loading', locale);
    else if (status === 'unsupported') statusText = t('noCaptions', locale);
    else if (errorMessage) statusText = errorMessage.length > 18 ? `${errorMessage.slice(0, 18)}…` : errorMessage;
    else statusText = t('error', locale);
  }

  return `
    <div class="nosub-bar">
      <span class="nosub-brand">NOSUB</span>
      <div class="nosub-ctrls">
        <span class="nosub-ctrl nosub-ctrl-clickable" data-action="${isRepeating ? 'loop-back' : 'toggle-focused'}" title="${firstLabel}">
          <span class="key">${isRepeating ? 'A' : 'Q'}</span><span class="label">${firstLabel}</span>
        </span>
        <span class="nosub-ctrl nosub-ctrl-clickable${sClass}" data-action="toggle-reveal" title="${t('captions', locale)}">
          <span class="key">S</span><span class="label">${t('captions', locale)} ${LEVEL_MARKS[revealLevel]}</span>
        </span>
        <span class="nosub-ctrl nosub-ctrl-clickable" data-action="next" title="${t('next', locale)}">
          <span class="key">D</span><span class="label">${t('next', locale)}</span>
        </span>
        <span class="nosub-ctrl nosub-ctrl-clickable${rateActive ? ' on' : ''}" data-action="toggle-rate" title="${t('speed', locale)}">
          <span class="key">E</span><span class="label">${t('speed', locale)}${rateText}</span>
        </span>
        ${statusText ? `<span class="nosub-ctrl"><span class="label" title="${escapeHtml(errorMessage ?? statusText)}">${escapeHtml(statusText)}</span></span>` : ''}
      </div>
      ${translationSuggestion ? `<div class="nosub-suggestion"><span>${t('suggestionGoogleFailed', locale)}${escapeHtml(translationSuggestion.label)}</span><button class="nosub-suggestion-btn" data-action="open-options">${t('configure', locale)}</button></div>` : ''}
      <span class="nosub-loop-indicator${isRepeating ? ' visible' : ''}">
        <span class="nosub-loop-dot"></span>${t('repeating', locale)}
        <button class="nosub-exit-btn" data-action="exit-loop">Q · ${t('exit', locale)}</button>
      </span>
    </div>`;
}
