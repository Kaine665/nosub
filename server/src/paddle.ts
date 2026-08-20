import type pg from 'pg';
import { verifyCheckoutToken, type CheckoutClaims } from './security.js';
import {
  subscriptionCacheValues, type PaddleSubscriptionData,
} from './paddle-subscription.js';

export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

function checkoutClaims(data: Record<string, unknown>, secret: string): CheckoutClaims | null {
  const customData = data.custom_data as Record<string, unknown> | null | undefined;
  const token = customData?.nosub_checkout_token;
  return typeof token === 'string' ? verifyCheckoutToken(token, secret) : null;
}

export async function upsertPaddleSubscription(
  client: pg.PoolClient,
  data: PaddleSubscriptionData,
  options: { claims?: CheckoutClaims | null; eventOccurredAt?: string; authoritative?: boolean } = {},
): Promise<void> {
  const values = subscriptionCacheValues(data);
  await client.query(
    `insert into paddle_customers (paddle_customer_id, user_id, email) values ($1, $2, $3)
     on conflict (paddle_customer_id) do update set
       user_id = coalesce(excluded.user_id, paddle_customers.user_id),
       email = coalesce(excluded.email, paddle_customers.email), updated_at = now()`,
    [values.customerId, options.claims?.userId ?? null, options.claims?.email ?? null],
  );
  const parameters = [
    values.subscriptionId, values.customerId, values.status, values.priceId, values.priceIds, values.productId,
    values.currentPeriodStartsAt, values.currentPeriodEndsAt, values.scheduledChangeAction,
    values.scheduledChangeAt, values.canceledAt, values.trialStartedAt, values.trialEndsAt,
    values.nextBilledAt, values.paddleUpdatedAt, options.eventOccurredAt ?? null,
  ];
  const freshnessGuard = options.authoritative
    ? ''
    : `where subscriptions.last_event_occurred_at is null
        or excluded.last_event_occurred_at >= subscriptions.last_event_occurred_at`;
  await client.query(
    `insert into subscriptions (
      paddle_subscription_id, paddle_customer_id, user_id, status, price_id, product_id,
      price_ids,
      current_period_starts_at, current_period_ends_at, scheduled_change_action,
      scheduled_change_at, canceled_at, trial_started_at, trial_ends_at, next_billed_at,
      paddle_updated_at, paddle_last_synced_at, last_event_occurred_at
    ) values (
      $1, $2, (select user_id from paddle_customers where paddle_customer_id = $2), $3, $4, $6,
      $5, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $16
    ) on conflict (paddle_subscription_id) do update set
      paddle_customer_id = excluded.paddle_customer_id,
      user_id = coalesce(excluded.user_id, subscriptions.user_id), status = excluded.status,
      price_id = excluded.price_id, product_id = excluded.product_id,
      price_ids = excluded.price_ids,
      current_period_starts_at = excluded.current_period_starts_at,
      current_period_ends_at = excluded.current_period_ends_at,
      scheduled_change_action = excluded.scheduled_change_action,
      scheduled_change_at = excluded.scheduled_change_at,
      canceled_at = excluded.canceled_at,
      trial_started_at = coalesce(excluded.trial_started_at, subscriptions.trial_started_at),
      trial_ends_at = coalesce(excluded.trial_ends_at, subscriptions.trial_ends_at),
      next_billed_at = excluded.next_billed_at,
      paddle_updated_at = coalesce(excluded.paddle_updated_at, subscriptions.paddle_updated_at),
      paddle_last_synced_at = now(),
      last_event_occurred_at = coalesce(excluded.last_event_occurred_at, subscriptions.last_event_occurred_at),
      updated_at = now()
    ${freshnessGuard}`,
    parameters,
  );
}

export async function processPaddleEvent(client: pg.PoolClient, event: PaddleEvent, checkoutSecret = ''): Promise<void> {
  const data = event.data;
  if (event.event_type === 'customer.created' || event.event_type === 'customer.updated') {
    const email = (data.email as string | null) ?? null;
    await client.query(
      `insert into paddle_customers (paddle_customer_id, user_id, email)
       values ($1, null, $2)
       on conflict (paddle_customer_id) do update set
         email = coalesce(excluded.email, paddle_customers.email), updated_at = now()`,
      [data.id, email],
    );
    return;
  }

  if (event.event_type.startsWith('subscription.')) {
    const claims = checkoutSecret ? checkoutClaims(data, checkoutSecret) : null;
    await upsertPaddleSubscription(client, data as PaddleSubscriptionData, {
      claims, eventOccurredAt: event.occurred_at,
    });
    return;
  }

  if (event.event_type === 'transaction.completed') {
    const customerId = (data.customer_id as string | null) ?? null;
    const claims = checkoutSecret ? checkoutClaims(data, checkoutSecret) : null;
    if (customerId) {
      await client.query(
        `insert into paddle_customers (paddle_customer_id, user_id, email) values ($1, $2, $3)
         on conflict (paddle_customer_id) do update set
           user_id = coalesce(excluded.user_id, paddle_customers.user_id),
           email = coalesce(excluded.email, paddle_customers.email), updated_at = now()`,
        [customerId, claims?.userId ?? null, claims?.email ?? null],
      );
      await client.query(
        `update subscriptions set user_id = paddle_customers.user_id, updated_at = now()
           from paddle_customers
          where subscriptions.paddle_customer_id = paddle_customers.paddle_customer_id
            and paddle_customers.paddle_customer_id = $1
            and paddle_customers.user_id is not null`,
        [customerId],
      );
    }
    const details = data.details as { totals?: { total?: string; currency_code?: string } } | undefined;
    await client.query(
      `insert into paddle_transactions (
        paddle_transaction_id, paddle_customer_id, paddle_subscription_id, status,
        currency_code, total, occurred_at
      ) values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (paddle_transaction_id) do update set
        paddle_customer_id = excluded.paddle_customer_id,
        paddle_subscription_id = excluded.paddle_subscription_id,
        status = excluded.status, currency_code = excluded.currency_code,
        total = excluded.total, occurred_at = excluded.occurred_at, updated_at = now()`,
      [data.id, customerId, data.subscription_id ?? null, data.status,
        details?.totals?.currency_code ?? data.currency_code ?? null,
        details?.totals?.total ?? null, event.occurred_at],
    );
  }
}

export function paddleApiBase(environment: string | undefined, apiKey: string): string {
  const normalized = environment?.trim().toLowerCase() ?? (apiKey.includes('_live_') ? 'production' : 'sandbox');
  if (normalized === 'production' || normalized === 'live') return 'https://api.paddle.com';
  if (normalized === 'sandbox') return 'https://sandbox-api.paddle.com';
  throw new Error('PADDLE_ENVIRONMENT must be production or sandbox.');
}
