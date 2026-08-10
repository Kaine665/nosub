/**
 * 探针 v4: IOS 客户端能拿到哪些字幕？
 */

(async () => {
  const videoId = new URLSearchParams(location.search).get('v');
  const key = window.yt?.config_?.INNERTUBE_API_KEY;

  const resp = await fetch(`/youtubei/v1/player?key=${key}&prettyPrint=false`, {
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
  const data = await resp.json();
  const renderer = data?.captions?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks ?? [];

  console.log(`✅ IOS 客户端拿到 ${tracks.length} 条字幕轨道:\n`);
  tracks.forEach((t, i) => {
    const lang = t.languageCode;
    const kind = t.kind ?? 'manual';
    const name = t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? '';
    const translatable = t.isTranslatable !== false;
    console.log(`  [${i}] ${lang} | ${kind} | ${name} | 可翻译: ${translatable}`);
  });

  // 翻译目标语言列表
  const trans = renderer?.translationLanguages ?? [];
  console.log(`\n🌍 可翻译为 ${trans.length} 种语言:`);
  console.log(trans.map(l => `${l.languageCode}(${l.languageName?.simpleText ?? l.languageName?.runs?.[0]?.text ?? ''})`).join(', '));

  // 验证：拿英文轨道 + 翻译成中文
  const en = tracks.find(t => t.languageCode === 'en');
  if (en) {
    console.log('\n=== 验证: 英文原文字幕 ===');
    const r1 = await fetch(en.baseUrl + '&fmt=json3', { credentials: 'include' });
    const t1 = await r1.text();
    const cues1 = JSON.parse(t1).events?.filter(e => e.segs?.some(s => s.utf8?.trim())) ?? [];
    console.log(`  ✅ ${cues1.length} 条 cue`);

    // 翻译成中文
    const zhUrl = en.baseUrl + '&fmt=json3&tlang=zh-Hans';
    console.log('\n=== 验证: 英文→中文翻译 ===');
    const r2 = await fetch(zhUrl, { credentials: 'include' });
    const t2 = await r2.text();
    if (t2.startsWith('{')) {
      const cues2 = JSON.parse(t2).events?.filter(e => e.segs?.some(s => s.utf8?.trim())) ?? [];
      console.log(`  ✅ ${cues2.length} 条 cue`);
      if (cues2[0]) {
        const text = cues2[0].segs.map(s => s.utf8 ?? '').join('').trim();
        console.log(`  首条: "${text.slice(0, 60)}"`);
      }
    } else {
      console.log(`  ❌ ${t2.slice(0, 100)}`);
    }

    // 翻译成日语
    const jaUrl = en.baseUrl + '&fmt=json3&tlang=ja';
    console.log('\n=== 验证: 英文→日语翻译 ===');
    const r3 = await fetch(jaUrl, { credentials: 'include' });
    const t3 = await r3.text();
    if (t3.startsWith('{')) {
      const cues3 = JSON.parse(t3).events?.filter(e => e.segs?.some(s => s.utf8?.trim())) ?? [];
      console.log(`  ✅ ${cues3.length} 条 cue`);
      if (cues3[0]) {
        const text = cues3[0].segs.map(s => s.utf8 ?? '').join('').trim();
        console.log(`  首条: "${text.slice(0, 60)}"`);
      }
    } else {
      console.log(`  ❌ ${t3.slice(0, 100)}`);
    }
  }

  // 跟 WEB 客户端对比
  console.log('\n=== 对比: WEB 客户端轨道 ===');
  const webTracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  console.log(`  WEB: ${webTracks.length} 条 | IOS: ${tracks.length} 条`);
  const webLangs = new Set(webTracks.map(t => t.languageCode));
  const iosLangs = new Set(tracks.map(t => t.languageCode));
  const onlyIos = [...iosLangs].filter(l => !webLangs.has(l));
  const onlyWeb = [...webLangs].filter(l => !iosLangs.has(l));
  if (onlyIos.length) console.log(`  IOS 多出: ${onlyIos.join(', ')}`);
  if (onlyWeb.length) console.log(`  WEB 多出: ${onlyWeb.join(', ')}`);
  if (!onlyIos.length && !onlyWeb.length) console.log('  轨道完全一致');
})();
