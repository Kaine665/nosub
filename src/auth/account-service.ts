import type { AccountSnapshot, AuthUser, BillingSubscription } from './types.js';

const SUPABASE_URL = 'https://eyqnncnryfcnwtgupoxy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7Vex6ZM_52kqb9CCPyIYZw_ezez33Gm';
const SESSION_KEY = 'nosub-auth-session';
const ACCOUNT_CACHE_KEY = 'nosub-account-cache';

interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string; email?: string };
}

interface SignUpResponse extends Partial<AuthSession> {
  user: { id: string; email?: string };
}

interface SubscriptionRow {
  paddle_subscription_id: string;
  status: string;
  price_id: string;
  current_period_ends_at: string | null;
  scheduled_change_action: string | null;
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
  async signIn(email: string, password: string): Promise<AccountSnapshot> {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    await this.saveSession(await response.json() as AuthSession);
    return this.getAccount(true);
  }

  async signUp(email: string, password: string): Promise<{ account?: AccountSnapshot; needsConfirmation: boolean }> {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = await response.json() as SignUpResponse;
    if (!body.access_token || !body.refresh_token) return { needsConfirmation: true };
    await this.saveSession(body as AuthSession);
    return { account: await this.getAccount(true), needsConfirmation: false };
  }

  async signOut(): Promise<void> {
    const session = await this.loadSession();
    if (session) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
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
    const [userResponse, proResponse, subscriptionResponse] = await Promise.all([
      fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: this.headers(session.access_token) }),
      fetch(`${SUPABASE_URL}/rest/v1/rpc/has_pro_access`, { method: 'POST', headers: this.headers(session.access_token), body: '{}' }),
      fetch(`${SUPABASE_URL}/rest/v1/subscriptions?select=paddle_subscription_id,status,price_id,current_period_ends_at,scheduled_change_action&order=updated_at.desc&limit=1`, { headers: this.headers(session.access_token) }),
    ]);
    if (userResponse.status === 401) {
      await this.signOut();
      return this.cache({ user: null, isPro: false, subscription: null });
    }
    if (!userResponse.ok) throw new Error(await errorMessage(userResponse));

    const rawUser = await userResponse.json() as { id: string; email?: string };
    const user: AuthUser = { id: rawUser.id, email: rawUser.email ?? session.user.email ?? '' };
    const isPro = proResponse.ok ? Boolean(await proResponse.json()) : false;
    let subscription: BillingSubscription | null = null;
    if (subscriptionResponse.ok) {
      const row = (await subscriptionResponse.json() as SubscriptionRow[])[0];
      if (row) subscription = {
        id: row.paddle_subscription_id, status: row.status, priceId: row.price_id,
        currentPeriodEndsAt: row.current_period_ends_at,
        scheduledChangeAction: row.scheduled_change_action,
      };
    }
    return this.cache({ user, isPro, subscription });
  }

  async createPortalSession(): Promise<string> {
    const session = await this.validSession();
    if (!session) throw new Error('Sign in before managing your subscription.');
    const response = await fetch(`${SUPABASE_URL}/functions/v1/customer-portal`, {
      method: 'POST', headers: this.headers(session.access_token), body: '{}',
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const body = await response.json() as { url?: string };
    if (!body.url) throw new Error('Paddle did not return a customer portal URL.');
    return body.url;
  }

  private headers(accessToken?: string): Record<string, string> {
    return {
      apikey: SUPABASE_KEY,
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
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
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
}
