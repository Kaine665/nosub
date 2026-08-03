/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NavigationObserver,
  extractVideoId,
  isWatchPage,
} from '../../src/youtube/navigation-observer.js';

beforeEach(() => {
  // jsdom 下用 history 改 URL(直接赋值 location.href 会抛)
  history.replaceState(null, '', 'https://www.youtube.com/');
});

afterEach(() => {
  // 清掉所有 observer,避免泄漏
});

describe('extractVideoId', () => {
  it('从 watch URL 提取 11 位 videoId', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=LZArpRwziE8')).toBe('LZArpRwziE8');
  });
  it('带其它参数也能提取', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=LZArpRwziE8&t=42s')).toBe('LZArpRwziE8');
  });
  it('非视频页返回 null', () => {
    expect(extractVideoId('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });
  it('videoId 不是 11 位返回 null', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
  });
});

describe('isWatchPage', () => {
  it('/watch 是视频页', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=LZArpRwziE8');
    expect(isWatchPage()).toBe(true);
  });
  it('首页不是视频页', () => {
    history.replaceState(null, '', 'https://www.youtube.com/');
    expect(isWatchPage()).toBe(false);
  });
  it('搜索页不是视频页', () => {
    history.replaceState(null, '', 'https://www.youtube.com/results?search_query=test');
    expect(isWatchPage()).toBe(false);
  });
});

/** 模拟 SPA 导航:改 URL + 抛事件 */
function navigate(url: string): void {
  history.pushState(null, '', url);
  window.dispatchEvent(new Event('yt-navigate-finish'));
}

describe('NavigationObserver', () => {
  it('启动时已在视频页,getCurrentVideoId 返回当前 id', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    obs.start();
    expect(obs.getCurrentVideoId()).toBe('AAAAAAAAAAA');
    obs.dispose();
  });

  it('启动时不在视频页,getCurrentVideoId 返回 null', () => {
    history.replaceState(null, '', 'https://www.youtube.com/');
    const obs = new NavigationObserver();
    obs.start();
    expect(obs.getCurrentVideoId()).toBeNull();
    obs.dispose();
  });

  it('yt-navigate-finish 事件触发 videochange', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    const events: string[] = [];
    obs.subscribe((e) => events.push(e.type));
    obs.start();

    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');

    expect(events).toContain('videochange');
    expect(obs.getCurrentVideoId()).toBe('BBBBBBBBBBB');
    obs.dispose();
  });

  it('videochange 事件携带 fromVideoId', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    let fromId: string | undefined;
    obs.subscribe((e) => {
      if (e.type === 'videochange') fromId = e.fromVideoId;
    });
    obs.start();

    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');

    expect(fromId).toBe('AAAAAAAAAAA');
    obs.dispose();
  });

  it('切到非 /watch 触发 leave-watch', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    const events: string[] = [];
    obs.subscribe((e) => events.push(e.type));
    obs.start();

    navigate('https://www.youtube.com/');

    expect(events).toContain('leave-watch');
    expect(obs.getCurrentVideoId()).toBeNull();
    obs.dispose();
  });

  it('连续切 5 个视频,每次都触发 videochange(无重复 UI)', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    const changedIds: string[] = [];
    obs.subscribe((e) => {
      if (e.type === 'videochange') changedIds.push(e.videoId);
    });
    obs.start();

    const ids = ['BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD', 'EEEEEEEEEEE', 'FFFFFFFFFFF'];
    for (const id of ids) {
      navigate(`https://www.youtube.com/watch?v=${id}`);
    }

    expect(changedIds).toEqual(ids);
    obs.dispose();
  });

  it('URL 未变时不触发事件', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    let count = 0;
    obs.subscribe(() => count++);
    obs.start();

    // 不改 URL,直接抛事件
    window.dispatchEvent(new Event('yt-navigate-finish'));
    expect(count).toBe(0);
    obs.dispose();
  });

  it('dispose 后不再触发监听', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    let count = 0;
    obs.subscribe(() => count++);
    obs.start();
    obs.dispose();

    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    expect(count).toBe(0);
  });

  it('subscribe 返回取消函数', () => {
    history.replaceState(null, '', 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    const obs = new NavigationObserver();
    let count = 0;
    const unsub = obs.subscribe(() => count++);
    obs.start();

    navigate('https://www.youtube.com/watch?v=BBBBBBBBBBB');
    unsub();
    navigate('https://www.youtube.com/watch?v=CCCCCCCCCCC');

    expect(count).toBe(1);
    obs.dispose();
  });
});
