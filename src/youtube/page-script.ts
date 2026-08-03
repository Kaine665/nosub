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

function hideTranscriptPanel() {
  if (panelHidden) return;
  panelHidden = true;
  const style = document.createElement('style');
  style.id = 'nosub-hide-panel';
  // visibility:hidden 而非 display:none —— 保留布局让 YouTube 以为面板还在,不报错
  style.textContent = `
    ytd-engagement-panel-section-list-renderer {
      visibility: hidden !important;
      position: absolute !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function restoreTranscriptPanel() {
  panelHidden = false;
  document.getElementById('nosub-hide-panel')?.remove();
}

function closeTranscriptPanel() {
  if (!triggeredButton) return; // 不是我们打开的,不碰

  // 策略:延时后尝试关闭。先试已存储的按钮引用,如果失效则重新 query。
  const tryClose = () => {
    // 确认面板存在(已渲染)
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer');
    if (!panel) return; // 面板还没渲染,等下一轮

    // 方法 1:用存储的按钮引用
    if (triggeredButton && document.contains(triggeredButton)) {
      triggeredButton.click();
      triggeredButton = null;
      restoreTranscriptPanel();
      return;
    }

    // 方法 2:按钮引用失效,重新查找并点击
    const container = document.querySelector('ytd-video-description-transcript-section-renderer');
    if (container) {
      const btn = container.querySelector('button') as HTMLButtonElement | null;
      if (btn) {
        btn.click();
        triggeredButton = null;
        restoreTranscriptPanel();
        return;
      }
    }

    // 方法 3:直接找 aria-label 按钮
    for (const sel of [
      'button[aria-label="显示文字版"]',
      'button[aria-label="内容转文字"]',
      'button[aria-label="Show transcript"]',
      'button[aria-label*="transcript" i]',
    ]) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn) { btn.click(); break; }
    }
    triggeredButton = null;
    restoreTranscriptPanel();
  };

  // 先等 300ms 让 YouTube 渲染面板
  setTimeout(tryClose, 300);
  // 兜底:800ms 再试一次
  setTimeout(() => {
    if (triggeredButton) tryClose();
  }, 800);
}

// ---- 第三部分:主动触发 transcript ----

let triggerAttempted = false;
let triggerTimer: ReturnType<typeof setInterval> | null = null;

function resetTriggerState() {
  triggerAttempted = false;
  if (triggerTimer) { clearInterval(triggerTimer); triggerTimer = null; }
}

function clickTranscriptButton(): boolean {
  // 方法 1:ytd-video-description-transcript-section-renderer
  const container = document.querySelector('ytd-video-description-transcript-section-renderer');
  if (container) {
    const btn = container.querySelector('button') as HTMLButtonElement | null;
    if (btn) { triggeredButton = btn; btn.click(); return true; }
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
    if (btn) { triggeredButton = btn; btn.click(); return true; }
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
  }
});

// ---- 启动 ----
installProxy();
readSnapshot();

export {};
