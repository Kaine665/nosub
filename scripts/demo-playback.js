/**
 * nosub 演示脚本
 *
 * 用法:
 *   1. 在 Chrome 中加载 nosub 扩展 (chrome://extensions → 加载 dist/)
 *   2. 打开一个有英文字幕的 YouTube 视频
 *   3. 打开 DevTools Console (F12)
 *   4. 粘贴此脚本并回车
 *   5. 开始录屏 (OBS / Win+G / QuickTime)
 *   6. 脚本会自动演示全部功能, 每步停留供截图
 *
 * 特性:
 *   - 每个按键操作会在屏幕中央显示大字提示
 *   - 精确控制每步间隔, 录出来很顺
 */

(() => {
  const STEPS = [
    { action: 'show', text: 'nosub 演示', sub: 'YouTube 英语精听助手', wait: 2500 },
    { action: 'key', key: 's', text: '按 S — 显示字幕', sub: '单词级渲染，可点击', wait: 3000 },
    { action: 'key', key: 'a', text: '按 A — 进入循环', sub: '当前句反复播放', wait: 4000 },
    { action: 'wait', text: '循环中…', sub: '听几遍', wait: 3000 },
    { action: 'key', key: 's', text: '按 S — 揭示字幕', sub: '从遮挡到完整', wait: 3000 },
    { action: 'key', key: 's', text: '按 S — 加翻译', sub: '双语字幕', wait: 3500 },
    { action: 'key', key: 'a', text: '按 A — 前一句', sub: '自动重置为遮挡', wait: 3000 },
    { action: 'key', key: 'd', text: '按 D — 退出循环', sub: '恢复正常播放', wait: 2500 },
    { action: 'key', key: 'e', text: '按 E — 慢速播放', sub: '0.8× 速度', wait: 3000 },
    { action: 'key', key: 'e', text: '按 E — 更慢', sub: '0.6× 速度', wait: 3000 },
    { action: 'key', key: 'e', text: '按 E — 恢复速度', sub: '1× 正常', wait: 2000 },
    { action: 'show', text: 'nosub', sub: 'YouTube 英语精听助手', wait: 2000 },
  ];

  // ---- 创建提示浮层 ----
  const overlay = document.createElement('div');
  overlay.id = 'nosub-demo-overlay';
  Object.assign(overlay.style, {
    position: 'absolute', zIndex: '999999',
    top: '15%', left: '24px',
    pointerEvents: 'none',
    transition: 'opacity 0.4s',
    opacity: '0',
  });

  // 用 DOM API 构建, 绕过 YouTube Trusted Types
  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'rgba(0,0,0,0.85)',
    backdropFilter: 'blur(20px)',
    borderRadius: '20px',
    padding: '24px 48px',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  });

  const title = document.createElement('div');
  Object.assign(title.style, {
    font: '700 32px system-ui, sans-serif',
    color: '#fff',
    marginBottom: '8px',
    textShadow: '0 2px 8px rgba(0,0,0,0.5)',
  });
  title.id = 'demo-title';

  const sub = document.createElement('div');
  Object.assign(sub.style, {
    font: '400 16px system-ui, sans-serif',
    color: 'rgba(255,255,255,0.6)',
  });
  sub.id = 'demo-sub';

  card.appendChild(title);
  card.appendChild(sub);
  overlay.appendChild(card);

  // 挂到 movie_player 内部, 这样 YouTube 全屏也能看到
  const playerEl = document.querySelector('#movie_player');
  if (playerEl) {
    playerEl.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }

  // ---- 模拟按键 ----
  function pressKey(key) {
    const target = document.querySelector('video') ?? document.body;
    ['keydown', 'keypress', 'keyup'].forEach((type) => {
      target.dispatchEvent(new KeyboardEvent(type, {
        key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true,
      }));
      window.dispatchEvent(new KeyboardEvent(type, {
        key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true,
      }));
    });
  }

  // ---- 显示提示 ----
  function showHint(title, sub = '') {
    overlay.querySelector('#demo-title').textContent = title;
    overlay.querySelector('#demo-sub').textContent = sub;
    overlay.style.opacity = '1';
  }
  function hideHint() {
    overlay.style.opacity = '0';
  }

  // ---- 运行 ----
  async function run() {
    console.log('%c🎬 nosub 演示开始 — 现在开始录屏！', 'font-size:16px;color:#6ec6ff');

    // 确保视频在播放
    const video = document.querySelector('video');
    if (video && video.paused) {
      video.play();
    }

    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      const progress = `[${i + 1}/${STEPS.length}]`;
      console.log(`${progress} ${step.action}: ${step.text}`);

      showHint(step.text, step.sub);
      await sleep(600);

      if (step.action === 'key') {
        pressKey(step.key);
      }

      await sleep(step.wait);
      hideHint();
      await sleep(400);
    }

    overlay.remove();
    console.log('%c✅ 演示结束', 'font-size:16px;color:#4caf50');
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // 延迟 5 秒开始，给用户时间: 关闭 DevTools + 开始录屏 + 等全屏
  console.log('%c⏳ 5 秒后开始: 1)按 F11 全屏  2)关闭 DevTools  3)开始录屏', 'font-size:14px;color:#ffaa00');

  // 尝试请求全屏(YouTube 播放器全屏)
  const video = document.querySelector('video');
  const playerEl2 = document.querySelector('#movie_player');
  const fullScreenTarget = playerEl2 || video;
  if (fullScreenTarget?.requestFullscreen) {
    fullScreenTarget.requestFullscreen().catch(() => {});
  } else if (video?.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  }

  setTimeout(run, 5000);
})();
