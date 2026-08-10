/**
 * 中文释义质量关卡。
 * 规则：只要简体普通话短义项；繁体/粤语/西语/英文长句一律丢弃。
 */

/** 常见繁体→简体（用于检测残留繁体 & 轻量转换） */
const T2S: Record<string, string> = {
  開:'开',關:'关',雖:'虽',體:'体',爲:'为',為:'为',時:'时',會:'会',過:'过',來:'来',
  對:'对',動:'动',學:'学',書:'书',見:'见',說:'说',話:'话',語:'语',國:'国',後:'后',
  當:'当',發:'发',個:'个',種:'种',經:'经',點:'点',這:'这',還:'还',無:'无',與:'与',
  則:'则',際:'际',難:'难',題:'题',兒:'儿',兩:'两',麼:'么',氣:'气',線:'线',總:'总',
  專:'专',導:'导',轉:'转',車:'车',運:'运',萬:'万',東:'东',
  邊:'边',達:'达',選:'选',遠:'远',連:'连',愛:'爱',變:'变',單:'单',義:'义',樂:'乐',
  機:'机',沒:'没',聽:'听',員:'员',戰:'战',據:'据',業:'业',價:'价',務:'务',區:'区',
  協:'协',參:'参',實:'实',應:'应',樣:'样',從:'从',給:'给',結:'结',網:'网',裡:'里',
  處:'处',號:'号',長:'长',門:'门',間:'间',頭:'头',風:'风',飛:'飞',電:'电',魚:'鱼',
  鳥:'鸟',馬:'马',畫:'画',讀:'读',寫:'写',論:'论',於:'于',並:'并',稱:'称',類:'类',
  該:'该',須:'须',顯:'显',觀:'观',預:'预',頁:'页',項:'项',頻:'频',顏:'颜',願:'愿',
  裏:'里',餘:'余',併:'并',
};

const CANTONESE = /[啲嘢咗嘅冇係唔哋佢攞嚟嗰噉咁乜咩睇𠶧咗]/;
/** 西语等拉丁字母长串 / 非中日韩标点噪声 */
const LATIN_WORD = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñÄÖÜäöüß]{3,}/;
const HAN = /[\u4e00-\u9fff]/;

export function toSimplified(text: string): string {
  return [...text].map((c) => T2S[c] ?? c).join('');
}

/** 「繁 /简」取简体侧 */
export function preferSimplifiedSide(text: string): string {
  const parts = text.split(/\s*\/\s*/);
  if (parts.length >= 2) {
    const right = parts[parts.length - 1].trim();
    if (right) return toSimplified(right);
  }
  return toSimplified(text);
}

export function stripNoise(text: string): string {
  // 短括号（不）/（没有）一类是义项组成部分，整条作废而不是硬删
  if (/[（(][^）)]{0,4}[）)]/.test(text)) {
    return '';
  }
  return text
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/【[^】]*】/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 单条短义项是否合格（简体、普通话、短）。
 * 逗号同义允许：某事,某物
 */
export function isCleanZhAtom(raw: string): boolean {
  const s = stripNoise(preferSimplifiedSide(raw));
  if (!s) return false;
  if (s.length > 10) return false;
  if (!HAN.test(s)) return false;
  if (CANTONESE.test(s)) return false;
  if (LATIN_WORD.test(s)) return false;
  if ([...s].some((c) => c in T2S)) return false; // 仍残留已知繁体
  if (/[。！？?…]/.test(s)) return false;
  if (/^(想来|表示|用于|指|形容|说明)/.test(s)) return false;
  // 至少一半是汉字
  const hans = [...s].filter((c) => HAN.test(c)).length;
  if (hans < Math.ceil(s.length * 0.5)) return false;
  return true;
}

export function splitAtoms(text: string): string[] {
  const cleaned = stripNoise(preferSimplifiedSide(text));
  // 先按中文分号/顿号级分隔成义项；逗号保留在原子内作同义
  return cleaned
    .split(/[;；]/)
    .flatMap((chunk) => chunk.split(/[、]/))
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/，/g, ','))
    .filter(isCleanZhAtom);
}

export interface ZhGlossLine {
  pos: string; // adv / conj / n ...
  text: string; // 虽然;尽管 或 某事,某物
}

const POS_CANON: Record<string, string> = {
  n: 'n', noun: 'n', 'n.': 'n', '名': 'n', '名词': 'n',
  v: 'v', verb: 'v', 'v.': 'v', '动': 'v', '动词': 'v',
  adj: 'adj', adjective: 'adj', 'adj.': 'adj', '形': 'adj', '形容词': 'adj',
  adv: 'adv', adverb: 'adv', 'adv.': 'adv', '副': 'adv', '副词': 'adv',
  prep: 'prep', preposition: 'prep', 'prep.': 'prep', '介': 'prep', '介词': 'prep',
  conj: 'conj', conjunction: 'conj', 'conj.': 'conj', '连': 'conj', '连词': 'conj',
  pron: 'pron', pronoun: 'pron', 'pron.': 'pron', '代': 'pron', '代词': 'pron',
  det: 'det', determiner: 'det', 'det.': 'det', '限定词': 'det',
  int: 'int', interjection: 'int', 'int.': 'int', '感': 'int',
  num: 'num', numeral: 'num', '数': 'num',
  art: 'art', article: 'art',
};

export function canonPos(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '');
  return POS_CANON[key] ?? POS_CANON[key.replace(/\.$/, '')] ?? null;
}

/** 把多源原始条目收成合格 SenseLine；不合格直接丢 */
export function buildCleanZhLines(
  items: Array<{ pos: string; definition: string }>,
  maxPerPos = 5,
  maxLines = 4,
): ZhGlossLine[] {
  const buckets = new Map<string, string[]>();

  for (const item of items) {
    const pos = canonPos(item.pos) ?? 'x';
    // 无词性时仍允许，标为 x，最后若只有 x 可显示
    const atoms = splitAtoms(item.definition);
    if (!atoms.length) continue;
    const key = pos === 'x' ? 'x' : pos;
    const list = buckets.get(key) ?? [];
    for (const atom of atoms) {
      if (list.includes(atom)) continue;
      // 近义包含去重
      if (list.some((x) => x.includes(atom) || atom.includes(x))) continue;
      list.push(atom);
    }
    buckets.set(key, list);
  }

  const order = ['prep', 'adv', 'adj', 'v', 'n', 'pron', 'det', 'conj', 'int', 'num', 'art', 'x'];
  const lines: ZhGlossLine[] = [];
  const hasTagged = order.some((p) => p !== 'x' && (buckets.get(p)?.length ?? 0) > 0);

  for (const pos of order) {
    if (pos === 'x' && hasTagged) continue; // 有正规词性时丢掉无词性噪声行
    const senses = buckets.get(pos);
    if (!senses?.length) continue;
    const text = senses.slice(0, maxPerPos).join(';');
    if (!text) continue;
    // 最终行再验一次
    if (!text.split(';').every(isCleanZhAtom)) continue;
    lines.push({ pos: pos === 'x' ? '' : pos, text });
    if (lines.length >= maxLines) break;
  }
  return lines;
}
