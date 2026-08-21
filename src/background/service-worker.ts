/**
 * Service worker —— 后台代理。
 *
 * 核心职责: 代发跨域请求(翻译/词典/发音),绕过 content script 的 CORS/CSP 限制。
 * MV3 的 service worker 有扩展权限, fetch 不受页面 CSP 限制。
 */

import { logger } from '../shared/logger.js';
import { AccountService } from '../auth/account-service.js';
import type { AccountRequest, AccountResponse } from '../auth/types.js';
import { buildBillingUrl } from '../shared/billing.js';
import { isAllowedBackgroundFetch, type BackgroundFetchType } from './fetch-policy.js';
import { getAnonymousId } from '../analytics/anonymous-identity.js';
import {
  createExtensionAnalyticsEvent,
  trackExtensionEvent,
  type ExtensionAnalyticsEvent,
} from '../analytics/extension-analytics.js';

const log = logger.createLogger('sw');
const accountService = new AccountService();
const INSTALL_EVENT_PENDING_KEY = 'nosub-install-event-pending-v1';
const PRODUCT_EVENTS_PENDING_KEY = 'nosub-product-events-pending-v1';
const MAX_PENDING_PRODUCT_EVENTS = 200;
let productEventQueue = Promise.resolve();

void getAnonymousId().catch((error) => log.warn('anonymous identity init failed:', String(error)));

async function flushPendingInstallEvent(): Promise<void> {
  const stored = await chrome.storage.local.get(INSTALL_EVENT_PENDING_KEY);
  const pending = stored[INSTALL_EVENT_PENDING_KEY];
  if (!pending) return;
  const event: ExtensionAnalyticsEvent = pending === true
    ? createExtensionAnalyticsEvent('extension_installed')
    : pending as ExtensionAnalyticsEvent;
  await trackExtensionEvent(event.eventName, event);
  await chrome.storage.local.remove(INSTALL_EVENT_PENDING_KEY);
}

void flushPendingInstallEvent().catch((error) => log.warn('install analytics retry failed:', String(error)));

async function enqueueAndFlushProductEvent(event?: ExtensionAnalyticsEvent): Promise<void> {
  productEventQueue = productEventQueue.catch(() => undefined).then(async () => {
    const stored = await chrome.storage.local.get(PRODUCT_EVENTS_PENDING_KEY);
    const existing = Array.isArray(stored[PRODUCT_EVENTS_PENDING_KEY])
      ? stored[PRODUCT_EVENTS_PENDING_KEY] as ExtensionAnalyticsEvent[]
      : [];
    const pending = event && !existing.some((item) => item.eventId === event.eventId)
      ? [...existing, event].slice(-MAX_PENDING_PRODUCT_EVENTS)
      : existing;
    await chrome.storage.local.set({ [PRODUCT_EVENTS_PENDING_KEY]: pending });

    let sent = 0;
    for (const item of pending) {
      try {
        await trackExtensionEvent(item.eventName, item);
        sent += 1;
      } catch {
        break;
      }
    }
    const remaining = pending.slice(sent);
    if (remaining.length === 0) await chrome.storage.local.remove(PRODUCT_EVENTS_PENDING_KEY);
    else await chrome.storage.local.set({ [PRODUCT_EVENTS_PENDING_KEY]: remaining });
    if (event && remaining.some((item) => item.eventId === event.eventId)) {
      throw new Error('Analytics event is queued for retry.');
    }
  });
  return productEventQueue;
}

void enqueueAndFlushProductEvent().catch((error) => log.warn('product analytics retry failed:', String(error)));
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  const event = createExtensionAnalyticsEvent('extension_installed');
  void chrome.storage.local.set({ [INSTALL_EVENT_PENDING_KEY]: event })
    .then(() => flushPendingInstallEvent())
    .catch((error) => log.warn('install analytics failed:', String(error)));
});

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

function rejectDisallowedFetch(
  type: BackgroundFetchType,
  url: string,
  sendResponse: (resp: BackgroundResponse) => void,
): boolean {
  if (isAllowedBackgroundFetch(type, url)) return false;
  log.warn('blocked proxy fetch:', type, url.slice(0, 120));
  sendResponse({ ok: false, status: 403, body: null, error: 'URL is not allowed' });
  return true;
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
    if (request.type === 'billing:open-upgrade') {
      void (async () => {
        try {
          if (!request.cycle) {
            await chrome.runtime.openOptionsPage();
            sendResponse({ ok: true });
            return;
          }
          const context = await accountService.createCheckoutContext();
          await chrome.tabs.create({ url: buildBillingUrl(request.cycle, context.email, context.checkoutToken) });
          sendResponse({ ok: true });
        } catch (error) {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })().catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
      return true;
    }

    if (request.type === 'analytics:track') {
      const event = createExtensionAnalyticsEvent(request.eventName, {
        eventId: request.eventId,
        occurredAt: request.occurredAt,
        videoSessionId: request.videoSessionId,
        properties: request.properties,
      });
      void enqueueAndFlushProductEvent(event)
        .then(() => sendResponse({ ok: true, status: 202, body: null }))
        .catch((error) => sendResponse({
          ok: false, status: 0, body: null, error: error instanceof Error ? error.message : String(error),
        }));
      return true;
    }

    if (request.type.startsWith('account:')) {
      void (async () => {
        try {
          if (request.type === 'account:sign-in-google') {
            sendResponse({ ok: true, account: await accountService.signInWithGoogle() });
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
      if (rejectDisallowedFetch(request.type, request.url, sendResponse)) return false;
      log.debug('proxy fetch:', request.url.slice(0, 80));
      fetch(request.url)
        .then(async (resp) => {
          const rawBody = await resp.text();
          let body: unknown = rawBody;
          if (request.type === 'dict-fetch') {
            try {
              body = rawBody ? JSON.parse(rawBody) : null;
            } catch {
              sendResponse({
                ok: false,
                status: resp.status,
                body: null,
                error: `Invalid JSON response (HTTP ${resp.status})`,
              });
              return;
            }
          }
          sendResponse({ ok: resp.ok, status: resp.status, body });
        })
        .catch((err) => {
          sendResponse({ ok: false, status: 0, body: null, error: err.message });
        });
      return true; // 保持 channel 开启,等待异步 sendResponse
    }

    if (request.type === 'audio-fetch') {
      if (rejectDisallowedFetch(request.type, request.url, sendResponse)) return false;
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
