/**
 * 探针 v3: 深挖 ANDROID 客户端返回的 baseUrl
 */

(async () => {
  const videoId = new URLSearchParams(location.search).get('v');
  const key = window.yt?.config_?.INNERTUBE_API_KEY;

  console.log('=== InnerTube player (ANDROID) ===');
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
          hl: 'en', gl: 'US',
        },
      },
      videoId,
    }),
  });
  const data = await resp.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks) { console.log('❌ 无 tracks'); return; }

  const en = tracks.find(t => t.languageCode === 'en') ?? tracks[0];
  console.log('baseUrl 原始:', en.baseUrl.slice(0, 200));
  console.log('kind:', en.kind);

  // 尝试各种 fmt
  for (const [label, url] of [
    ['json3', en.baseUrl + '&fmt=json3'],
    ['vtt', en.baseUrl + '&fmt=vtt'],
    ['srv1', en.baseUrl + '&fmt=srv1'],
    ['无fmt', en.baseUrl],
  ]) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      const text = await r.text();
      const isJson = text.startsWith('{');
      const isXml = text.startsWith('<?xml') || text.startsWith('<');
      const cueCount = isJson ? (JSON.parse(text).events ?? []).filter(e => e.segs?.some(s => s.utf8?.trim())).length : 0;
      console.log(`  ${label}: HTTP ${r.status} | ${text.length} bytes | ${isJson ? `✅ JSON ${cueCount} cues` : isXml ? 'XML' : text.slice(0, 50)}`);
    } catch (e) {
      console.log(`  ${label}: ❌ ${e.message}`);
    }
  }

  // 也试 IOS 客户端
  console.log('\n=== InnerTube player (IOS) ===');
  const resp2 = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '20.10.38',
          deviceMake: 'Apple',
          deviceModel: 'iPhone16,2',
          hl: 'en', gl: 'US',
        },
      },
      videoId,
    }),
  });
  const data2 = await resp2.json();
  const tracks2 = data2?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (tracks2?.length) {
    const en2 = tracks2.find(t => t.languageCode === 'en') ?? tracks2[0];
    console.log('IOS baseUrl:', en2.baseUrl.slice(0, 200));
    const r2 = await fetch(en2.baseUrl + '&fmt=json3', { credentials: 'include' });
    const t2 = await r2.text();
    const isJson2 = t2.startsWith('{');
    const cueCount2 = isJson2 ? (JSON.parse(t2).events ?? []).filter(e => e.segs?.some(s => s.utf8?.trim())).length : 0;
    console.log(`  IOS json3: HTTP ${r2.status} | ${t2.length} bytes | ${isJson2 ? `✅ JSON ${cueCount2} cues` : t2.startsWith('<') ? 'XML' : t2.slice(0, 50)}`);
  } else {
    console.log('❌ IOS 无 tracks');
  }

  // 试 TVHTML5 (通常不需要 POT)
  console.log('\n=== InnerTube player (TVHTML5) ===');
  const resp3 = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'TVHTML5',
          clientVersion: '7.20241201.18.00',
          hl: 'en', gl: 'US',
        },
      },
      videoId,
    }),
  });
  const data3 = await resp3.json();
  const tracks3 = data3?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (tracks3?.length) {
    const en3 = tracks3.find(t => t.languageCode === 'en') ?? tracks3[0];
    console.log('TVHTML5 baseUrl:', en3.baseUrl.slice(0, 200));
    const r3 = await fetch(en3.baseUrl + '&fmt=json3', { credentials: 'include' });
    const t3 = await r3.text();
    const isJson3 = t3.startsWith('{');
    const cueCount3 = isJson3 ? (JSON.parse(t3).events ?? []).filter(e => e.segs?.some(s => s.utf8?.trim())).length : 0;
    console.log(`  TVHTML5 json3: HTTP ${r3.status} | ${t3.length} bytes | ${isJson3 ? `✅ JSON ${cueCount3} cues` : t3.startsWith('<') ? 'XML' : t3.slice(0, 50)}`);
  } else {
    console.log('❌ TVHTML5 无 tracks');
  }
})();
