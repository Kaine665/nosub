/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { YouTubePlayerAdapter } from '../../src/youtube/youtube-player-adapter.js';
import type { PlayerEvent } from '../../src/youtube/player-adapter.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function setupVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  document.body.appendChild(video);
  return video;
}

describe('YouTubePlayerAdapter.attach', () => {
  it('视频元素已存在时绑定成功', async () => {
    setupVideo();
    const adapter = new YouTubePlayerAdapter('vid-1');
    const ok = await adapter.attach(500);
    expect(ok).toBe(true);
    expect(adapter.isReady()).toBe(true);
    adapter.dispose();
  });

  it('超时未找到视频元素返回 false', async () => {
    const adapter = new YouTubePlayerAdapter('vid-1');
    const ok = await adapter.attach(200);
    expect(ok).toBe(false);
    expect(adapter.isReady()).toBe(false);
    adapter.dispose();
  });
});

describe('YouTubePlayerAdapter 时间控制', () => {
  it('getCurrentTimeMs 返回毫秒', async () => {
    const v = setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    v.currentTime = 2.5;
    expect(adapter.getCurrentTimeMs()).toBe(2500);
    adapter.dispose();
  });

  it('seekToMs 设置 currentTime(秒)', async () => {
    setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    adapter.seekToMs(3000);
    const v = document.querySelector('video')!;
    expect(v.currentTime).toBe(3);
    adapter.dispose();
  });
});

describe('YouTubePlayerAdapter 事件订阅', () => {
  it('timeupdate 事件被转发为毫秒时间', async () => {
    const v = setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    const events: PlayerEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    v.currentTime = 1.2;
    v.dispatchEvent(new Event('timeupdate'));
    expect(events).toContainEqual({ type: 'timeupdate', currentTimeMs: 1200 });
    adapter.dispose();
  });

  it('play / pause 事件被转发', async () => {
    setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    const v = document.querySelector('video')!;
    const events: string[] = [];
    adapter.subscribe((e) => events.push(e.type));
    v.dispatchEvent(new Event('play'));
    v.dispatchEvent(new Event('pause'));
    expect(events).toEqual(['play', 'pause']);
    adapter.dispose();
  });

  it('seeking 事件被转为 seek', async () => {
    const v = setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    const events: PlayerEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    v.currentTime = 4;
    v.dispatchEvent(new Event('seeking'));
    expect(events.find((e) => e.type === 'seek')).toEqual({ type: 'seek', currentTimeMs: 4000 });
    adapter.dispose();
  });

  it('订阅返回取消函数', async () => {
    setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    let count = 0;
    const unsub = adapter.subscribe(() => count++);
    const v = document.querySelector('video')!;
    v.dispatchEvent(new Event('play'));
    unsub();
    v.dispatchEvent(new Event('play'));
    expect(count).toBe(1);
    adapter.dispose();
  });
});

describe('YouTubePlayerAdapter dispose', () => {
  it('dispose 后不再触发监听器', async () => {
    setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    const v = document.querySelector('video')!;
    let count = 0;
    adapter.subscribe(() => count++);
    adapter.dispose();
    v.dispatchEvent(new Event('play'));
    expect(count).toBe(0);
  });

  it('dispose 后 isReady 返回 false', async () => {
    setupVideo();
    const adapter = new YouTubePlayerAdapter('vid');
    await adapter.attach(500);
    expect(adapter.isReady()).toBe(true);
    adapter.dispose();
    expect(adapter.isReady()).toBe(false);
  });
});

describe('YouTubePlayerAdapter setVideoId', () => {
  it('videoId 变化时触发 videochange 事件', () => {
    const adapter = new YouTubePlayerAdapter('vid-1');
    const events: PlayerEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    adapter.setVideoId('vid-2');
    expect(events).toContainEqual({ type: 'videochange', videoId: 'vid-2' });
    adapter.dispose();
  });

  it('videoId 不变时不触发事件', () => {
    const adapter = new YouTubePlayerAdapter('vid-1');
    let count = 0;
    adapter.subscribe(() => count++);
    adapter.setVideoId('vid-1');
    expect(count).toBe(0);
    adapter.dispose();
  });
});
