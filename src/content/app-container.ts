/**
 * 最小 UI 容器挂载 —— 嵌入 YouTube 视频播放器内部(#movie_player)。
 * 这样全屏时 UI 仍在视野内,像 YouTube 原生字幕一样覆盖在视频上。
 *
 * 挂载点: #movie_player 内部,position:absolute 定位在底部。
 * 不遮挡视频核心区域,与 YouTube 原生 CC 字幕显示位置一致。
 */

const HOST_ID = 'nosub-root';

/**
 * 在 #movie_player 内部挂载 nosub 容器。幂等。
 * 返回 ShadowRoot 供 UI 层填充,或 null 表示找不到播放器。
 */
export function mountAppContainer(): ShadowRoot | null {
  if (document.getElementById(HOST_ID)) {
    return document.getElementById(HOST_ID)?.shadowRoot ?? null;
  }

  const player = document.querySelector('#movie_player') as HTMLElement | null;
  if (!player) return null;

  // 确保 player 是相对定位容器
  const playerPos = window.getComputedStyle(player).position;
  if (playerPos === 'static') {
    player.style.position = 'relative';
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  // 绝对定位在播放器底部,像 YouTube CC 字幕一样
  host.style.position = 'absolute';
  host.style.left = '0';
  host.style.right = '0';
  host.style.bottom = '80px'; // 高于 YouTube 控制条 80px
  host.style.zIndex = '30'; // YouTube 控制条是 ~35,字幕层是 ~30
  host.style.display = 'flex';
  host.style.justifyContent = 'center';
  host.style.alignItems = 'flex-end';
  host.style.pointerEvents = 'none'; // 不拦截视频点击

  const shadow = host.attachShadow({ mode: 'open' });
  player.appendChild(host);
  return shadow;
}

/**
 * 卸载容器(SPA 切换或 dispose 时调用)。幂等。
 */
export function unmountAppContainer(): void {
  document.getElementById(HOST_ID)?.remove();
}
