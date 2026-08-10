/**
 * Content script 入口 —— 组装完整精听流水线。
 *
 * 依赖链(全在 T03-T13 完成的模块):
 *   NavigationObserver → SessionLifecycle → SessionController
 *   SessionController 持有 PlaybackEngine + ListeningUI + KeyboardController
 *   SettingsRepository 提供持久化偏好
 *
 * SPA 幂等:用全局标记防止重复注入。
 */

import { SessionLifecycle } from './session-lifecycle.js';
import { SessionController } from './session-controller.js';
import { PlaybackEngine } from '../playback/playback-engine.js';
import { KeyboardController } from './keyboard-controller.js';
import { mountAppContainer, unmountAppContainer } from './app-container.js';
import { ListeningUI } from '../ui/listening-ui.js';
import { SettingsRepository } from '../storage/settings-repository.js';
import { logger } from '../shared/logger.js';
import type { AccountResponse } from '../auth/types.js';

const log = logger.createLogger('bootstrap');

interface NosubRuntime {
  controller: SessionController | null;
  ui: ListeningUI | null;
  keyboard: KeyboardController | null;
  engine: PlaybackEngine | null;
}

// 防止 content script 重复注入(design §6.4 幂等)
if ((globalThis as { __nosub_bootstrapped?: boolean }).__nosub_bootstrapped) {
  // 已初始化
} else {
  (globalThis as { __nosub_bootstrapped?: boolean }).__nosub_bootstrapped = true;

  const runtime: NosubRuntime = {
    controller: null,
    ui: null,
    keyboard: null,
    engine: null,
  };

  const settings = new SettingsRepository();
  const lifecycle = new SessionLifecycle();

  lifecycle.subscribe(async (event) => {
    if (event.type === 'session-started') {
      await startController(event.session.player, event.session.captions, event.session.videoId);
    } else if (event.type === 'session-ending') {
      stopController();
    }
    // no-session:不做事(UI 不挂)
  });

  async function startController(
    player: import('../youtube/player-adapter.js').PlayerAdapter,
    captions: import('../youtube/caption-adapter.js').CaptionAdapter,
    videoId: string,
  ): Promise<void> {
    // 清理旧的(防御性)
    stopController();

    const saved = await settings.load();
    if (!saved.enabled) {
      log.info('extension disabled in settings');
      return;
    }

    const controller = new SessionController(player, captions);
    runtime.controller = controller;

    // 加载持久化设置并应用
    controller.updateSettings(saved);
    void chrome.runtime.sendMessage({ type: 'account:get' }).then((response: AccountResponse) => {
      if (response.ok && response.account) controller.setProAccess(response.account.isPro);
    }).catch(() => controller.setProAccess(false));

    // 循环引擎:订阅 controller 的意图,在进入 repeat 时 startLoop
    const engine = new PlaybackEngine(player, {
      onIteration: () => {
        // 每轮循环可触发 UI 动效,T12 暂不处理
      },
    });
    runtime.engine = engine;

    // UI 挂载
    const shadow = mountAppContainer();
    if (shadow) {
      runtime.ui = new ListeningUI({ shadow, controller });
    }

    // 键盘
    const keyboard = new KeyboardController(controller, {
      isEnabled: () => {
        const state = controller.getState();
        return state.status === 'ready';
      },
    });
    keyboard.attach();
    runtime.keyboard = keyboard;

    // 订阅 controller 状态:进入 repeat → startLoop;退出 repeat → stopLoop
    controller.subscribe((state) => {
      // stopController 后 engine 已清空, 不再操作
      if (!runtime.engine) return;
      if (state.status !== 'ready') {
        runtime.engine.stopLoop();
        return;
      }
      if (state.isRepeating && state.activeCue) {
        runtime.engine.startLoop(state.activeCue);
      } else {
        runtime.engine.stopLoop();
      }
    });

    // 初始化字幕加载
    await controller.init(videoId);
    log.info('session started:', videoId);
  }

  function stopController(): void {
    // 先断开 controller → engine 的订阅,防止 dispose 后回调仍触发 startLoop
    runtime.keyboard?.detach();
    runtime.engine?.dispose();
    runtime.engine = null;  // 先清引用, subscribe 回调里检查 null
    runtime.ui?.dispose();
    runtime.controller?.dispose();
    unmountAppContainer();
    runtime.keyboard = null;
    runtime.ui = null;
    runtime.controller = null;
  }

  lifecycle.start();
}
