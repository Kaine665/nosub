/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionLifecycle } from '../../src/content/session-lifecycle.js';
import type {
  PlayerAdapterFactory,
  CaptionAdapterFactory,
} from '../../src/content/session-lifecycle.js';
import { FakePlayerAdapter } from './fake-player-adapter.js';
import { FakeCaptionAdapter } from './fake-caption-adapter.js';
import type { Cue } from '../../src/shared/types.js';

// ---- helpers ----

function cues(): Cue[] {
  return [
    { id: 'c0', startMs: 0, endMs: 1000, text: 'hello' },
    { id: 'c1', startMs: 1000, endMs: 2000, text: 'world' },
  ];
}

function createAdapters() {
  const players: FakePlayerAdapter[] = [];
  const captions: FakeCaptionAdapter[] = [];

  const playerFactory: PlayerAdapterFactory = (videoId) => {
    const p = new FakePlayerAdapter(videoId);
    players.push(p);
    return p;
  };
  const captionFactory: CaptionAdapterFactory = () => {
    const c = new FakeCaptionAdapter(cues());
    captions.push(c);
    return c;
  };

  return { players, captions, playerFactory, captionFactory };
}

/** 模拟 YouTube SPA 导航:改 URL + 抛 yt-navigate-finish */
function navigate(url: string): void {
  history.pushState(null, '', url);
  window.dispatchEvent(new Event('yt-navigate-finish'));
}

// ---- tests ----

describe('SessionLifecycle', () => {
  let lifecycle: SessionLifecycle;
  let playerFactory: PlayerAdapterFactory;
  let captionFactory: CaptionAdapterFactory;

  beforeEach(() => {
    history.replaceState(null, '', 'https://www.youtube.com/');
    const env = createAdapters();
    playerFactory = env.playerFactory;
    captionFactory = env.captionFactory;
    lifecycle = new SessionLifecycle(playerFactory, captionFactory);
  });

  afterEach(() => {
    lifecycle?.dispose();
  });

  // ---- 启动 ----

  it('启动时已在 /watch 页:创建 session 并 emit session-started', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const events: string[] = [];
    lifecycle.subscribe((e) => events.push(e.type));

    await lifecycle.start();

    expect(events).toContain('session-started');
    expect(events).toContain('video-detected');
    expect(lifecycle.getActiveSession()?.videoId).toBe('AAAAAAAAAAA');
    expect(lifecycle.getActiveSession()?.videoSessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('启动时不在 /watch 页:不创建 session,emit no-session', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/');
    const events: string[] = [];
    lifecycle.subscribe((e) => events.push(e.type));

    await lifecycle.start();

    expect(events).toContain('no-session');
    expect(lifecycle.getActiveSession()).toBeNull();
  });

  // ---- 视频切换 ----

  it('SPA 切到另一个视频:旧 session 结束,新 session 创建', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const events: { type: string; videoId?: string }[] = [];
    lifecycle.subscribe((e) => events.push({ type: e.type, videoId: 'videoId' in e ? e.videoId : undefined }));

    await lifecycle.start();
    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    // handleNavigation 是 async,等微任务队列排空
    await new Promise((r) => setTimeout(r, 100));

    const sessionEnding = events.filter((e) => e.type === 'session-ending');
    const sessionStarted = events.filter((e) => e.type === 'session-started');
    expect(sessionEnding.length).toBeGreaterThanOrEqual(1);
    expect(sessionEnding[0].videoId).toBe('AAAAAAAAAAA');
    expect(lifecycle.getActiveSession()?.videoId).toBe('BBBBBBBBBBB');
    expect(sessionStarted.length).toBe(2); // 初始 + 切换
  });

  it('新视频不显示旧视频信息', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await lifecycle.start();

    const oldSession = lifecycle.getActiveSession();
    expect(oldSession?.videoId).toBe('AAAAAAAAAAA');

    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    await new Promise((r) => setTimeout(r, 100));

    const newSession = lifecycle.getActiveSession();
    expect(newSession?.videoId).toBe('BBBBBBBBBBB');
    // 新旧是不同对象
    expect(newSession).not.toBe(oldSession);
  });

  it('连续切 5 个视频:每次都创建新 session,每次 videoId 正确', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const startedIds: string[] = [];
    lifecycle.subscribe((e) => {
      if (e.type === 'session-started') startedIds.push(e.session.videoId);
    });

    await lifecycle.start();
    const ids = ['BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD', 'EEEEEEEEEEE', 'FFFFFFFFFFF'];
    for (const id of ids) {
      navigate(`https://www.youtube.com/watch?v=${id}`);
      await new Promise((r) => setTimeout(r, 50));
    }

    // 每个 id 都有 session-started 事件
    for (const id of ids) {
      expect(startedIds).toContain(id);
    }
    expect(lifecycle.getActiveSession()?.videoId).toBe('FFFFFFFFFFF');
    expect(lifecycle.getActiveSession()).not.toBeNull();
  });

  // ---- 离开 /watch ----

  it('离开 /watch:end session,emit no-session', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const events: string[] = [];
    lifecycle.subscribe((e) => events.push(e.type));

    await lifecycle.start();
    navigate('https://www.youtube.com/');
    await new Promise((r) => setTimeout(r, 100));

    expect(events).toContain('session-ending');
    expect(events.at(-1)).toBe('no-session');
    expect(lifecycle.getActiveSession()).toBeNull();
  });

  // ---- 并发守卫 ----

  it('快速切视频:stale 会话不覆盖新会话', async () => {
    // 使用一个会延迟的 player factory 来模拟慢速 attach
    let slowResolve!: (v: boolean) => void;
    const slowPlayer = new FakePlayerAdapter('SLOW');
    slowPlayer.attach = () => new Promise<boolean>((resolve) => { slowResolve = resolve; });

    let callCount = 0;
    const mixedPlayerFactory: PlayerAdapterFactory = (videoId) => {
      callCount++;
      if (callCount === 1) return slowPlayer; // 第一个请求返回慢速 player
      return new FakePlayerAdapter(videoId);   // 后续正常
    };

    lifecycle = new SessionLifecycle(mixedPlayerFactory, captionFactory);
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');

    // 启动——第一个 startSession 会卡在 slowPlayer.attach 上
    const startPromise = lifecycle.start();

    // 等 microtasks flush,让 startSession 进到 await slowPlayer.attach 的位置
    await new Promise((r) => setTimeout(r, 10));

    // 此时第一个 startSession 还在 pending,立即触第二次 navigation
    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    await new Promise((r) => setTimeout(r, 50));

    // 第二个 session 应该已就绪(gen=2)
    // 注意:第一次 startSession 还在 pending,所以 active 可能仍是 B 的 session
    // 现在让第一个 attach resolve
    slowResolve!(true);
    await new Promise((r) => setTimeout(r, 50));
    await startPromise; // 等最初的 start() settle

    // 最终 active session 必须是 B(不是 A 也不是 SLOW)
    const active = lifecycle.getActiveSession();
    expect(active).not.toBeNull();
    expect(active?.videoId).toBe('BBBBBBBBBBB');
  });

  // ---- dispose ----

  it('dispose 后 getActiveSession 返回 null', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await lifecycle.start();
    expect(lifecycle.getActiveSession()).not.toBeNull();

    lifecycle.dispose();
    expect(lifecycle.getActiveSession()).toBeNull();
  });

  it('dispose 后切换视频不再响应', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await lifecycle.start();
    lifecycle.dispose();

    const events: string[] = [];
    lifecycle.subscribe((e) => events.push(e.type));
    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    await new Promise((r) => setTimeout(r, 50));

    // disposed 的 lifecycle 不应再发事件
    expect(events).toHaveLength(0);
  });

  // ---- subscribe ----

  it('subscribe 返回取消函数', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    let count = 0;
    const unsub = lifecycle.subscribe(() => count++);
    await lifecycle.start();
    expect(count).toBeGreaterThanOrEqual(1);

    const before = count;
    unsub();
    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(before); // 取消后不再收到事件
  });

  // ---- ActiveSession ----

  it('ActiveSession 包含 player 和 captions', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await lifecycle.start();

    const session = lifecycle.getActiveSession();
    expect(session).not.toBeNull();
    expect(session!.player).toBeDefined();
    expect(session!.captions).toBeDefined();
    expect(session!.player.getVideoId()).toBe('AAAAAAAAAAA');
  });

  it('active session 的 captions 可用', async () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await lifecycle.start();

    const session = lifecycle.getActiveSession()!;
    expect(session.captions.isAvailable()).toBe(true);
  });
});
