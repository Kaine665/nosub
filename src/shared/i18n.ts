import type { UserSettings } from './types.js';

export type AppLocale = 'en' | 'zh_CN';

const messages = {
  en: {
    loading: 'Loading…', noCaptions: 'No captions', error: 'Something went wrong',
    repeat: 'Repeat', previous: 'Previous', captions: 'Captions', next: 'Next', speed: 'Speed', repeating: 'Repeating', exit: 'Exit',
    translationUnavailable: 'Translation unavailable', translationLoading: 'Translating…',
    translationNotConfigured: 'Translation is off', context: 'Context', examples: 'EXAMPLES',
    lookingUp: 'Looking up…', noDefinition: 'No definition found',
    britishPronunciation: 'British pronunciation', americanPronunciation: 'American pronunciation',
    pronunciation: 'Pronunciation', playbackFailed: 'Playback failed',
    videoHasNoCaptions: 'This video has no usable captions', captionLoadFailed: 'Unable to load captions',
    translationIsPro: 'Translation is a Pro feature', upgrade: 'Upgrade',
    fullscreenBlocking: 'Please exit fullscreen then reload the page to load subtitles.',
    trackNotFound: 'Caption track not found',
    transcriptParamsMissing: 'Transcript params not found on page',
    transcriptFetchFailed: 'Transcript request failed',
    transcriptEmpty: 'Transcript response contained no cues',
    invalidEmail: 'Please enter a valid email address.',
    passwordTooShort: 'Password must be at least 6 characters.',
    suggestionGoogleFailed: 'Google Translate unavailable. Try ',
    configure: 'Configure',
    upgradeToPro: 'Upgrade to Pro',
  },
  zh_CN: {
    loading: '加载中…', noCaptions: '无字幕', error: '出错',
    repeat: '重听', previous: '上一句', captions: '字幕', next: '下一句', speed: '倍速', repeating: '循环中', exit: '退出循环',
    translationUnavailable: '暂无翻译', translationLoading: '翻译加载中…',
    translationNotConfigured: '翻译未开启', context: '语境', examples: '例句',
    lookingUp: '查询中…', noDefinition: '未找到释义',
    britishPronunciation: '英式发音', americanPronunciation: '美式发音',
    pronunciation: '发音', playbackFailed: '播放失败',
    videoHasNoCaptions: '此视频无可用字幕', captionLoadFailed: '字幕加载失败',
    translationIsPro: '字幕翻译是 Pro 功能', upgrade: '升级',
    fullscreenBlocking: '请退出全屏后刷新页面以加载字幕。',
    trackNotFound: '字幕轨道不存在',
    transcriptParamsMissing: '页面未找到字幕参数',
    transcriptFetchFailed: '字幕请求失败',
    transcriptEmpty: '字幕响应为空',
    invalidEmail: '请输入有效邮箱。',
    passwordTooShort: '密码至少需要 6 位。',
    suggestionGoogleFailed: 'Google 翻译不可用，试试 ',
    configure: '去配置',
    upgradeToPro: '升级 Pro',
  },
} as const;

export type MessageKey = keyof typeof messages.en;

export function resolveLocale(preference: UserSettings['interfaceLanguage'] = 'auto'): AppLocale {
  if (preference === 'en' || preference === 'zh_CN') return preference;
  const browserLanguage = typeof chrome !== 'undefined' && chrome.i18n
    ? chrome.i18n.getUILanguage()
    : (typeof navigator !== 'undefined' ? navigator.language : 'en');
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
}

export function t(key: MessageKey, locale: AppLocale = resolveLocale()): string {
  return messages[locale][key] ?? messages.en[key];
}
