import type pg from 'pg';
import { verifyCheckoutToken, type CheckoutClaims } from './security.js';

export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

interface PaddleItem {
  price?: { id?: string; product_id?: string };
}

function firstPrice(data: Record<string, unknown>): { priceId: string; productId: string } {
  const item = (data.items as PaddleItem[] | undefined)?.[0];
  const priceId = item?.price?.id;
  const productId = item?.price?.product_id;
  if (!priceId || !productId) throw new Error('Paddle event has no price or product ID.');
  return { priceId, productId };
}

function checkoutClaims(data: Record<string, unknown>, secret: string): CheckoutClaims | null {
  const customData = data.custom_data as Record<string, unknown> | null | undefined;
  const token = customData?.nosub_checkout_token;
  return typeof token === 'string' ? verifyCheckoutToken(token, secret) : null;
}

export async function processPaddleEvent(client: pg.PoolClient, event: PaddleEvent, checkoutSecret = ''): Promise<void> {
  const data = event.data;
  if (event.event_type === 'customer.created' || event.event_type === 'customer.updated') {
    const email = (data.email as string | null) ?? null;
    await client.query(
      `insert into paddle_customers (paddle_customer_id, user_id, email)
       values ($1, (select id from users where email = $2::citext order by created_at limit 1), $2)
       on conflict (paddle_customer_id) do update set
         user_id = coalesce(excluded.user_id, paddle_customers.user_id),
         email = coalesce(excluded.email, paddle_customers.email), updated_at = now()`,
      [data.id, email],
    );
    await client.query(
      `update subscriptions set user_id = paddle_customers.user_id, updated_at = now()
         from paddle_customers
        where subscriptions.paddle_customer_id = paddle_customers.paddle_customer_id
          and paddle_customers.paddle_customer_id = $1
          and paddle_customers.user_id is not null`,
      [data.id],
    );
    return;
  }

  if (event.event_type.startsWith('subscription.')) {
    const customerId = data.customer_id as string;
    const claims = checkoutSecret ? checkoutClaims(data, checkoutSecret) : null;
    const { priceId, productId } = firstPrice(data);
    await client.query(
      `insert into paddle_customers (paddle_customer_id, user_id, email) values ($1, $2, $3)
       on conflict (paddle_customer_id) do update set
         user_id = coalesce(excluded.user_id, paddle_customers.user_id),
         email = coalesce(excluded.email, paddle_customers.email), updated_at = now()`,
      [customerId, claims?.userId ?? null, claims?.email ?? null],
    );
    const billingPeriod = data.current_billing_period as { starts_at?: string; ends_at?: string } | null;
    const scheduledChange = data.scheduled_change as { action?: string; effective_at?: string } | null;
    await client.query(
      `insert into subscriptions (
        paddle_subscription_id, paddle_customer_id, user_id, status, price_id, product_id,
        current_period_starts_at, current_period_ends_at, scheduled_change_action,
        scheduled_change_at, canceled_at
      ) values (
        $1, $2, (select user_id from paddle_customers where paddle_customer_id = $2), $3, $4, $5,
        $6, $7, $8, $9, $10
      ) on conflict (paddle_subscription_id) do update set
        paddle_customer_id = excluded.paddle_customer_id,
        user_id = coalesce(excluded.user_id, subscriptions.user_id), status = excluded.status,
        price_id = excluded.price_id, product_id = excluded.product_id,
        current_period_starts_at = excluded.current_period_starts_at,
        current_period_ends_at = excluded.current_period_ends_at,
        scheduled_change_action = excluded.scheduled_change_action,
        scheduled_change_at = excluded.scheduled_change_at,
        canceled_at = excluded.canceled_at, updated_at = now()`,
      [data.id, customerId, data.status, priceId, productId, billingPeriod?.starts_at ?? null,
        billingPeriod?.ends_at ?? null, scheduledChange?.action ?? null,
        scheduledChange?.effective_at ?? null, data.canceled_at ?? null],
    );
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
