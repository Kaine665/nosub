/**
 * nosub 演示 — 第一段: 日常浏览
 *
 * 用法: F12 Console 粘贴运行, 全屏后开始录屏
 */
(() => {
  const STEPS = [
    { action: 'show', text: '正常播放', sub: '什么都不开, 自然看视频', wait: 3500 },
    { action: 'key', key: 's', text: '按 S — 字幕', sub: '单词级渲染, 可点击', wait: 4500 },
    { action: 'wait', text: '点击单词试试', sub: '查看释义、发音、例句', wait: 5500 },
    { action: 'key', key: 's', text: '再按 S — 加翻译', sub: '双语字幕', wait: 4500 },
    { action: 'key', key: 's', text: '再按 S — 关闭字幕', sub: '回到纯净模式', wait: 3000 },
    { action: 'key', key: 'e', text: '按 E — 慢速', sub: '0.8×', wait: 4000 },
    { action: 'key', key: 'e', text: '再按 E — 更慢', sub: '0.6×', wait: 4000 },
    { action: 'key', key: 'e', text: '再按 E — 恢复', sub: '1× 正常', wait: 3000 },
    { action: 'show', text: '日常模式', sub: '不干扰, 你想用才用', wait: 3000 },
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
    console.log('%c🎬 第一段: 日常浏览', 'font-size:16px;color:#6ec6ff');
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
    console.log('%c✅ 第一段结束 — 准备录第二段(精听)', 'font-size:14px;color:#4caf50');
  }

  // 全屏
  const fsTarget = document.querySelector('#movie_player');
  fsTarget?.requestFullscreen?.().catch(() => {});

  console.log('%c⏳ 5 秒后开始 — 关 DevTools, 开录屏', 'font-size:14px;color:#ffaa00');
  setTimeout(run, 5000);
})();
