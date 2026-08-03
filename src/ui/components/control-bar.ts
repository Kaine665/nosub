/**
 * ControlBar —— 永远可见的 Apple 风格控制栏。
 * 纯渲染函数, 不依赖 DOM/SessionController。
 */

import type { RevealLevel } from '../../content/session-controller.js';
import { escapeHtml } from '../../shared/html-utils.js';

const LEVEL_MARKS = ['○', '①', '②'] as const;

export interface ControlBarProps {
  revealLevel: RevealLevel;
  isRepeating: boolean;
  status: string;
  playbackRate: number;
  errorMessage?: string;
}

export function renderControlBar(props: ControlBarProps): string {
  const { revealLevel, isRepeating, status, playbackRate, errorMessage } = props;
  const isReady = status === 'ready';

  const sClass = revealLevel > 0 ? ' on' : '';
  const rateActive = isReady && playbackRate < 1;
  const rateText = rateActive ? ` ${playbackRate}×` : '';

  let statusText = '';
  if (!isReady) {
    if (status === 'loading') statusText = '加载中…';
    else if (status === 'unsupported') statusText = '无字幕';
    else if (errorMessage) statusText = errorMessage.length > 18 ? `${errorMessage.slice(0, 18)}…` : errorMessage;
    else statusText = '出错';
  }

  return `
    <div class="nosub-bar">
      <span class="nosub-brand">NOSUB</span>
      <div class="nosub-ctrls">
        <span class="nosub-ctrl${sClass}">
          <span class="key">S</span><span class="label">${LEVEL_MARKS[revealLevel]}</span>
        </span>
        <span class="nosub-ctrl">
          <span class="key">A</span><span class="label">循环</span>
        </span>
        <span class="nosub-ctrl">
          <span class="key">D</span><span class="label">下一句</span>
        </span>
        <span class="nosub-ctrl${rateActive ? ' on' : ''}">
          <span class="key">E</span><span class="label">速度${rateText}</span>
        </span>
        ${statusText ? `<span class="nosub-ctrl"><span class="label" title="${escapeHtml(errorMessage ?? statusText)}">${escapeHtml(statusText)}</span></span>` : ''}
      </div>
      <span class="nosub-loop-indicator${isRepeating ? ' visible' : ''}">
        <span class="nosub-loop-dot"></span>循环中
        <button class="nosub-exit-btn" data-action="exit-loop">退出</button>
      </span>
    </div>`;
}
