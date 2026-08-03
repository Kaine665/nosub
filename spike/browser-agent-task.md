# 浏览器探针任务:nosub 字幕与播放器

> **这份文档给你——一个能真实操作浏览器的 AI。**
> 你有真实浏览器、真实登录态、能点击 YouTube 按钮、能拦截网络请求。我没有这些。
> 跑完这个,把你抓到的真实数据和结论带回来,我再用它们做剩下不需要浏览器的工作。

---

## 0. 这个产品是做什么的(30 秒上下文)

我在做一个 Chrome 扩展叫 **nosub**,用于 YouTube 英语精听。核心机制:

- 用户正常看 YouTube 视频,**视频照常连续播放,插件不自动停顿**
- 用户某句没听懂 → 按 `A` 键 → **当前这一条字幕(cue)从头开始无限循环**
- 循环中再按 `A` → 后退一条字幕继续循环
- 按 `D` → 前进一条并退出循环,恢复正常连续播放
- `S` 切换英文字幕显隐,`W` 切换翻译字幕显隐

技术上是 Chrome MV3 扩展,挂载在 YouTube 视频页,**只读字幕 + 控制播放器跳转/循环**。

---

## 1. 你的目标:把两件"只有真浏览器能验证"的事跑通

整个产品的最高风险就两件事,**你要替我证伪它们**:

### 目标 A:稳定拿到字幕 cue 的内容
拿到一个视频**每一条字幕的文本、开始时间、结束时间**(毫秒精度)。要能解释清楚:用的是哪条路径、需要什么前提、什么情况下会失败。

### 目标 B:验证 `A` 键循环的时序能成立
在真实 YouTube `<video>` 元素上,验证"到 cue 结束时间自动跳回 cue 起点"这套循环逻辑的**精度和副作用**。我担心的是:跳转有没有可感知的卡顿?循环 10 次会不会累积漂移?

---

## 2. 目标 A 的具体任务:字幕 cue 读取

### 背景(我已经踩过的坑,别重蹈)

我已经在自己的控制台验证里确认了以下事实,**你可以直接利用,不必从零开始**:

1. **字幕轨道列表(元数据)能稳定拿到**:
   - 从页面全局 `window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks` 直接读,0ms,有 `languageCode`/`kind`(asr=自动生成)/`baseUrl`
   - 兜底:POST `https://www.youtube.com/youtubei/v1/player`,用 `ANDROID` client,也能拿到 track 列表(签名 URL 免 token)

2. **`baseUrl` 的 `timedtext` 端点直接 fetch 会返回空体(HTTP 200/204, bodyLen=0)**:
   - 原因:YouTube 2024+ 要求 **PO Token (Proof-of-Origin)**,单靠 `signature`/`key=yt8` 不够
   - 这条路基本废了,**不要在 timedtext 上继续花时间**

3. **`youtubei/v1/get_transcript` 端点(YouTube Transcript 面板用的内部 API)**:
   - 需要一个 `params` token,从 `window.ytInitialData` 的 `engagementPanels` 里、字段名 `getTranscriptEndpoint.params` 处能找到(我抓到过一个,形如 `CgtMWkFycFJ3emlFOBISQ2dOaGMzSVNBbVZ1R2dB...`)
   - **但我手动 fetch 这个端点始终 400 `FAILED_PRECONDITION`**——即使用了页面完整 `INNERTUBE_CONTEXT`。说明我猜的请求体缺东西,或 YouTube 服务端有额外校验

### 你要做的(目标 A)

**关键思路转变:不要再猜请求体。直接拦截 YouTube 自己发的成功请求。**

YouTube 前端在用户点开"显示文字版 / Show transcript"面板时,会发一个能成功的 `get_transcript` 请求。你能拦截它,完整看清楚:URL、headers、body、response。这是唯一可靠的真相来源。

#### A1. 装 fetch 拦截器,点开 transcript 面板,抓真实请求

在 YouTube 视频页(推荐用这个我已经测过的视频:`https://www.youtube.com/watch?v=LZArpRwziE8`,带 ASR 英文字幕),打开 DevTools Console,先装一个拦截器,再去点"显示文字版"按钮:

```javascript
// 装 fetch 拦截器
(() => {
  const origFetch = window.fetch;
  window._captured = [];
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const resp = await origFetch.apply(this, arguments);
    if (url.includes('get_transcript')) {
      const clone = resp.clone();
      const text = await clone.text();
      window._captured.push({
        url,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,        // 这是 YouTube 真实发的请求体
        status: resp.status,
        respLen: text.length,
        respSample: text.slice(0, 500),
      });
      console.log('🎯 抓到 get_transcript:', window._captured.at(-1));
    }
    return resp;
  };
  console.log('拦截器已装, 现在去点 "显示文字版" 按钮');
})();
```

然后**在页面上(不是 Console)找到并点击"显示文字版/Show transcript"按钮**(通常在视频描述下方,或 ... 菜单里)。点开后回到 Console:

```javascript
console.log(JSON.stringify(window._captured, null, 2));
```

#### A2. 把以下信息带回来

- **完整的 `body`**(YouTube 发的请求体,含 `context` 和 `params`)——这是最关键的,告诉我它带了哪些我漏掉的字段
- **响应 status 和前 500 字符**——确认 YouTube 自己的请求确实成功了
- **`params` token 的完整值**(解码 URL 编码后的)

#### A3. 解析响应里的 cue

YouTube 的 `get_transcript` 成功响应里,cue 数据在:
```
actions[].reloadContinuationItemsCommand.continuationItems[]
  → 每项的 .transcriptSegmentRenderer
    → .startMillis / .endMillis / .snippet.runs[].text
```

把响应存成 JSON 文件,解析出**前 10 条 cue**(文本、startMs、endMs),带回来给我做 fixture。

#### A4. 验证可复现性

用你抓到的**完全相同的 body**,重新 fetch 一次同一个 URL,看是否还成功:
- 成功 → 说明 params 不是一次性的,扩展里可以"抓一次 body 模板,后续自己复刻"
- 返回空/失败 → 说明 params 或某个 cookie 有时效性,要换策略(比如每次都拦截真实请求)

#### A5. 多测几个视频(关键!不要只测一个)

只测一个视频等于没测。请在**同一套拦截器**下测以下至少 4 种情况,每种都记录:能不能拿到 track、能不能拿到 cue 内容、失败的具体表现。

| # | 视频类型 | 你需要确认的 |
|---|---|---|
| 1 | **人工英文字幕**(比如 TED 演讲) | 人工字幕的 cue 格式是否和 ASR 一致 |
| 2 | **只有自动生成字幕**(随便找个 vlog) | ASR 轨道能不能拿到内容 |
| 3 | **有翻译字幕**(比如带中文字幕的视频) | 翻译轨道怎么发现、cue 怎么拿 |
| 4 | **完全没有字幕的视频** | 应该怎么检测、怎么优雅提示 |

每个视频都回答:**track 列表从哪拿的?cue 内容从哪拿的?有没有遇到 400 或空体?**

---

## 3. 目标 B 的具体任务:循环时序验证

### 背景(我已经验证过的,可直接复用)

我已经在控制台验证了三种"到指定时间暂停"方案的精度:

| 方案 | 超调 |
|---|---|
| `setTimeout` 按时长定时 | 失败(起播缓冲期误触发,差 2 秒) |
| `timeupdate` 事件 | 125ms(略粗) |
| **`requestAnimationFrame` 轮询** | **8.5ms(完美)** |

所以"在 cue 结束时间暂停"用 rAF 是稳的。**但 nosub 要的不是暂停,是循环**——到 cue 结束时间不暂停,而是 **seek 回 cue 起点继续播**。这一步有新风险:seek 有没有可感知的卡顿?循环 10 次会不会漂移?

### 你要做的(目标 B)

#### B1. 在真实视频上跑循环 10 次,测漂移

在 LZArpRwziE8(或任意有字幕的视频),用真实字幕 cue 的时间跑循环。下面这个脚本会:选第 2 条 cue(避开片头),rAF 轮询到结束就 seek 回起点,循环 10 次,记录每次实际的起止时间:

```javascript
(() => {
  const video = document.querySelector('video');
  // 用一个典型短 cue 的时间做循环测试 (你可以改成真实 cue 时间)
  const START = 10.0;   // cue 起点秒
  const END   = 14.0;   // cue 终点秒
  const LOOPS = 10;
  let count = 0;
  const log = [];
  let loopStartPerf = null;

  video.currentTime = START;
  video.play();

  const tick = () => {
    if (video.currentTime >= END) {
      const overshootMs = (video.currentTime - END) * 1000;
      log.push({ loop: count, overshootMs: +overshootMs.toFixed(1), atRealTime: +performance.now().toFixed(0) });
      count++;
      if (count >= LOOPS) {
        console.log('循环 10 次结果:', log);
        console.log('平均超调 ms:', log.reduce((s, r) => s + r.overshootMs, 0) / log.length);
        console.log('循环间隔 ms:', log.slice(1).map((r, i) => r.atRealTime - log[i].atRealTime));
        video.pause();
        return;
      }
      // seek 回起点, 用 performance.now 量 seek 耗时
      const seekT0 = performance.now();
      video.currentTime = START;
      console.log(`seek 耗时: ${(performance.now() - seekT0).toFixed(1)}ms`);
      loopStartPerf = performance.now();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
```

带回来:
- **平均超调 ms**(每次越过 END 多少)——验证 rAF 精度
- **循环间隔 ms**(10 次循环每次总时长)——验证有无累积漂移(理想是恒定的 END-START)
- **seek 耗时**(`video.currentTime = START` 这一句本身快不快)
- **主观感受**:循环点听起来顺不顺、有没有明显断点或重复的字

#### B2. 验证"用户跳出 cue 时退出循环"的判定

nosub 要求:循环中如果用户主动拖动进度条跳到 cue 外,要退出循环。但**插件自己 seek 回起点也会触发 timeupdate/seeked 事件**,要区分。

请验证:在循环运行时,你**手动拖动视频进度条**到一个 cue 外的位置,然后观察——能否可靠区分"这是用户拖的"vs"这是插件自己 seek 回起点的"?

具体做法:监听 `seeked` 事件,记录每次触发时 `video.currentTime` 的值和触发来源。你看连续几轮插件 seek 和一次用户拖动,模式有什么不同(时间差?事件顺序?有没有 `pause` 事件伴随?)。把你观察到的可区分模式带回来。

---

## 4. 还有一件事:SPA 导航(重要但优先级次之)

nosub 要在 YouTube 内部切视频(不刷新页面)时正确重载字幕。请验证:

1. 打开视频 A,让拦截器抓到它的字幕
2. **不刷新页面**,从 YouTube 侧边栏/推荐区点进视频 B
3. 观察:`window.ytInitialPlayerResponse` 和 `window.ytInitialData` 有没有自动更新?更新时机是什么(立刻?还是要等某个事件)?有没有 `yt-navigate-finish` 这类自定义事件?
4. 视频 B 的字幕 track 列表能不能用同样的方式拿到

带回来:**切视频后,全局对象什么时刻刷新、要不要监听什么事件、多久能拿到新字幕**。

---

## 5. 交付物清单(你要带回来的)

请把以下东西整理后返回:

1. **`get_transcript` 真实请求体**(完整 body,目标 A2)——最重要
2. **真实 cue fixture**:1-2 个视频的前 10-20 条 cue(text/startMs/endMs 的 JSON)
3. **循环漂移数据**(目标 B1 的 log)
4. **用户 seek vs 插件 seek 的区分方法**(目标 B2 的观察)
5. **SPA 导航的刷新机制**(第 4 节)
6. **4 种视频类型的字幕可用性表格**(A5)
7. **一句话结论**:nosub 的字幕+循环方案成不成立,有没有阻塞级风险

---

## 6. 重要说明

- **你是在真实浏览器里操作,不是猜**。能点击就点击,能拦截就拦截,能看 Network 面板就看 Network 面板。我已经在控制台脚本上撞过墙(手动构造请求 400),你最大的优势是能等 YouTube 自己发请求并抓它。
- **不要改 YouTube 页面的任何持久状态**(别关人家的字幕偏好、别收藏、别登录/登出)。所有探针都是只读的。
- **如果某一步失败,如实记录失败现象**,不要跳过、不要编造数据。失败本身是我需要的信息。
- 控制台里可能有其它扩展的报错(比如 Liman/Dioco 这类语言学习扩展会刷 `dioco.io ERR_CONNECTION_CLOSED`)——**那些不是我们的**,无视。
