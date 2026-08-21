export interface AuthUser {
  id: string;
  email: string;
}

export interface BillingSubscription {
  id: string;
  status: string;
  priceId: string;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  scheduledChangeAction: string | null;
  paddleLastSyncedAt: string | null;
}

export interface AccountSnapshot {
  user: AuthUser | null;
  isPro: boolean;
  subscription: BillingSubscription | null;
}

export type BillingCycle = 'month' | 'quarter' | 'year';

export type ProductAnalyticsEventName =
  | 'youtube_video_opened'
  | 'caption_load_succeeded'
  | 'caption_load_failed'
  | 'listening_session_started'
  | 'core_action_completed';

export type AccountRequest =
  | { type: 'account:sign-in-google' }
  | { type: 'account:get'; refresh?: boolean }
  | { type: 'account:sign-out' }
  | { type: 'account:create-portal' }
  | {
    type: 'analytics:track';
    eventName: ProductAnalyticsEventName;
    eventId?: string;
    occurredAt?: string;
    videoSessionId?: string;
    properties?: Record<string, string>;
  }
  | { type: 'billing:open-upgrade'; cycle?: BillingCycle };

export type AccountResponse =
  | { ok: true; account?: AccountSnapshot; url?: string }
  | { ok: false; error: string };
