# 探针:CC 路径 vs Transcript 路径对比

> 目的:验证用户的直觉——其它软件通过 CC 开关拿字幕是否比我们的 transcript 按钮路径更可靠

---

## 背景

当前 nosub 实现:
- **触发方式**:点击「显示文字版」按钮 → YouTube 发 `get_transcript` 请求
- **拦截方式**:劫持 `window.fetch`，clone 响应

用户观察:有些软件在 CC(字幕)关闭时 transcript 全部消失，打开后又出现。怀疑那些工具走的是 CC 路径(播放器原生字幕加载)而非 transcript 路径。

## 核心问题

YouTube 播放器开启 CC 时，它自己发了什么请求来加载字幕数据？跟 transcript 面板的 `get_transcript` 是同一个端点吗？

---

## 探针脚本

在 YouTube 视频页(`https://www.youtube.com/watch?v=LZArpRwziE8`)的 Console 运行:

```javascript
// === CC vs Transcript 路径探针 ===

(() => {
  const log = [];
  const origFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const resp = await origFetch.apply(this, arguments);

    // 拦截所有与字幕/transcript 相关的请求
    const isSubtitle = /timedtext|get_transcript|player|captions|transcript/i.test(url);
    if (isSubtitle && resp.ok) {
      const clone = resp.clone();
      const text = await clone.text();
      const entry = {
        url: url.slice(0, 200),
        method: init?.method || 'GET',
        status: resp.status,
        bodyLen: text.length,
        bodySample: text.slice(0, 300),
        timestamp: Date.now(),
        // 判断请求类型
        isTranscript: url.includes('get_transcript'),
        isTimedtext: url.includes('timedtext'),
        isPlayer: url.includes('/player'),
      };
      log.push(entry);
      console.log(
        `🎯 [${entry.isTranscript ? 'TRANSCRIPT' : entry.isTimedtext ? 'TIMEDTEXT' : 'OTHER'}]`,
        entry.method, entry.url.slice(0, 120),
        '| bodyLen:', entry.bodyLen
      );
    }
    return resp;
  };

  window.__ccSpikeLog = log;
  window.__ccSpikeDone = () => {
    console.log('=== 探针结果 ===');
    console.table(log.map(e => ({
      类型: e.isTranscript ? 'get_transcript' : e.isTimedtext ? 'timedtext' : 'other',
      方法: e.method,
      URL片段: e.url.slice(0, 100),
      响应长度: e.bodyLen,
    })));
    console.log('完整日志: window.__ccSpikeLog');
  };

  console.log('✅ 拦截器已装。现在做以下操作，每步间隔 3 秒:');
  console.log('  1. 等 3 秒（捕获初始加载）');
  console.log('  2. 点击 CC 按钮开启字幕，等 3 秒');
  console.log('  3. 点击 CC 按钮关闭字幕，等 3 秒');
  console.log('  4. 点击「显示文字版」按钮，等 3 秒');
  console.log('  5. 执行 window.__ccSpikeDone() 看结果');
})();
```

---

## 操作步骤

1. 打开视频页，粘贴脚本运行
2. **等 3 秒**（捕获初始页面加载时的请求）
3. **点击 CC 按钮**（播放器右下角的字幕开关），**开启字幕**，等 3 秒
4. **点击 CC 按钮**，**关闭字幕**，等 3 秒
5. **点击「显示文字版」按钮**，等 3 秒
6. 运行 `window.__ccSpikeDone()`

---

## 带回的结论

1. **CC 开启后**，YouTube 发了什么请求？（url 包含什么？是不是 `timedtext`？还是也是 `get_transcript`？）
2. **Transcript 按钮**触发的请求和 CC 触发的请求，是同一个端点还是不同端点？
3. 如果不同：两种响应各自返回什么格式？哪个更好解析？
4. **一票否决**:CC 关着的时候，transcript 按钮还能触发 `get_transcript` 吗？还是必须 CC 开着才有？
