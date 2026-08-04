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
  upgradeRequired?: boolean;
}

export function renderControlBar(props: ControlBarProps): string {
  const { revealLevel, isRepeating, status, playbackRate, errorMessage, locale = 'en', upgradeRequired = false } = props;
  const isReady = status === 'ready';

  const sClass = revealLevel > 0 ? ' on' : '';
  const rateActive = isReady && playbackRate < 1;
  const rateText = rateActive ? ` ${playbackRate}×` : '';
  const aLabel = isRepeating ? t('previous', locale) : t('repeat', locale);
  const dLabel = isRepeating ? t('exit', locale) : t('next', locale);

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
        <span class="nosub-ctrl nosub-ctrl-clickable" data-action="loop-back" title="${aLabel}">
          <span class="key">A</span><span class="label">${aLabel}</span>
        </span>
        <span class="nosub-ctrl nosub-ctrl-clickable${sClass}" data-action="toggle-reveal" title="${t('captions', locale)}">
          <span class="key">S</span><span class="label">${t('captions', locale)} ${LEVEL_MARKS[revealLevel]}</span>
        </span>
        <span class="nosub-ctrl nosub-ctrl-clickable" data-action="next" title="${dLabel}">
          <span class="key">D</span><span class="label">${dLabel}</span>
        </span>
        <span class="nosub-ctrl nosub-ctrl-clickable${rateActive ? ' on' : ''}" data-action="toggle-rate" title="${t('speed', locale)}">
          <span class="key">E</span><span class="label">${t('speed', locale)}${rateText}</span>
        </span>
        ${statusText ? `<span class="nosub-ctrl"><span class="label" title="${escapeHtml(errorMessage ?? statusText)}">${escapeHtml(statusText)}</span></span>` : ''}
      </div>
      ${upgradeRequired ? `<button class="nosub-upgrade" data-action="open-upgrade">${t('translationIsPro', locale)} · ${t('upgrade', locale)}</button>` : ''}
      <span class="nosub-loop-indicator${isRepeating ? ' visible' : ''}">
        <span class="nosub-loop-dot"></span>${t('repeating', locale)}
        <button class="nosub-exit-btn" data-action="exit-loop">${t('exit', locale)}</button>
      </span>
    </div>`;
}
