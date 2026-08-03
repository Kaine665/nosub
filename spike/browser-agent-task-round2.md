# nosub 浏览器探针:第二轮(补缺口)

> 第一轮已经证明 `get_transcript` 端点能拿到完整 ASR cue(1127 条,毫秒精度)。
> 但有三个缺口必须补上,才能让我确定实现架构。这一轮只做这三件事。

---

## 0. 上下文(你没看过第一轮也能做)

我在做 Chrome 扩展 **nosub**,YouTube 英语精听。用户按 `A` 键让当前字幕句(cue)从头循环,按 `D` 前进。

上一轮探针证实了:
- YouTube 自己发的 `POST https://www.youtube.com/youtubei/v1/get_transcript` 请求能成功返回完整 cue
- 真实响应结构是:`actions[].updateEngagementPanelAction.content.transcriptRenderer.content.transcriptSearchPanelRenderer.body.transcriptSegmentListRenderer.initialSegments[].transcriptSegmentRenderer`(含 `startMs`/`endMs`/`snippet.runs[].text`)
- 但**请求体被 YouTube 用 gzip 压缩了**,上一轮用 `Request.clone().text()` 解码失败

这一轮要补三个缺口。

---

## 1. 缺口一(最高优先级):解压真实请求体,验证可复现性

这是**整个架构决策的依据**,必须先做。

### 1.1 装"能解 gzip"的拦截器

在 `https://www.youtube.com/watch?v=LZArpRwziE8` 的 Console 里:

```javascript
(() => {
  const origFetch = window.fetch;
  window._bodies = [];
  window.fetch = async function (input, init) {
    const req = typeof input === 'Request' ? input : new Request(input, init);
    const url = req.url;
    const resp = await origFetch.call(this, req);

    if (url.includes('get_transcript')) {
      try {
        // 关键: 用 arrayBuffer 而不是 text, 拿原始字节
        const buf = await req.clone().arrayBuffer();
        let bodyText = null;

        // 试 1: 直接当文本解 (很多时候 body 就是 JSON 字符串, 没压)
        try {
          bodyText = new TextDecoder().decode(buf);
          JSON.parse(bodyText);  // 验证是不是合法 JSON
        } catch (e) {
          // 试 2: 当 gzip 解压
          try {
            const ds = new DecompressionStream('gzip');
            const stream = new Blob([buf]).stream().pipeThrough(ds);
            const decompressed = await new Response(stream).text();
            JSON.parse(decompressed);  // 验证
            bodyText = decompressed;
          } catch (e2) {
            bodyText = `<解压失败: ${e2.message}, 原始字节长度=${buf.byteLength}>`;
          }
        }

        window._bodies.push({
          url,
          method: req.method,
          // 把所有请求头记下来 (注意: SAPISIDHASH/authorization 这些敏感值你要脱敏再带出)
          headers: Object.fromEntries([...req.headers.entries()].map(([k,v]) =>
            (/auth|sapisid|cookie|visitor/i.test(k) ? [k, '<REDACTED>'] : [k, v]))),
          body: bodyText,
          respStatus: resp.status,
        });
        console.log('🎯 get_transcript body 已捕获, 长度=' + (bodyText?.length || 0));
        console.log('body 前 300 字符:', bodyText?.slice(0, 300));
      } catch (e) {
        console.log('拦截异常:', e.message);
      }
    }
    return resp;
  };
  console.log('gzip-aware 拦截器已装, 去点 "显示文字版"');
})();
```

然后**在页面上点"显示文字版/Show transcript"按钮**。回到 Console 检查:

```javascript
console.log(window._bodies[0]?.body);
```

### 1.2 带回来

- **完整的 body JSON**(脱敏后)——告诉我 `context.client` 里有哪些字段、`params` 长什么样
- 如果两种解压都失败,告诉我 `buf.byteLength` 和失败原因

### 1.3 可复现性测试(决定架构!)

拿到 body 后,**用完全相同的 body 重放一次**:

```javascript
const b = window._bodies[0];
const replay = await fetch(b.url, {
  method: 'POST',
  // 用最小 headers, 不带 SAPISIDHASH, 看 YouTube 接不接
  headers: { 'content-type': 'application/json' },
  body: b.body,
});
console.log('重放 status:', replay.status);
console.log('重放 bodyLen:', (await replay.text()).length);
```

**关键判断**:重放成功(`200` 且有内容) → body 可复刻,扩展可以自己构造请求;重放失败 → params/session 有时效性,要走拦截路线。

把 status 和 bodyLen 带回来。

---

## 2. 缺口二:循环漂移 + 用户 seek 区分(目标 B)

上一轮完全没做,但这是 design 15 节列的核心风险。我已验证 rAF 停顿精度 8.5ms,但 **循环(到终点 seek 回起点)** 有新风险。

### 2.1 循环 10 次漂移测试

在视频页 Console(从真实 cue 取时间,不要瞎编):

```javascript
(() => {
  const video = document.querySelector('video');
  // 用第 2 条真实 cue 的时间 (LZArpRwziE8 的数据)
  const START = 6.879;   // 第2条 cue 起点
  const END   = 13.120; // 第2条 cue 终点
  const LOOPS = 10;
  let count = 0;
  const log = [];

  video.currentTime = START;
  video.play();

  const tick = () => {
    if (video.currentTime >= END) {
      const overshoot = (video.currentTime - END) * 1000;
      log.push({
        loop: count,
        overshootMs: +overshoot.toFixed(1),
        atMs: +performance.now().toFixed(0),
      });
      count++;
      if (count >= LOOPS) {
        video.pause();
        console.log('=== 10 轮循环结果 ===');
        console.table(log);
        const intervals = log.slice(1).map((r, i) => r.atMs - log[i].atMs);
        console.log('循环间隔(ms):', intervals);
        console.log('平均超调(ms):', log.reduce((s, r) => s + r.overshootMs, 0) / log.length);
        console.log('间隔方差(越小越稳):',
          intervals.reduce((s, v) => s + (v - intervals[0]) ** 2, 0) / intervals.length);
        return;
      }
      video.currentTime = START;  // seek 回起点
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
```

带回来:**log 表、平均超调、间隔方差**。我要看 10 次循环的时间是否稳定。

### 2.2 用户 seek vs 插件 seek 的区分(关键!)

nosub 要求:循环中用户主动拖进度条到 cue 外 → 退出循环。但**插件自己 seek 回起点也是 seek**,怎么区分?

**先观察**,不要猜。在循环跑起来时,装这个监听器,然后你**手动拖动视频进度条**到 cue 外位置:

```javascript
(() => {
  const video = document.querySelector('video');
  const events = [];
  const t0 = performance.now();
  ['seeking', 'seeked', 'play', 'pause', 'ratechange'].forEach(type => {
    video.addEventListener(type, e => {
      events.push({
        type,
        t: +(performance.now() - t0).toFixed(0),
        currentTime: +video.currentTime.toFixed(3),
        paused: video.paused,
      });
    });
  });
  window._seekEvents = events;
  console.log('监听已装. 现在拖动进度条到 cue 外, 然后回来执行 window._seekEvents');
})();
```

循环跑几轮后,你**手动拖进度条**。然后回来 `console.log(window._seekEvents)`。

带回来:**事件序列**。我需要找出"插件自己 seek"和"用户拖动"在事件序列上的可区分模式——比如时间间隔、伴随事件、`paused` 状态变化。

如果你观察到明显模式(比如用户拖动前后总有 `pause` 事件,而插件 seek 没有),直接告诉我。

---

## 3. 缺口三:多视频类型(只补两类)

上一轮只测了 ASR。再补两类就够:

### 3.1 人工英文字幕视频

找一个**有人工英文字幕**的视频(典型:TED 演讲、官方纪录片)。装拦截器、点 transcript、确认能拿到 cue。

带回来:
- track 列表里人工字幕的 `kind` 字段值(ASR 是 `asr`,人工应该是空或别的值)
- 人工字幕的 cue 时间精度和 ASR 有没有差异(比如人工字幕更整齐?)
- 响应结构是不是同一个 `transcriptRenderer` 路径

### 3.2 无字幕视频

找一个**完全没有英文字幕**的视频(随便搜个非英语 vlog,看字幕菜单里没有 English)。

带回来:
- `window.ytInitialPlayerResponse.captions` 还存在吗?`captionTracks` 是空数组还是整个属性没了?
- 这个状态下 `engagementPanels` 里还有没有 `getTranscriptEndpoint`?(我猜没有,但要确认)
- 这种情况扩展该怎么检测?给我一个可靠的判别条件

---

## 4. 交付物(精简清单)

1. **解压后的真实 body JSON**(缺口 1.2)+ **重放结果 status/bodyLen**(缺口 1.3)——最关键
2. **10 轮循环漂移数据**(缺口 2.1)
3. **用户 seek 事件序列 + 你观察到的区分模式**(缺口 2.2)
4. **人工字幕的 cue 样例 + kind 字段值**(缺口 3.1)
5. **无字幕视频的判别条件**(缺口 3.2)
6. **一句话结论**:请求体能不能复刻(决定架构走"自己构造"还是"拦截")

---

## 5. 重要提醒

- **缺口 1 是决定性的**。如果它太费时,先做完 1.3 的重放测试就回来——重放成功/失败这个二元结果,比完整 body 还重要。
- 控制台里 `dioco.io` / Liman 报错不是我们的,无视。
- 别改 YouTube 持久状态(字幕偏好、登录态)。
- 失败如实记,别编。
