import { SettingsRepository } from '../storage/settings-repository.js';
import { resolveLocale } from '../shared/i18n.js';
import type { AccountResponse } from '../auth/types.js';

const text = {
  en:{tagline:'Focused listening',on:'NoSub is on',off:'NoSub is paused',onCopy:'Ready for supported YouTube videos',offCopy:'Turn it on when you are ready to practice',repeat:'Repeat',reveal:'Captions',next:'Next',speed:'Speed',settings:'Open settings',youtube:'Open a YouTube video to start practicing.',reloading:'Reloading this YouTube page…',signedOut:'Sign in to use NoSub Pro',free:'Free account',pro:'Pro active',account:'Sign in / account'},
  zh_CN:{tagline:'YouTube 精听',on:'NoSub 已开启',off:'NoSub 已暂停',onCopy:'已准备好用于支持的 YouTube 视频',offCopy:'准备练习时再将它开启',repeat:'重听',reveal:'字幕',next:'下一句',speed:'倍速',settings:'打开设置',youtube:'打开一个 YouTube 视频即可开始练习。',reloading:'正在重新加载 YouTube 页面…',signedOut:'登录后使用 NoSub Pro',free:'免费账号',pro:'Pro 已激活',account:'登录 / 账号'},
} as const;
const repo = new SettingsRepository();
const enabled = document.getElementById('enabled') as HTMLInputElement;
const set = (id:string,value:string) => { const el=document.getElementById(id); if(el) el.textContent=value; };

async function init(): Promise<void> {
  let settings = await repo.load();
  const locale = resolveLocale(settings.interfaceLanguage); const c=text[locale];
  document.documentElement.lang=locale==='zh_CN'?'zh-CN':'en';
  set('tagline',c.tagline); set('repeat',c.repeat); set('reveal',c.reveal); set('next',c.next); set('speed',c.speed); set('settings-label',c.settings);
  set('account-action', c.account);
  const paint=()=>{set('status-title',enabled.checked?c.on:c.off);set('status-copy',enabled.checked?c.onCopy:c.offCopy)};
  enabled.checked=settings.enabled; paint();
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const isYouTube=tab?.url?.startsWith('https://www.youtube.com/');
  if(!isYouTube)set('page-hint',c.youtube);
  enabled.addEventListener('change',async()=>{settings={...settings,enabled:enabled.checked};await repo.save(settings);paint();if(isYouTube&&tab.id){set('page-hint',c.reloading);await chrome.tabs.reload(tab.id);window.close();}});
  document.getElementById('settings')?.addEventListener('click',()=>void chrome.runtime.openOptionsPage());
  document.getElementById('account')?.addEventListener('click',()=>void chrome.runtime.openOptionsPage());
  try {
    const response = await chrome.runtime.sendMessage({ type: 'account:get' }) as AccountResponse;
    if (response.ok && response.account?.user) {
      set('account-title', response.account.user.email);
      set('account-plan', response.account.isPro ? c.pro : c.free);
      document.getElementById('account-badge')?.classList.toggle('pro', response.account.isPro);
      set('account-badge', response.account.isPro ? 'PRO' : 'FREE');
    } else {
      set('account-title', c.signedOut); set('account-plan', c.free); set('account-badge', 'FREE');
    }
  } catch { set('account-title', c.signedOut); set('account-plan', c.free); }
}
void init();
