import { SettingsRepository } from '../storage/settings-repository.js';
import type { UserSettings } from '../shared/types.js';
import { resolveLocale, type AppLocale } from '../shared/i18n.js';
import type { AccountRequest, AccountResponse, AccountSnapshot, BillingCycle } from '../auth/types.js';

const copy = {
  en: {title:'Make every sentence count.',subtitle:'Shape your focused-listening experience for YouTube.',saved:'Saved',saving:'Saving…',account:'Account',accountHelp:'Your sign-in and plan status.',signedOutTitle:'Not signed in',freeNoLogin:'Free features work without an account.',googleSignIn:'Continue with Google',manage:'Manage subscription',refresh:'Refresh status',signOut:'Sign out',freePlan:'Free plan · Core listening tools included',proPlan:'Pro active',signedIn:'Signed in with Google.',refreshed:'Plan status refreshed.',plansTitle:'Choose your plan',plansHelp:'Unlock unlimited translation, word explanations and every future Pro feature.',secure:'Secure checkout by Paddle',flexible:'Flexible',monthly:'Monthly',monthlyNote:'Renews monthly. Cancel anytime.',chooseMonthly:'Choose monthly',popular:'Most popular',momentum:'Build momentum',quarterly:'3 months',quarterlyNote:'Save 20% compared with monthly.',chooseQuarterly:'Choose 3 months',bestValue:'Best value · 35% off',commit:'Make it count',yearly:'Yearly',yearlyNote:'The lowest monthly price.',chooseYearly:'Choose yearly',signInToBuy:'Sign in with Google above before choosing a plan. Your Pro access will be linked to this account.',activePlanNote:'Your Pro plan is active. Use Manage subscription for billing changes.',extension:'NoSub on YouTube',extensionHelp:'Show the focused-listening controls on supported YouTube videos.',language:'Language',interfaceLanguage:'Interface language',auto:'Auto (browser)',captionLanguage:'Preferred caption language',englishAny:'English (any)',translationLanguage:'Translate captions to',off:'Off',session:'Listening session',startingView:'Starting subtitle view',hidden:'Hidden — listen first',original:'Original captions',translated:'Original + translation',shortcuts:'Keyboard flow',shortcutHelp:'Q focus on/off · A previous · S captions · D next · E speed',privacy:'Privacy & online services',privacyText:'Settings and learning state stay in Chrome local storage. Definitions, translations, pronunciation audio, and example sentences are requested only when you use those features. No browsing history is sold or used for advertising.',dictionarySource:'Dictionary source',publicDictionary:'Public APIs · NoSub server fallback',serverDictionary:'NoSub server only',services:'Connected services',serviceList:'Dictionary service · Google Translate · Tatoeba',onDemand:'On demand',reloadHint:'Changes apply to newly opened or reloaded YouTube pages.'},
  zh_CN: {title:'认真听懂每一句。',subtitle:'配置你的 YouTube 精听体验。',saved:'已保存',saving:'保存中…',account:'账号',accountHelp:'查看登录状态与套餐。',signedOutTitle:'尚未登录',freeNoLogin:'免费功能无需账号即可使用。',googleSignIn:'使用 Google 登录',manage:'管理订阅',refresh:'刷新状态',signOut:'退出登录',freePlan:'免费版 · 包含核心精听功能',proPlan:'Pro 已激活',signedIn:'已使用 Google 登录。',refreshed:'套餐状态已刷新。',plansTitle:'选择 Pro 套餐',plansHelp:'解锁无限字幕翻译、单词释义及未来的 Pro 功能。',secure:'Paddle 安全收款',flexible:'灵活选择',monthly:'月付',monthlyNote:'每月续费，随时可取消。',chooseMonthly:'选择月付',popular:'最受欢迎',momentum:'建立节奏',quarterly:'3 个月',quarterlyNote:'相比月付节省 20%。',chooseQuarterly:'选择 3 个月',bestValue:'最划算 · 6.5 折',commit:'坚持练习',yearly:'年付',yearlyNote:'月均价格最低。',chooseYearly:'选择年付',signInToBuy:'请先在上方使用 Google 登录，再选择套餐。Pro 权限会绑定到该账号。',activePlanNote:'Pro 套餐已激活。如需更改付款信息或取消，请点击“管理订阅”。',extension:'在 YouTube 上启用 NoSub',extensionHelp:'在支持的 YouTube 视频中显示精听控制栏。',language:'语言',interfaceLanguage:'界面语言',auto:'自动（跟随浏览器）',captionLanguage:'首选字幕语言',englishAny:'英语（不限地区）',translationLanguage:'字幕翻译为',off:'关闭',session:'精听会话',startingView:'字幕初始状态',hidden:'隐藏——先听再看',original:'原文字幕',translated:'原文 + 翻译',shortcuts:'键盘操作',shortcutHelp:'Q 进入/退出精听 · A 上一句 · S 字幕 · D 下一句 · E 倍速',privacy:'隐私和在线服务',privacyText:'设置和学习状态保存在 Chrome 本地。只有使用相应功能时，才会请求释义、翻译、发音和例句。我们不会出售浏览记录，也不会将其用于广告。',dictionarySource:'词典来源',publicDictionary:'公共 API · NoSub 服务器兜底',serverDictionary:'仅使用 NoSub 服务器',services:'连接的服务',serviceList:'词典服务 · Google 翻译 · Tatoeba',onDemand:'按需请求',reloadHint:'更改会应用到新打开或重新加载的 YouTube 页面。'},
} as const;

const privacyDisclosure: Record<AppLocale, string> = {
  en: 'Settings and learning state stay in Chrome local storage. NoSub records limited first-party product events, browser language, and an IP-derived country code without storing the raw IP in analytics. No browsing history is sold or used for advertising.',
  zh_CN: '设置和学习状态保存在 Chrome 本地。NoSub 会记录有限的第一方产品事件、浏览器语言和由 IP 推断的国家代码，分析数据库不保存原始 IP。我们不会出售浏览记录，也不会将其用于广告。',
};

const repo = new SettingsRepository();
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = byId<HTMLInputElement>('enabled');
const interfaceLanguage = byId<HTMLSelectElement>('interfaceLanguage');
const targetLanguage = byId<HTMLSelectElement>('targetLanguage');
const translationLanguage = byId<HTMLSelectElement>('translationLanguage');
const startingView = byId<HTMLSelectElement>('startingView');
const dictionarySource = byId<HTMLSelectElement>('dictionarySource');
const saveState = byId<HTMLElement>('save-state');
const signedOut = byId<HTMLElement>('signed-out');
const signedIn = byId<HTMLElement>('signed-in');
const message = byId<HTMLElement>('account-message');
let settings: UserSettings;
let account: AccountSnapshot = { user: null, isPro: false, subscription: null };
let saveTimer: number | undefined;

function locale(): AppLocale { return resolveLocale(interfaceLanguage.value as UserSettings['interfaceLanguage']); }

function paintLanguage(): void {
  const lang = locale();
  document.documentElement.lang = lang === 'zh_CN' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach((node) => {
    const key = node.dataset.copy as keyof typeof copy.en;
    node.textContent = key === 'privacyText' ? privacyDisclosure[lang] : copy[lang][key];
  });
  paintAccount(account);
}

function collect(): UserSettings {
  const view = startingView.value;
  return {...settings,enabled:enabled.checked,interfaceLanguage:interfaceLanguage.value as UserSettings['interfaceLanguage'],targetLanguage:targetLanguage.value,translationLanguage:translationLanguage.value,dictionarySource:dictionarySource.value as UserSettings['dictionarySource'],showTargetCaption:view !== 'hidden',showTranslatedCaption:view === 'translated' && translationLanguage.value !== 'off'};
}

function queueSave(): void {
  paintLanguage();
  saveState.textContent = copy[locale()].saving; saveState.classList.add('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => { settings = collect(); await repo.save(settings); saveState.textContent = copy[locale()].saved; saveState.classList.remove('saving'); }, 220);
}

async function request(payload: AccountRequest): Promise<AccountResponse> {
  return chrome.runtime.sendMessage(payload) as Promise<AccountResponse>;
}

function showMessage(text: string, kind: 'success' | 'error' | '' = ''): void {
  message.textContent = text;
  message.className = `account-message ${kind}`;
}

function planDetail(value: AccountSnapshot): string {
  if (!value.isPro) return copy[locale()].freePlan;
  const end = value.subscription?.status === 'trialing'
    ? value.subscription.trialEndsAt
    : value.subscription?.currentPeriodEndsAt;
  if (!end) return copy[locale()].proPlan;
  const date = new Intl.DateTimeFormat(locale() === 'zh_CN' ? 'zh-CN' : 'en', { dateStyle: 'medium' }).format(new Date(end));
  return `${copy[locale()].proPlan} · ${date}`;
}

function paintAccount(value: AccountSnapshot): void {
  account = value;
  const isSignedIn = Boolean(value.user);
  signedOut.classList.toggle('hidden', isSignedIn);
  signedIn.classList.toggle('hidden', !isSignedIn);
  const badge = byId<HTMLElement>('plan-badge');
  badge.textContent = value.isPro ? 'PRO' : 'FREE';
  badge.classList.toggle('pro', value.isPro);
  if (!value.user) return;
  byId<HTMLElement>('account-email-label').textContent = value.user.email;
  byId<HTMLElement>('avatar').textContent = value.user.email.charAt(0).toUpperCase();
  byId<HTMLElement>('plan-detail').textContent = planDetail(value);
  byId<HTMLElement>('manage').classList.toggle('hidden', !value.subscription);
  const plans = byId<HTMLElement>('plans-card');
  plans.classList.toggle('is-active', value.isPro);
  for (const button of plans.querySelectorAll<HTMLButtonElement>('[data-cycle]')) button.disabled = !isSignedIn || value.isPro;
  byId<HTMLElement>('plans-note').textContent = value.isPro ? copy[locale()].activePlanNote : copy[locale()].signInToBuy;
}

async function withBusy(button: HTMLButtonElement, task: () => Promise<void>): Promise<void> {
  button.disabled = true; showMessage('');
  try { await task(); } catch (error) { showMessage(error instanceof Error ? error.message : String(error), 'error'); }
  finally { button.disabled = false; }
}

function bindAccount(): void {
  const googleSignIn = byId<HTMLButtonElement>('google-sign-in');
  googleSignIn.addEventListener('click', () => void withBusy(googleSignIn, async () => {
    const response = await request({ type: 'account:sign-in-google' });
    if (!response.ok) throw new Error(response.error);
    paintAccount(response.account ?? account);
    showMessage(copy[locale()].signedIn, 'success');
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-cycle]').forEach((button) => {
    button.addEventListener('click', () => void withBusy(button, async () => {
      const response = await request({ type: 'billing:open-upgrade', cycle: button.dataset.cycle as BillingCycle });
      if (!response.ok) throw new Error(response.error);
    }));
  });
  const manage = byId<HTMLButtonElement>('manage');
  manage.addEventListener('click', () => void withBusy(manage, async () => {
    const response = await request({ type: 'account:create-portal' });
    if (!response.ok) throw new Error(response.error);
    if (response.url) await chrome.tabs.create({ url: response.url });
  }));
  const refresh = byId<HTMLButtonElement>('refresh-plan');
  refresh.addEventListener('click', () => void withBusy(refresh, async () => {
    const response = await request({ type: 'account:get', refresh: true });
    if (!response.ok) throw new Error(response.error);
    paintAccount(response.account ?? account); showMessage(copy[locale()].refreshed, 'success');
  }));
  byId<HTMLButtonElement>('sign-out').addEventListener('click', async () => {
    const response = await request({ type: 'account:sign-out' });
    if (response.ok) { paintAccount(response.account ?? { user: null, isPro: false, subscription: null }); showMessage(''); }
  });
}

async function init(): Promise<void> {
  settings = await repo.load();
  enabled.checked = settings.enabled; interfaceLanguage.value = settings.interfaceLanguage;
  targetLanguage.value = settings.targetLanguage ?? 'en'; translationLanguage.value = settings.translationLanguage ?? 'off';
  dictionarySource.value = settings.dictionarySource;
  startingView.value = settings.showTranslatedCaption ? 'translated' : settings.showTargetCaption ? 'original' : 'hidden';
  paintLanguage(); bindAccount();
  document.querySelectorAll('#enabled,select').forEach((control) => control.addEventListener('change', queueSave));
  const response = await request({ type: 'account:get' });
  if (response.ok && response.account) paintAccount(response.account);
  else if (!response.ok) showMessage(response.error, 'error');
}

void init();
