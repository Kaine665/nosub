/**
 * 主世界脚本 —— world: 'MAIN',run_at: 'document_start'。
 *
 * 最终策略:透明代理。
 * 不构造任何请求(body 复刻验证失败:原样重放 400,有一致性保护)。
 * 而是:拦截 YouTube 自己发的 get_transcript 请求,clone 响应传给 nosub。
 * 如果 nosub 需要字幕而 YouTube 还没触发,就模拟点击 transcript 面板按钮。
 */

// ---- 第一部分:响应拦截 ----

function installProxy() {
  const origFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input :
                input instanceof URL ? input.href :
                input instanceof Request ? input.url : '';

    const resp = await origFetch.apply(window, [input, init]);

    // 拦截成功的 get_transcript 响应,clone 并传给 nosub
    if (url.includes('/youtubei/v1/get_transcript') && resp.ok) {
      try {
        const clone = resp.clone();
        const text = await clone.text();
        if (text.length > 1000) {
          const data = JSON.parse(text);
          window.postMessage({ __nosub: true, type: 'transcript-response', reqId: -2, payload: data }, '*');
        }
      } catch { /* 静默忽略 */ }
      // 拿到数据了,把 transcript 面板关掉(用户无感知)
      setTimeout(() => closeTranscriptPanel(), 100);
    }

    return resp;
  };
}

// ---- 第二部分:面板隐身(用户无感知) ----

let panelHidden = false;
let triggeredButton: HTMLButtonElement | null = null;
let panelCleanupTimer: ReturnType<typeof setTimeout> | null = null;

const TRANSCRIPT_PANEL_SELECTOR = [
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
  'ytd-engagement-panel-section-list-renderer[target-id*="transcript" i]',
].join(',');

function findTranscriptPanel(): HTMLElement | null {
  return document.querySelector(TRANSCRIPT_PANEL_SELECTOR) as HTMLElement | null;
}

function hideTranscriptPanel() {
  if (panelHidden) return;
  panelHidden = true;
  const style = document.createElement('style');
  style.id = 'nosub-hide-panel';
  // 只隐藏文字记录面板，不能影响评论、播放列表等其他 engagement panel。
  style.textContent = `
    ${TRANSCRIPT_PANEL_SELECTOR} {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function restoreTranscriptPanel() {
  panelHidden = false;
  document.getElementById('nosub-hide-panel')?.remove();
}

function clearPanelCleanupTimer() {
  if (panelCleanupTimer) {
    clearTimeout(panelCleanupTimer);
    panelCleanupTimer = null;
  }
}

function finishPanelCleanup() {
  clearPanelCleanupTimer();
  triggeredButton = null;
  restoreTranscriptPanel();
}

function armPanelCleanup() {
  clearPanelCleanupTimer();
  // 即使请求没有返回，也不能让 YouTube 一直保持侧栏打开状态。
  panelCleanupTimer = setTimeout(() => closeTranscriptPanel(), 2500);
}

function clickTranscriptCloseButton(panel: HTMLElement): boolean {
  for (const selector of [
    'button[aria-label="Close"]',
    'button[aria-label="关闭"]',
    'button[aria-label="关闭文字记录"]',
    '#visibility-button button',
    'ytd-engagement-panel-title-header-renderer button',
  ]) {
    const button = panel.querySelector(selector) as HTMLButtonElement | null;
    if (button) {
      button.click();
      return true;
    }
  }
  return false;
}

function closeTranscriptPanel() {
  if (!triggeredButton && !panelHidden) return; // 不是我们打开的,不碰

  // 优先点击面板自己的关闭按钮；描述区按钮只作为最后兜底。
  const tryClose = () => {
    const panel = findTranscriptPanel();
    if (!panel) {
      finishPanelCleanup();
      return;
    }

    if (clickTranscriptCloseButton(panel)) {
      finishPanelCleanup();
      return;
    }

    if (triggeredButton && document.contains(triggeredButton)) {
      triggeredButton.click();
      finishPanelCleanup();
      return;
    }

    finishPanelCleanup();
  };

  // 给 YouTube 一点时间渲染面板自己的关闭按钮。
  setTimeout(tryClose, 100);
  setTimeout(() => {
    if (triggeredButton || panelHidden) tryClose();
  }, 500);
}

// ---- 第三部分:主动触发 transcript ----

let triggerAttempted = false;
let triggerTimer: ReturnType<typeof setInterval> | null = null;

function resetTriggerState() {
  triggerAttempted = false;
  if (triggerTimer) { clearInterval(triggerTimer); triggerTimer = null; }
  if (triggeredButton || panelHidden) closeTranscriptPanel();
}

function clickTranscriptButton(): boolean {
  // 方法 1:ytd-video-description-transcript-section-renderer
  const container = document.querySelector('ytd-video-description-transcript-section-renderer');
  if (container) {
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    if (btn) { triggeredButton = btn; btn.click(); armPanelCleanup(); return true; }
  }
  // 方法 2:aria-label 匹配
  for (const sel of [
    'button[aria-label="显示文字版"]',
    'button[aria-label="内容转文字"]',
    'button[aria-label="Show transcript"]',
    'button[aria-label*="transcript" i]',
    'button[aria-label*="文字版"]',
    'button[aria-label*="文字记录"]',
  ]) {
    const btn = document.querySelector(sel) as HTMLButtonElement | null;
    if (btn) { triggeredButton = btn; btn.click(); armPanelCleanup(); return true; }
  }
  return false;
}

function tryTriggerTranscript() {
  if (triggerAttempted) return;
  triggerAttempted = true;

  // 先隐身面板,再点按钮 —— 用户看不到右侧内容被替换
  hideTranscriptPanel();

  if (clickTranscriptButton()) return;

  // 方法 3:延时兜底,重试 15s
  let attempts = 0;
  triggerTimer = setInterval(() => {
    if (++attempts > 30) {
      clearInterval(triggerTimer!); triggerTimer = null;
      restoreTranscriptPanel();
      return;
    }
    if (clickTranscriptButton()) {
      clearInterval(triggerTimer!); triggerTimer = null;
    }
  }, 500);
}

// ---- 第三部分:snapshot ----

function readSnapshot() {
  const w = window as unknown as {
    ytInitialPlayerResponse?: unknown;
    ytInitialData?: unknown;
    yt?: { config_?: { INNERTUBE_API_KEY?: string } };
  };
  window.postMessage({
    __nosub: true,
    type: 'snapshot',
    payload: {
      playerResponse: w.ytInitialPlayerResponse ?? null,
      initialData: w.ytInitialData ?? null,
      innerTubeApiKey: w.yt?.config_?.INNERTUBE_API_KEY ?? null,
    },
  }, '*');
}

// ---- 第三部分 B: IOS timedtext 直接获取 (不需 POT, 不点按钮) ----

async function fetchTimedText(videoId: string): Promise<unknown | null> {
  try {
    const w = window as unknown as {
      yt?: { config_?: { INNERTUBE_API_KEY?: string } };
    };
    const key = w.yt?.config_?.INNERTUBE_API_KEY;
    if (!key) return null;

    // 用 IOS 客户端请求 player response (不需要 POT)
    const resp = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '20.10.38',
            deviceMake: 'Apple',
            deviceModel: 'iPhone16,2',
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
    });
    if (!resp.ok) return null;

    const data = await resp.json() as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<{
            languageCode: string;
            kind?: string;
            baseUrl: string;
          }>;
        };
      };
    };

    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks?.length) return null;

    // 选英文轨道 (优先 ASR, 因为大部分视频只有 ASR)
    const en = tracks.find(t => t.languageCode === 'en')
      ?? tracks.find(t => t.languageCode.startsWith('en'))
      ?? tracks[0];
    if (!en?.baseUrl) return null;

    // fetch timedtext json3
    const subResp = await fetch(en.baseUrl + '&fmt=json3', {
      credentials: 'include',
    });
    if (!subResp.ok) return null;

    const text = await subResp.text();
    if (text.length === 0 || !text.startsWith('{')) return null;

    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- 第四部分:监听 content script ----

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as { __nosub?: boolean; type?: string; reqId?: number; payload?: Record<string, unknown> };
  if (!d?.__nosub) return;
  switch (d.type) {
    case 'request-snapshot':
      resetTriggerState();
      readSnapshot();
      break;
    case 'trigger-transcript':
      tryTriggerTranscript();
      break;
    case 'fetch-transcript':
      // 降级:如果已有缓存的 proxy 响应就用;否则触发按钮
      tryTriggerTranscript();
      break;
    case 'fetch-timedtext': {
      // IOS timedtext 主路径
      const reqId = d.reqId ?? -1;
      const videoId = (d.payload as { videoId?: string })?.videoId;
      if (!videoId) {
        window.postMessage({ __nosub: true, type: 'timedtext-error', reqId, payload: { error: 'no videoId' } }, '*');
        break;
      }
      fetchTimedText(videoId).then(result => {
        if (result) {
          window.postMessage({ __nosub: true, type: 'timedtext-response', reqId, payload: result }, '*');
        } else {
          window.postMessage({ __nosub: true, type: 'timedtext-error', reqId, payload: { error: 'fetch failed' } }, '*');
        }
      });
      break;
    }
  }
});

// ---- 启动 ----
installProxy();
readSnapshot();

export {};
