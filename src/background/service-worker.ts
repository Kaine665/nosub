/**
 * Service worker —— 后台代理。
 *
 * 核心职责: 代发跨域请求(翻译/词典/发音),绕过 content script 的 CORS/CSP 限制。
 * MV3 的 service worker 有扩展权限, fetch 不受页面 CSP 限制。
 */

import { logger } from '../shared/logger.js';
import { AccountService } from '../auth/account-service.js';
import type { AccountRequest, AccountResponse } from '../auth/types.js';

const log = logger.createLogger('sw');
const accountService = new AccountService();

/** 消息类型 */
type BackgroundRequest =
  | { type: 'translate-fetch'; url: string }
  | { type: 'dict-fetch'; url: string }
  | { type: 'audio-fetch'; url: string }
  | AccountRequest;

interface BackgroundResponse {
  ok: boolean;
  status: number;
  body: unknown;
  contentType?: string;
  error?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

chrome.runtime.onMessage.addListener(
  (request: BackgroundRequest, _sender, sendResponse: (resp: BackgroundResponse | AccountResponse) => void) => {
    if (request.type.startsWith('account:')) {
      void (async () => {
        try {
          if (request.type === 'account:sign-in') {
            sendResponse({ ok: true, account: await accountService.signIn(request.email, request.password) });
          } else if (request.type === 'account:sign-up') {
            const result = await accountService.signUp(request.email, request.password);
            sendResponse({ ok: true, ...result });
          } else if (request.type === 'account:get') {
            sendResponse({ ok: true, account: await accountService.getAccount(request.refresh) });
          } else if (request.type === 'account:sign-out') {
            await accountService.signOut();
            sendResponse({ ok: true, account: { user: null, isPro: false, subscription: null } });
          } else {
            sendResponse({ ok: true, url: await accountService.createPortalSession() });
          }
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    if (request.type === 'translate-fetch' || request.type === 'dict-fetch') {
      log.debug('proxy fetch:', request.url.slice(0, 80));
      fetch(request.url)
        .then(async (resp) => {
          const body = request.type === 'translate-fetch'
            ? await resp.text()  // Google Translate 返回非标准 JSON
            : await resp.json();
          sendResponse({ ok: resp.ok, status: resp.status, body });
        })
        .catch((err) => {
          sendResponse({ ok: false, status: 0, body: null, error: err.message });
        });
      return true; // 保持 channel 开启,等待异步 sendResponse
    }

    if (request.type === 'audio-fetch') {
      log.debug('audio fetch:', request.url.slice(0, 80));
      fetch(request.url)
        .then(async (resp) => {
          if (!resp.ok) {
            sendResponse({ ok: false, status: resp.status, body: null, error: `HTTP ${resp.status}` });
            return;
          }
          const buf = new Uint8Array(await resp.arrayBuffer());
          sendResponse({
            ok: true,
            status: resp.status,
            body: bytesToBase64(buf),
            contentType: resp.headers.get('content-type') || 'audio/mpeg',
          });
        })
        .catch((err) => {
          sendResponse({ ok: false, status: 0, body: null, error: err.message });
        });
      return true;
    }

    return false;
  },
);
