import { SettingsRepository } from '../storage/settings-repository.js';
import type { UserSettings } from '../shared/types.js';
import { resolveLocale, t, type AppLocale } from '../shared/i18n.js';
import type { AccountRequest, AccountResponse, AccountSnapshot } from '../auth/types.js';

const copy = {
  en: {title:'Make every sentence count.',subtitle:'Shape your focused-listening experience for YouTube.',saved:'Saved',saving:'Saving…',account:'Account',accountHelp:'Your sign-in and plan status.',signedOutTitle:'Not signed in',freeNoLogin:'Free features work without an account.',accountAction:'Sign in / create account',authEyebrow:'Account',signIn:'Sign in',signUp:'Create account',emailLabel:'Email',passwordLabel:'Password',authFootnote:'Your free listening tools remain available without signing in.',loginTitle:'Sign in to NoSub',loginSubtitle:'Continue to sync your Pro access on this browser.',createTitle:'Create your NoSub account',createSubtitle:'Create one account for purchases and Pro access.',upgrade:'View Pro plans',manage:'Manage subscription',refresh:'Refresh status',signOut:'Sign out',freePlan:'Free plan · Core listening tools included',proPlan:'Pro active',signedIn:'Signed in successfully.',created:'Account created and signed in.',refreshed:'Plan status refreshed.',extension:'NoSub on YouTube',extensionHelp:'Show the focused-listening controls on supported YouTube videos.',language:'Language',interfaceLanguage:'Interface language',auto:'Auto (browser)',captionLanguage:'Preferred caption language',englishAny:'English (any)',translationLanguage:'Translate captions to',off:'Off',session:'Listening session',startingView:'Starting subtitle view',hidden:'Hidden — listen first',original:'Original captions',translated:'Original + translation',shortcuts:'Keyboard flow',shortcutHelp:'A repeat · S captions · D next · E speed',privacy:'Privacy & online services',privacyText:'Settings and learning state stay in Chrome local storage. Definitions, translations, pronunciation audio, and example sentences are requested only when you use those features. No browsing history is sold or used for advertising.',dictionarySource:'Dictionary source',publicDictionary:'Public APIs · NoSub server fallback',serverDictionary:'NoSub server only',services:'Connected services',serviceList:'Dictionary service · Google Translate · Tatoeba',onDemand:'On demand',reloadHint:'Changes apply to newly opened or reloaded YouTube pages.'},
  zh_CN: {title:'认真听懂每一句。',subtitle:'配置你的 YouTube 精听体验。',saved:'已保存',saving:'保存中…',account:'账号',accountHelp:'查看登录状态与套餐。',signedOutTitle:'尚未登录',freeNoLogin:'免费功能无需账号即可使用。',accountAction:'登录 / 创建账号',authEyebrow:'账号',signIn:'登录',signUp:'创建账号',emailLabel:'邮箱',passwordLabel:'密码',authFootnote:'不登录也可以继续使用免费精听功能。',loginTitle:'登录 NoSub',loginSubtitle:'登录后在这台浏览器同步 Pro 权益。',createTitle:'创建 NoSub 账号',createSubtitle:'购买记录与 Pro 权益都会绑定到这个账号。',upgrade:'查看 Pro 套餐',manage:'管理订阅',refresh:'刷新状态',signOut:'退出登录',freePlan:'免费版 · 包含核心精听功能',proPlan:'Pro 已激活',signedIn:'登录成功。',created:'账号已创建并登录。',refreshed:'套餐状态已刷新。',extension:'在 YouTube 上启用 NoSub',extensionHelp:'在支持的 YouTube 视频中显示精听控制栏。',language:'语言',interfaceLanguage:'界面语言',auto:'自动（跟随浏览器）',captionLanguage:'首选字幕语言',englishAny:'英语（不限地区）',translationLanguage:'字幕翻译为',off:'关闭',session:'精听会话',startingView:'字幕初始状态',hidden:'隐藏——先听再看',original:'原文字幕',translated:'原文 + 翻译',shortcuts:'键盘操作',shortcutHelp:'A 重听 · S 字幕 · D 下一句 · E 倍速',privacy:'隐私和在线服务',privacyText:'设置和学习状态保存在 Chrome 本地。只有使用相应功能时，才会请求释义、翻译、发音和例句。我们不会出售浏览记录，也不会将其用于广告。',dictionarySource:'词典来源',publicDictionary:'公共 API · NoSub 服务器兜底',serverDictionary:'仅使用 NoSub 服务器',services:'连接的服务',serviceList:'词典服务 · Google 翻译 · Tatoeba',onDemand:'按需请求',reloadHint:'更改会应用到新打开或重新加载的 YouTube 页面。'},
} as const;

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
const emailInput = byId<HTMLInputElement>('account-email');
const passwordInput = byId<HTMLInputElement>('account-password');
const message = byId<HTMLElement>('account-message');
const authMessage = byId<HTMLElement>('auth-message');
const authDialog = byId<HTMLDialogElement>('auth-dialog');
let authMode: 'sign-in' | 'sign-up' = 'sign-in';
let settings: UserSettings;
let account: AccountSnapshot = { user: null, isPro: false, subscription: null };
let saveTimer: number | undefined;

function locale(): AppLocale { return resolveLocale(interfaceLanguage.value as UserSettings['interfaceLanguage']); }

function paintLanguage(): void {
  const lang = locale();
  document.documentElement.lang = lang === 'zh_CN' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach((node) => {
    const key = node.dataset.copy as keyof typeof copy.en;
    node.textContent = copy[lang][key];
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

function showAuthMessage(text: string, kind: 'success' | 'error' | '' = ''): void {
  authMessage.textContent = text;
  authMessage.className = `auth-message ${kind}`;
}

function planDetail(value: AccountSnapshot): string {
  if (!value.isPro) return copy[locale()].freePlan;
  const end = value.subscription?.currentPeriodEndsAt;
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
  byId<HTMLElement>('upgrade').classList.toggle('hidden', value.isPro);
  byId<HTMLElement>('manage').classList.toggle('hidden', !value.subscription);
}

async function withBusy(button: HTMLButtonElement, task: () => Promise<void>): Promise<void> {
  button.disabled = true; showMessage('');
  try { await task(); } catch (error) { showMessage(error instanceof Error ? error.message : String(error), 'error'); }
  finally { button.disabled = false; }
}

function bindAccount(): void {
  const credentials = (): { email: string; password: string } => {
    const email = emailInput.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error(t('invalidEmail', locale()));
    const password = passwordInput.value;
    if (password.length < 6) throw new Error(t('passwordTooShort', locale()));
    return { email, password };
  };
  const setMode = (mode: 'sign-in' | 'sign-up'): void => {
    authMode = mode;
    const isSignIn = mode === 'sign-in';
    byId<HTMLElement>('auth-title').textContent = isSignIn ? copy[locale()].loginTitle : copy[locale()].createTitle;
    byId<HTMLElement>('auth-subtitle').textContent = isSignIn ? copy[locale()].loginSubtitle : copy[locale()].createSubtitle;
    byId<HTMLButtonElement>('auth-submit').textContent = isSignIn ? copy[locale()].signIn : copy[locale()].signUp;
    byId<HTMLButtonElement>('sign-in-mode').classList.toggle('active', isSignIn);
    byId<HTMLButtonElement>('sign-up-mode').classList.toggle('active', !isSignIn);
    byId<HTMLButtonElement>('sign-in-mode').setAttribute('aria-selected', String(isSignIn));
    byId<HTMLButtonElement>('sign-up-mode').setAttribute('aria-selected', String(!isSignIn));
    passwordInput.autocomplete = isSignIn ? 'current-password' : 'new-password';
    showAuthMessage('');
  };
  byId<HTMLButtonElement>('open-auth').addEventListener('click', () => { setMode('sign-in'); authDialog.showModal(); emailInput.focus(); });
  byId<HTMLButtonElement>('auth-close').addEventListener('click', () => authDialog.close());
  authDialog.addEventListener('click', (event) => { if (event.target === authDialog) authDialog.close(); });
  byId<HTMLButtonElement>('sign-in-mode').addEventListener('click', () => setMode('sign-in'));
  byId<HTMLButtonElement>('sign-up-mode').addEventListener('click', () => setMode('sign-up'));
  const authSubmit = byId<HTMLButtonElement>('auth-submit');
  byId<HTMLFormElement>('auth-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      authSubmit.disabled = true;
      showAuthMessage('');
      try {
        const response = await request({ type: authMode === 'sign-in' ? 'account:sign-in' : 'account:sign-up', ...credentials() });
        if (!response.ok) { showAuthMessage(response.error, 'error'); return; }
        if (response.account) paintAccount(response.account);
        authDialog.close();
        showMessage(authMode === 'sign-in' ? copy[locale()].signedIn : copy[locale()].created, 'success');
        passwordInput.value = '';
      } catch (error) {
        showAuthMessage(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        authSubmit.disabled = false;
      }
    })();
  });
  const upgrade = byId<HTMLButtonElement>('upgrade');
  upgrade.addEventListener('click', () => void withBusy(upgrade, async () => {
    const response = await request({ type: 'billing:open-upgrade' });
    if (!response.ok) throw new Error(response.error);
  }));
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
    if (response.ok) { paintAccount(response.account ?? { user: null, isPro: false, subscription: null }); passwordInput.value = ''; showMessage(''); }
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
