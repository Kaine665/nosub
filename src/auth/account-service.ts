import type { AccountSnapshot } from './types.js';
import { getAnonymousId } from '../analytics/anonymous-identity.js';

const API_URL = 'https://api-nosub.43-130-246-125.sslip.io';
const SESSION_KEY = 'nosub-auth-session-v2';
const ACCOUNT_CACHE_KEY = 'nosub-account-cache-v2';
const IDENTITY_LINKS_KEY = 'nosub-analytics-identity-links-v1';

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string; email?: string };
}

export interface CheckoutContext {
  email: string;
  checkoutToken: string;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { msg?: string; message?: string; error_description?: string; error?: string };
    return body.msg ?? body.message ?? body.error_description ?? body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export class AccountService {
  async signInWithGoogle(): Promise<AccountSnapshot> {
    const tokenResult = await chrome.identity.getAuthToken({
      interactive: true,
      scopes: [
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
    if (!tokenResult.token) throw new Error('Google did not return a sign-in token.');
    const response = await fetch(`${API_URL}/v1/auth/google`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ google_access_token: tokenResult.token }),
    });
    if (!response.ok) {
      if (response.status === 401) await chrome.identity.removeCachedAuthToken({ token: tokenResult.token });
      throw new Error(await errorMessage(response));
    }
    const session = await response.json() as AuthSession;
    await this.saveSession(session);
    await this.ensureAnalyticsIdentity(session).catch(() => undefined);
    return this.getAccount(true);
  }

  async signOut(): Promise<void> {
    const session = await this.loadSession();
    if (session) {
      await fetch(`${API_URL}/v1/auth/logout`, {
        method: 'POST', headers: this.headers(session.access_token),
      }).catch(() => undefined);
    }
    await chrome.storage.local.remove([SESSION_KEY, ACCOUNT_CACHE_KEY]);
  }

  async getAccount(forceRefresh = false): Promise<AccountSnapshot> {
    if (!forceRefresh) {
      const cached = await chrome.storage.local.get(ACCOUNT_CACHE_KEY);
      const value = cached[ACCOUNT_CACHE_KEY] as { account?: AccountSnapshot; cachedAt?: number } | undefined;
      if (value?.account && value.cachedAt && Date.now() - value.cachedAt < 60_000) return value.account;
    }

    const session = await this.validSession();
    if (!session) return this.cache({ user: null, isPro: false, subscription: null });
    await this.ensureAnalyticsIdentity(session).catch(() => undefined);
    const response = await fetch(`${API_URL}/v1/account`, { headers: this.headers(session.access_token) });
    if (response.status === 401) {
      await this.signOut();
      return this.cache({ user: null, isPro: false, subscription: null });
    }
    if (!response.ok) throw new Error(await errorMessage(response));
    return this.cache(await response.json() as AccountSnapshot);
  }

  async createPortalSession(): Promise<string> {
    const session = await this.validSession();
    if (!session) throw new Error('Sign in before managing your subscription.');
    const response = await fetch(`${API_URL}/v1/billing/portal`, {
      method: 'POST', headers: this.headers(session.access_token), body: '{}',
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = await response.json() as { url?: string };
    if (!body.url) throw new Error('Paddle did not return a customer portal URL.');
    return body.url;
  }

  async createCheckoutContext(): Promise<CheckoutContext> {
    const session = await this.validSession();
    if (!session) throw new Error('Sign in before upgrading to NoSub Pro.');
    const response = await fetch(`${API_URL}/v1/billing/checkout-context`, {
      method: 'POST', headers: this.headers(session.access_token), body: '{}',
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = await response.json() as { email?: string; checkout_token?: string };
    if (!body.email || !body.checkout_token) throw new Error('Unable to create a secure checkout link.');
    return { email: body.email, checkoutToken: body.checkout_token };
  }

  private headers(accessToken?: string): Record<string, string> {
    return {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      'content-type': 'application/json',
    };
  }

  private async loadSession(): Promise<AuthSession | null> {
    const stored = await chrome.storage.local.get(SESSION_KEY);
    return (stored[SESSION_KEY] as AuthSession | undefined) ?? null;
  }

  private async saveSession(session: AuthSession): Promise<void> {
    const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);
    await chrome.storage.local.set({ [SESSION_KEY]: { ...session, expires_at: expiresAt } });
  }

  private async validSession(): Promise<AuthSession | null> {
    const session = await this.loadSession();
    if (!session) return null;
    if ((session.expires_at ?? 0) > Math.floor(Date.now() / 1000) + 60) return session;
    const response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!response.ok) {
      await chrome.storage.local.remove([SESSION_KEY, ACCOUNT_CACHE_KEY]);
      return null;
    }
    const refreshed = await response.json() as AuthSession;
    await this.saveSession(refreshed);
    return refreshed;
  }

  private async cache(account: AccountSnapshot): Promise<AccountSnapshot> {
    await chrome.storage.local.set({ [ACCOUNT_CACHE_KEY]: { account, cachedAt: Date.now() } });
    return account;
  }

  private async ensureAnalyticsIdentity(session: AuthSession): Promise<void> {
    const anonymousId = await getAnonymousId();
    const stored = await chrome.storage.local.get(IDENTITY_LINKS_KEY);
    const links = (stored[IDENTITY_LINKS_KEY] as Record<string, string> | undefined) ?? {};
    if (links[session.user.id] === anonymousId) return;

    const response = await fetch(`${API_URL}/v1/analytics/identity`, {
      method: 'POST',
      headers: this.headers(session.access_token),
      body: JSON.stringify({ anonymous_id: anonymousId }),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    await chrome.storage.local.set({
      [IDENTITY_LINKS_KEY]: { ...links, [session.user.id]: anonymousId },
    });
  }
}
