/**
 * 探针 v2: 尝试多种方式绕过 POT 获取 timedtext
 *
 * 策略:
 *   A. 干净 URL (只留 v + lang + kind + fmt)
 *   B. 完整 baseUrl (带签名)
 *   C. 带 potc 参数 (模拟有 POT)
 *   D. get_transcript (当前 nosub 方案, 对比基准)
 */

(async () => {
  const videoId = new URLSearchParams(location.search).get('v');
  const pr = window.ytInitialPlayerResponse;
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) { console.error('❌ 无字幕'); return; }

  const en = tracks.find(t => t.languageCode === 'en') ?? tracks[0];
  console.log(`📋 轨道: ${en.languageCode} ${en.kind ?? 'manual'}`);

  // --- A: 干净 URL (无签名, 无 exp) ---
  console.log('\n=== A: 干净 URL ===');
  const cleanUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${en.languageCode}&fmt=json3${en.kind ? `&kind=${en.kind}` : ''}`;
  await tryFetch(cleanUrl, 'A');

  // --- B: 原始 baseUrl (完整签名) ---
  console.log('\n=== B: 原始 baseUrl ===');
  await tryFetch(en.baseUrl + '&fmt=json3', 'B');

  // --- C: baseUrl 去掉 exp=xpe ---
  console.log('\n=== C: baseUrl 去掉 exp ===');
  const noExp = en.baseUrl.replace(/&exp=[^&]*/g, '').replace(/&xoaf=[^&]*/g, '').replace(/&xowf=[^&]*/g, '');
  await tryFetch(noExp + '&fmt=json3', 'C');

  // --- D: baseUrl 去 exp + 带 potc=1 (空 pot) ---
  console.log('\n=== D: 去 exp + potc ---');
  await tryFetch(noExp + '&fmt=json3&potc=1&pot=', 'D');

  // --- E: 换 ANDROID 客户端重新拿 baseUrl ---
  console.log('\n=== E: InnerTube player 请求 (ANDROID client) ===');
  try {
    const ctx = window.yt?.config_?.INNERTUBE_CONTEXT;
    const key = window.yt?.config_?.INNERTUBE_API_KEY;
    if (ctx && key) {
      const resp = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
      });
      const data = await resp.json();
      const androidTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (androidTracks?.length) {
        console.log(`  ANDROID 客户端拿到 ${androidTracks.length} 条轨道`);
        const androidEn = androidTracks.find(t => t.languageCode === 'en') ?? androidTracks[0];
        const androidUrl = androidEn.baseUrl + '&fmt=json3';
        await tryFetch(androidUrl, 'E');
      } else {
        console.log('  ❌ ANDROID 客户端无 captionTracks');
      }
    }
  } catch (e) {
    console.log('  ❌ InnerTube player 请求失败:', e.message);
  }

  async function tryFetch(url, label) {
    try {
      const t0 = performance.now();
      const resp = await fetch(url, { credentials: 'include' });
      const elapsed = Math.round(performance.now() - t0);
      const text = await resp.text();

      if (resp.status !== 200) {
        console.log(`  ${label}: ❌ HTTP ${resp.status} (${elapsed}ms) body=${text.length}`);
        return;
      }
      if (text.length === 0) {
        console.log(`  ${label}: ❌ HTTP 200 但 body 空 (POT 拦截) (${elapsed}ms)`);
        return;
      }

      const data = JSON.parse(text);
      const cues = (data.events ?? []).filter(e => e.segs?.some(s => s.utf8?.trim()));
      console.log(`  ${label}: ✅ HTTP 200 (${elapsed}ms) ${cues.length} 条 cue`);

      if (cues.length > 0) {
        const c = cues[0];
        const t = c.segs.map(s => s.utf8 ?? '').join('').trim();
        console.log(`    首条: [${c.tStartMs}ms] ${t.slice(0, 60)}`);
      }
    } catch (e) {
      console.log(`  ${label}: ❌ ${e.message}`);
    }
  }
})();
