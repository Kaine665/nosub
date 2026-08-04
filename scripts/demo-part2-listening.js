/**
 * nosub 演示 — 第二段: 精听模式
 *
 * 用法: F12 Console 粘贴运行
 */
(() => {
  const STEPS = [
    { action: 'show', text: '精听模式', sub: '逐句反复听, 直到听懂', wait: 3500 },
    { action: 'key', key: 'a', text: '按 A — 进入循环', sub: '字幕自动遮挡', wait: 4500 },
    { action: 'wait', text: '循环中…', sub: '先听几遍, 不看字幕', wait: 5000 },
    { action: 'key', key: 's', text: '按 S — 揭示字幕', sub: '确认你听到的', wait: 4500 },
    { action: 'key', key: 's', text: '再按 S — 加翻译', sub: '双语对照', wait: 4500 },
    { action: 'key', key: 'a', text: '按 A — 前一句', sub: '自动遮挡, 重新开始', wait: 4500 },
    { action: 'key', key: 's', text: '按 S — 看字幕', sub: '这次听懂了吗', wait: 4000 },
    { action: 'key', key: 'd', text: '按 D — 退出循环', sub: '继续看视频', wait: 3500 },
    { action: 'show', text: 'nosub', sub: 'YouTube 英语精听助手', wait: 3000 },
  ];

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute', zIndex: '999999',
    top: '15%', left: '24px',
    pointerEvents: 'none',
    transition: 'opacity 0.4s',
    opacity: '0',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)',
    borderRadius: '16px', padding: '16px 24px',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
  });

  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    font: '700 22px system-ui, sans-serif', color: '#fff',
    marginBottom: '4px', textShadow: '0 2px 8px rgba(0,0,0,0.5)',
  });

  const subEl = document.createElement('div');
  Object.assign(subEl.style, {
    font: '400 14px system-ui, sans-serif', color: 'rgba(255,255,255,0.55)',
  });

  card.appendChild(titleEl);
  card.appendChild(subEl);
  overlay.appendChild(card);

  const playerEl = document.querySelector('#movie_player');
  (playerEl || document.body).appendChild(overlay);

  function showHint(t, s = '') {
    titleEl.textContent = t;
    subEl.textContent = s;
    overlay.style.opacity = '1';
  }
  function hideHint() { overlay.style.opacity = '0'; }

  function pressKey(key) {
    const target = document.querySelector('video') || document.body;
    ['keydown', 'keyup'].forEach((type) => {
      target.dispatchEvent(new KeyboardEvent(type, {
        key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true,
      }));
      window.dispatchEvent(new KeyboardEvent(type, {
        key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true,
      }));
    });
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function run() {
    console.log('%c🎬 第二段: 精听模式', 'font-size:16px;color:#6ec6ff');
    const video = document.querySelector('video');
    if (video?.paused) video.play();

    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      console.log(`[${i + 1}/${STEPS.length}] ${step.text}`);
      showHint(step.text, step.sub);
      await sleep(1000);
      if (step.action === 'key') pressKey(step.key);
      await sleep(step.wait);
      hideHint();
      await sleep(600);
    }
    overlay.remove();
    console.log('%c✅ 第二段结束 — 全部完成', 'font-size:14px;color:#4caf50');
  }

  console.log('%c⏳ 5 秒后开始 — 关 DevTools, 开录屏', 'font-size:14px;color:#ffaa00');
  setTimeout(run, 5000);
})();
