import { SettingsRepository } from '../storage/settings-repository.js';
import type { UserSettings } from '../shared/types.js';
import { resolveLocale } from '../shared/i18n.js';

const copy = {
  en: {title:'Make every sentence count.',subtitle:'Shape your focused-listening experience for YouTube.',saved:'Saved',saving:'Saving…',extension:'NoSub on YouTube',extensionHelp:'Show the focused-listening controls on supported YouTube videos.',language:'Language',interfaceLanguage:'Interface language',auto:'Auto (browser)',captionLanguage:'Preferred caption language',englishAny:'English (any)',translationLanguage:'Translate captions to',off:'Off',session:'Listening session',startingView:'Starting subtitle view',hidden:'Hidden — listen first',original:'Original captions',translated:'Original + translation',shortcuts:'Keyboard flow',shortcutHelp:'A repeat · S captions · D next · E speed',privacy:'Privacy & online services',privacyText:'Settings and learning state stay in Chrome local storage. Definitions, translations, pronunciation audio, and example sentences are requested only when you use those features. No browsing history is sold or used for advertising.',services:'Connected services',onDemand:'On demand',reloadHint:'Changes apply to newly opened or reloaded YouTube pages.'},
  zh_CN: {title:'认真听懂每一句。',subtitle:'配置你的 YouTube 精听体验。',saved:'已保存',saving:'保存中…',extension:'在 YouTube 上启用 NoSub',extensionHelp:'在支持的 YouTube 视频中显示精听控制栏。',language:'语言',interfaceLanguage:'界面语言',auto:'自动（跟随浏览器）',captionLanguage:'首选字幕语言',englishAny:'英语（不限地区）',translationLanguage:'字幕翻译为',off:'关闭',session:'精听会话',startingView:'字幕初始状态',hidden:'隐藏——先听再看',original:'原文字幕',translated:'原文 + 翻译',shortcuts:'键盘操作',shortcutHelp:'A 重听 · S 字幕 · D 下一句 · E 倍速',privacy:'隐私和在线服务',privacyText:'设置和学习状态保存在 Chrome 本地。只有使用相应功能时，才会请求释义、翻译、发音和例句。我们不会出售浏览记录，也不会将其用于广告。',services:'连接的服务',onDemand:'按需请求',reloadHint:'更改会应用到新打开或重新加载的 YouTube 页面。'},
} as const;

const repo = new SettingsRepository();
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = byId<HTMLInputElement>('enabled');
const interfaceLanguage = byId<HTMLSelectElement>('interfaceLanguage');
const targetLanguage = byId<HTMLSelectElement>('targetLanguage');
const translationLanguage = byId<HTMLSelectElement>('translationLanguage');
const startingView = byId<HTMLSelectElement>('startingView');
const saveState = byId<HTMLElement>('save-state');
let settings: UserSettings;
let saveTimer: number | undefined;

function paintLanguage(): void {
  const locale = resolveLocale(interfaceLanguage.value as UserSettings['interfaceLanguage']);
  document.documentElement.lang = locale === 'zh_CN' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach((node) => {
    const key = node.dataset.copy as keyof typeof copy.en;
    node.textContent = copy[locale][key];
  });
}

function collect(): UserSettings {
  const view = startingView.value;
  return {...settings,enabled:enabled.checked,interfaceLanguage:interfaceLanguage.value as UserSettings['interfaceLanguage'],targetLanguage:targetLanguage.value,translationLanguage:translationLanguage.value,showTargetCaption:view !== 'hidden',showTranslatedCaption:view === 'translated' && translationLanguage.value !== 'off'};
}

function queueSave(): void {
  paintLanguage();
  const locale = resolveLocale(interfaceLanguage.value as UserSettings['interfaceLanguage']);
  saveState.textContent = copy[locale].saving; saveState.classList.add('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => { settings = collect(); await repo.save(settings); saveState.textContent = copy[locale].saved; saveState.classList.remove('saving'); }, 220);
}

async function init(): Promise<void> {
  settings = await repo.load();
  enabled.checked = settings.enabled;
  interfaceLanguage.value = settings.interfaceLanguage;
  targetLanguage.value = settings.targetLanguage ?? 'en';
  translationLanguage.value = settings.translationLanguage ?? 'off';
  startingView.value = settings.showTranslatedCaption ? 'translated' : settings.showTargetCaption ? 'original' : 'hidden';
  paintLanguage();
  document.querySelectorAll('input,select').forEach((control) => control.addEventListener('change', queueSave));
}

void init();
