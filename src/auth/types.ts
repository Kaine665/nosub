export interface AuthUser {
  id: string;
  email: string;
}

export interface BillingSubscription {
  id: string;
  status: string;
  priceId: string;
  currentPeriodEndsAt: string | null;
  scheduledChangeAction: string | null;
}

export interface AccountSnapshot {
  user: AuthUser | null;
  isPro: boolean;
  subscription: BillingSubscription | null;
}

export type AccountRequest =
  | { type: 'account:sign-in-google' }
  | { type: 'account:get'; refresh?: boolean }
  | { type: 'account:sign-out' }
  | { type: 'account:create-portal' }
  | { type: 'billing:open-upgrade' };

export type AccountResponse =
  | { ok: true; account?: AccountSnapshot; url?: string }
  | { ok: false; error: string };
