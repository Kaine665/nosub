import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { createSession, pool, userForAccessToken, type UserRecord } from './database.js';
import { paddleApiBase, processPaddleEvent, type PaddleEvent } from './paddle.js';
import { parseAnalyticsEvent, parseAnonymousId } from './analytics.js';
import { verifyGoogleAccessToken } from './google-auth.js';
import { hashToken, newToken, signCheckoutToken, verifyPaddleSignature } from './security.js';
import { allowedNoSubPriceIds, hasProAccess } from './subscription-access.js';

interface JsonEnvelope {
  raw: string;
  value: unknown;
}

function jsonBody(request: FastifyRequest): Record<string, unknown> {
  const value = (request.body as JsonEnvelope | undefined)?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON body.');
  return value as Record<string, unknown>;
}

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  return value?.replace(/^Bearer\s+/i, '') || null;
}

function checkoutSecret(): string {
  const secret = process.env.CHECKOUT_LINK_SECRET || process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Checkout account linking is not configured yet.');
  return secret;
}

async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

const app = Fastify({ logger: true, bodyLimit: 256 * 1024 });

app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
  try {
    const raw = body as string;
    done(null, { raw, value: JSON.parse(raw) } satisfies JsonEnvelope);
  } catch (error) {
    done(error as Error, undefined);
  }
});

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('access-control-allow-origin', '*');
  reply.header('access-control-allow-headers', 'authorization, content-type');
  reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
  reply.header('x-content-type-options', 'nosniff');
  return payload;
});
await app.register(rateLimit, { global: false });
app.options('/*', async (_request, reply) => reply.code(204).send());

app.get('/health', async () => {
  await pool.query('select 1');
  const reconciliation = await pool.query<{
    status: string; started_at: string; finished_at: string | null; failed_count: number;
  }>(
    `select status, started_at, finished_at, failed_count
       from billing_reconciliation_runs order by started_at desc limit 1`,
  ).catch(() => ({ rows: [] as Array<{
    status: string; started_at: string; finished_at: string | null; failed_count: number;
  }> }));
  return { ok: true, billingReconciliation: reconciliation.rows[0] ?? null };
});

app.post('/v1/analytics/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
  try {
    const event = parseAnalyticsEvent(jsonBody(request));
    await pool.query(
      `insert into analytics_events (
        event_name, anonymous_id, path, referrer_host, utm_source, utm_medium, utm_campaign
      ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [event.eventName, event.anonymousId, event.path, event.referrerHost,
        event.utmSource, event.utmMedium, event.utmCampaign],
    );
    return reply.code(202).send({ accepted: true });
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid analytics event.' });
  }
});

app.post('/v1/analytics/identity', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
  const token = bearer(request);
  const user = token ? await userForAccessToken(token) : null;
  if (!user) return reply.code(401).send({ error: 'Sign in before linking this installation.' });
  try {
    const anonymousId = parseAnonymousId(jsonBody(request).anonymous_id);
    await pool.query(
      `insert into analytics_identities (anonymous_id, user_id)
       values ($1, $2) on conflict (anonymous_id, user_id) do nothing`,
      [anonymousId, user.id],
    );
    return reply.code(204).send();
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid identity link.' });
  }
});

app.post('/v1/auth/google', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
  try {
    const body = jsonBody(request);
    const googleAccessToken = typeof body.google_access_token === 'string' ? body.google_access_token : '';
    const identity = await verifyGoogleAccessToken(googleAccessToken, process.env.GOOGLE_OAUTH_CLIENT_ID ?? '');
    const session = await withTransaction(async (client) => {
      const existing = await client.query<UserRecord>(
        `select id, email::text from users where google_subject = $1 for update`, [identity.subject],
      );
      let user = existing.rows[0];
      if (user) {
        const updated = await client.query<UserRecord>(
          'update users set email = $1, updated_at = now() where id = $2 returning id, email::text',
          [identity.email, user.id],
        );
        user = updated.rows[0]!;
      } else {
        const linked = await client.query<UserRecord>(
          `insert into users (email, google_subject) values ($1, $2)
           on conflict (email) do update set google_subject = excluded.google_subject, updated_at = now()
             where users.google_subject is null or users.google_subject = excluded.google_subject
           returning id, email::text`,
          [identity.email, identity.subject],
        );
        user = linked.rows[0];
        if (!user) throw new Error('This email is already linked to another Google account.');
      }
      return createSession(client, user);
    });
    return reply.send(session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to sign in with Google.';
    const status = message.includes('not configured') ? 503 : 401;
    return reply.code(status).send({ error: message });
  }
});

app.post('/v1/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
  const refreshToken = jsonBody(request).refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) return reply.code(400).send({ error: 'Missing refresh token.' });
  const session = await withTransaction(async (client) => {
    const result = await client.query<UserRecord & { session_id: string }>(
      `select users.id, users.email::text, sessions.id as session_id
         from sessions join users on users.id = sessions.user_id
        where sessions.refresh_token_hash = $1 and sessions.revoked_at is null
          and sessions.refresh_expires_at > now() for update`,
      [hashToken(refreshToken)],
    );
    const record = result.rows[0];
    if (!record) return null;
    const accessToken = newToken();
    const nextRefreshToken = newToken();
    const expiresIn = 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    await client.query(
      `update sessions set access_token_hash = $1, refresh_token_hash = $2,
        access_expires_at = to_timestamp($3), refresh_expires_at = now() + interval '30 days', updated_at = now()
       where id = $4`,
      [hashToken(accessToken), hashToken(nextRefreshToken), expiresAt, record.session_id],
    );
    return { access_token: accessToken, refresh_token: nextRefreshToken, expires_at: expiresAt,
      expires_in: expiresIn, user: { id: record.id, email: record.email } };
  });
  if (!session) return reply.code(401).send({ error: 'Your session has expired. Sign in again.' });
  return session;
});

app.post('/v1/auth/logout', async (request, reply) => {
  const token = bearer(request);
  if (token) await pool.query('update sessions set revoked_at = now() where access_token_hash = $1', [hashToken(token)]);
  return reply.code(204).send();
});

app.get('/v1/account', async (request, reply) => {
  const token = bearer(request);
  const user = token ? await userForAccessToken(token) : null;
  if (!user) return reply.code(401).send({ error: 'Your session has expired. Sign in again.' });
  const result = await pool.query<{
    paddle_subscription_id: string; status: string; price_id: string; price_ids: string[];
    trial_ends_at: string | null; current_period_ends_at: string | null;
    scheduled_change_action: string | null; paddle_last_synced_at: string | null;
  }>(
    `select paddle_subscription_id, status, price_id, price_ids, trial_ends_at, current_period_ends_at,
            scheduled_change_action, paddle_last_synced_at
       from subscriptions
      where user_id = $1 and price_ids && $2::text[]
      order by updated_at desc`, [user.id, [...allowedNoSubPriceIds()]],
  );
  const eligible = result.rows.find((item) => hasProAccess({
    status: item.status, priceIds: item.price_ids, trialEndsAt: item.trial_ends_at,
    currentPeriodEndsAt: item.current_period_ends_at,
  }));
  const row = eligible ?? result.rows[0];
  return {
    user,
    isPro: Boolean(eligible),
    subscription: row ? {
      id: row.paddle_subscription_id, status: row.status, priceId: row.price_id,
      trialEndsAt: row.trial_ends_at,
      currentPeriodEndsAt: row.current_period_ends_at,
      scheduledChangeAction: row.scheduled_change_action,
      paddleLastSyncedAt: row.paddle_last_synced_at,
    } : null,
  };
});

app.post('/v1/billing/portal', async (request, reply) => {
  const token = bearer(request);
  const user = token ? await userForAccessToken(token) : null;
  if (!user) return reply.code(401).send({ error: 'Sign in before managing your subscription.' });
  const allowedPriceIds = [...allowedNoSubPriceIds()];
  if (!allowedPriceIds.length) return reply.code(503).send({ error: 'NoSub Pro plans are not configured yet.' });
  const subscriptions = await pool.query<{ paddle_customer_id: string; paddle_subscription_id: string }>(
    `select paddle_customer_id, paddle_subscription_id
       from subscriptions
      where user_id = $1 and price_ids && $2::text[]
      order by updated_at desc limit 25`,
    [user.id, allowedPriceIds],
  );
  const customer = subscriptions.rows[0];
  if (!customer) return reply.code(404).send({ error: 'No NoSub subscription is linked to this account yet.' });
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) return reply.code(503).send({ error: 'Billing portal is not configured yet.' });
  const paddleResponse = await fetch(
    `${paddleApiBase(process.env.PADDLE_ENVIRONMENT, apiKey)}/customers/${customer.paddle_customer_id}/portal-sessions`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'paddle-version': '1' },
      body: JSON.stringify({
        subscription_ids: subscriptions.rows
          .filter((item) => item.paddle_customer_id === customer.paddle_customer_id)
          .map((item) => item.paddle_subscription_id),
      }),
    },
  );
  const paddleBody = await paddleResponse.json() as {
    data?: { urls?: { general?: { overview?: string } } };
    error?: { detail?: string };
  };
  if (!paddleResponse.ok) return reply.code(502).send({ error: paddleBody.error?.detail ?? 'Paddle portal request failed.' });
  const url = paddleBody.data?.urls?.general?.overview;
  if (!url) return reply.code(502).send({ error: 'Paddle did not return a customer portal URL.' });
  return { url };
});

app.post('/v1/billing/checkout-context', async (request, reply) => {
  const token = bearer(request);
  const user = token ? await userForAccessToken(token) : null;
  if (!user) return reply.code(401).send({ error: 'Sign in before upgrading to NoSub Pro.' });
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  return {
    email: user.email,
    checkout_token: signCheckoutToken({ userId: user.id, email: user.email, expiresAt }, checkoutSecret()),
    expires_at: expiresAt,
  };
});

app.post('/v1/paddle/webhook', async (request, reply) => {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return reply.code(503).send({ error: 'Webhook is not configured yet.' });
  const envelope = request.body as JsonEnvelope;
  const signature = typeof request.headers['paddle-signature'] === 'string' ? request.headers['paddle-signature'] : '';
  if (!verifyPaddleSignature(envelope.raw, signature, secret)) return reply.code(401).send({ error: 'Invalid Paddle signature.' });
  const event = envelope.value as PaddleEvent;
  if (!event?.event_id || !event.event_type || !event.occurred_at || !event.data) {
    return reply.code(400).send({ error: 'Invalid Paddle payload.' });
  }
  try {
    const duplicate = await withTransaction(async (client) => {
      const inserted = await client.query(
        `insert into paddle_events (event_id, event_type, occurred_at, payload)
         values ($1, $2, $3, $4) on conflict (event_id) do nothing returning event_id`,
        [event.event_id, event.event_type, event.occurred_at, event],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{ processing_status: string }>(
          'select processing_status from paddle_events where event_id = $1 for update', [event.event_id],
        );
        if (existing.rows[0]?.processing_status === 'completed') return true;
        await client.query(
          `update paddle_events set processing_status = 'processing', attempts = attempts + 1,
           last_error = null, payload = $2, updated_at = now() where event_id = $1`,
          [event.event_id, event],
        );
      }
      await processPaddleEvent(client, event, checkoutSecret());
      await client.query(
        `update paddle_events set processing_status = 'completed', processed_at = now(), updated_at = now()
         where event_id = $1`, [event.event_id],
      );
      return false;
    });
    return { received: true, duplicate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `update paddle_events set processing_status = 'failed', last_error = $2, updated_at = now()
       where event_id = $1`, [event.event_id, message.slice(0, 1000)],
    );
    request.log.error({ eventId: event.event_id, error: message }, 'Paddle webhook processing failed');
    return reply.code(500).send({ error: 'Webhook processing failed.' });
  }
});

const port = Number(process.env.PORT ?? 3100);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
await app.listen({ host: '0.0.0.0', port });

const shutdown = async (): Promise<void> => {
  await app.close();
  await pool.end();
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
