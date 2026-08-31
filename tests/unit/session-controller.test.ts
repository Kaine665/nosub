import { describe, it, expect } from 'vitest';
import { SessionController } from '../../src/content/session-controller.js';
import type { ViewState } from '../../src/content/session-controller.js';
import { FakePlayerAdapter } from './fake-player-adapter.js';
import { FakeCaptionAdapter } from './fake-caption-adapter.js';
import type { Cue } from '../../src/shared/types.js';
import type { Scheduler } from '../../src/playback/playback-engine.js';

const CUES: Cue[] = [
  { id: 'c0', startMs: 0, endMs: 1000, text: 'zero' },
  { id: 'c1', startMs: 1000, endMs: 2000, text: 'one' },
  { id: 'c2', startMs: 2000, endMs: 3000, text: 'two' },
  { id: 'c3', startMs: 3000, endMs: 4000, text: 'three' },
];

/** no-op scheduler */
const noopScheduler: Scheduler = {
  requestFrame: () => 0,
  cancelFrame: () => {},
};

function setup(cues: Cue[] = CUES) {
  const player = new FakePlayerAdapter('vid-1');
  const captions = new FakeCaptionAdapter(cues);
  const controller = new SessionController(player, captions, noopScheduler);
  return { player, captions, controller };
}

async function initReady(cues: Cue[] = CUES) {
  const env = setup(cues);
  await env.controller.init('vid-1');
  return env;
}

describe('SessionController.init', () => {
  it('加载字幕成功后进入 ready 状态', async () => {
    const { controller } = await initReady();
    const state = controller.getState();
    expect(state.status).toBe('ready');
    expect(state.isRepeating).toBe(false);
    expect(state.revealLevel).toBe(0);
  });

  it('无字幕时进入 unsupported 状态', async () => {
    const { controller } = await initReady([]);
    const state = controller.getState();
    expect(state.status).toBe('unsupported');
    expect(state.errorMessage).toBeTruthy();
  });

  it('字幕加载失败进入 error 状态', async () => {
    const env = setup();
    env.captions.failLoadOnNext();
    await env.controller.init('vid-1');
    expect(env.controller.getState().status).toBe('error');
  });
});

describe('SessionController.toggleReveal (S 键)', () => {
  it('初始 revealLevel=0', async () => {
    const { controller } = await initReady();
    expect(controller.getState().revealLevel).toBe(0);
  });

  it('按 S → 0 → 1 → 2 → 0 循环', async () => {
    const { controller } = await initReady();
    expect(controller.getState().revealLevel).toBe(0);
    controller.toggleReveal();
    expect(controller.getState().revealLevel).toBe(1);
    controller.toggleReveal();
    expect(controller.getState().revealLevel).toBe(2);
    controller.toggleReveal();
    expect(controller.getState().revealLevel).toBe(0);
  });

  it('免费用户也保持 0 → 1 → 2 → 0，不被 Pro 权限强制降档', async () => {
    const { controller } = await initReady();
    controller.setProAccess(false);
    controller.toggleReveal();
    expect(controller.getState().revealLevel).toBe(1);
    controller.toggleReveal();
    expect(controller.getState().revealLevel).toBe(2);
    controller.toggleReveal();
    expect(controller.getState().revealLevel).toBe(0);
  });

});

describe('SessionController.toggleFocusedListening (Q 键)', () => {
  it('normal: 当前 cue 进入精听，再按 Q 退出', async () => {
    const { controller, player } = await initReady();
    player.tickTo(2500);
    controller.toggleFocusedListening();
    expect(controller.getState().isRepeating).toBe(true);
    expect(controller.getState().activeCue?.id).toBe('c2');
    controller.toggleFocusedListening();
    expect(controller.getState().isRepeating).toBe(false);
  });
});

describe('SessionController.requestLoopBack (A 键)', () => {
  it('normal: A 不进入精听；精听中 A 返回上一句', async () => {
    const { controller, player } = await initReady();
    player.tickTo(2500);
    controller.requestLoopBack();
    expect(controller.getState().isRepeating).toBe(false);
    controller.toggleFocusedListening();
    controller.requestLoopBack();
    expect(controller.getState().activeCue?.id).toBe('c1');
  });
});

describe('SessionController.requestNext (D 键)', () => {
  it('精听中进入下一句并保持精听', async () => {
    const { controller, player } = await initReady();
    player.tickTo(2500);
    controller.toggleFocusedListening();
    controller.requestNext();
    expect(controller.getState().isRepeating).toBe(true);
    expect(controller.getState().activeCue?.id).toBe('c3');
  });
});

describe('SessionController core action outcomes', () => {
  it('records keyboard and toolbar results only when an action succeeds', async () => {
    const { controller, player } = await initReady();
    const outcomes: Array<{ action: string; actionResult: string; inputMethod: string }> = [];
    controller.subscribeToCoreActions((outcome) => outcomes.push(outcome));

    player.tickTo(2500);
    controller.toggleFocusedListening('toolbar');
    controller.requestLoopBack('toolbar');
    controller.requestNext('keyboard');
    controller.toggleFocusedListening('keyboard');
    controller.toggleReveal('toolbar');

    expect(outcomes).toEqual([
      { action: 'Q', actionResult: 'enter_focused_listening', inputMethod: 'toolbar' },
      { action: 'A', actionResult: 'previous_cue', inputMethod: 'toolbar' },
      { action: 'D', actionResult: 'next_cue', inputMethod: 'keyboard' },
      { action: 'Q', actionResult: 'exit_focused_listening', inputMethod: 'keyboard' },
      { action: 'S', actionResult: 'show_original', inputMethod: 'toolbar' },
    ]);
  });

  it('does not record S before ready or D at the final cue', async () => {
    const { controller } = setup();
    const outcomes: string[] = [];
    controller.subscribeToCoreActions((outcome) => outcomes.push(outcome.actionResult));
    controller.toggleReveal('toolbar');
    expect(outcomes).toEqual([]);

    await controller.init('vid-1');
    controller.onTick(3500);
    controller.requestNext('keyboard');
    expect(outcomes).toEqual([]);
  });
});

describe('SessionController.subscribe', () => {
  it('状态变化通知监听器', async () => {
    const { controller } = setup();
    const states: ViewState[] = [];
    controller.subscribe((s) => states.push(s));
    await controller.init('vid-1');
    expect(states.some((s) => s.status === 'ready')).toBe(true);
  });
});

describe('SessionController.getCueWindow', () => {
  it('返回当前句前 5 句和后 15 句，并在轨道边缘裁剪', async () => {
    const cues = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`, startMs: i * 1000, endMs: (i + 1) * 1000, text: `word ${i}`,
    }));
    const { controller } = await initReady(cues);
    const window = controller.getCueWindow('c10', 5, 15);
    expect(window).toHaveLength(21);
    expect(window[0].id).toBe('c5');
    expect(window.at(-1)?.id).toBe('c25');
    expect(controller.getCueWindow('c1', 5, 15)[0].id).toBe('c0');
  });
});

describe('SessionController.dispose', () => {
  it('销毁后 session 为 null', async () => {
    const { controller } = await initReady();
    controller.dispose();
    expect(controller.getSession()).toBeNull();
  });
});
