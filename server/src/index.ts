import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { createSession, pool, userForAccessToken, type UserRecord } from './database.js';
import { paddleApiBase, processPaddleEvent, type PaddleEvent } from './paddle.js';
import { parseAnalyticsEvent } from './analytics.js';
import { hashPassword, hashToken, newToken, signCheckoutToken, verifyPaddleSignature, verifyPassword } from './security.js';

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

function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

function validPassword(value: unknown): string {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (password.length > 200) throw new Error('Password is too long.');
  return password;
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
  return { ok: true };
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

app.post('/v1/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  try {
    const body = jsonBody(request);
    const email = normalizeEmail(body.email);
    const passwordHash = await hashPassword(validPassword(body.password));
    const session = await withTransaction(async (client) => {
      const result = await client.query<UserRecord>(
        'insert into users (email, password_hash) values ($1, $2) returning id, email::text',
        [email, passwordHash],
      );
      return createSession(client, result.rows[0]!);
    });
    return reply.code(201).send(session);
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') return reply.code(409).send({ error: 'An account with this email already exists.' });
    return reply.code(400).send({ error: error instanceof Error ? error.message : 'Unable to create account.' });
  }
});

app.post('/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
  const body = jsonBody(request);
  const email = normalizeEmail(body.email);
  const password = validPassword(body.password);
  const result = await pool.query<UserRecord & { password_hash: string }>(
    'select id, email::text, password_hash from users where email = $1', [email],
  );
  const record = result.rows[0];
  if (!record || !await verifyPassword(password, record.password_hash)) {
    return reply.code(401).send({ error: 'Invalid email or password.' });
  }
  const session = await withTransaction((client) => createSession(client, { id: record.id, email: record.email }));
  return session;
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
    paddle_subscription_id: string; status: string; price_id: string;
    current_period_ends_at: string | null; scheduled_change_action: string | null;
  }>(
    `select paddle_subscription_id, status, price_id, current_period_ends_at, scheduled_change_action
       from subscriptions where user_id = $1 order by updated_at desc limit 1`, [user.id],
  );
  const row = result.rows[0];
  return {
    user,
    isPro: row?.status === 'active' || row?.status === 'trialing',
    subscription: row ? {
      id: row.paddle_subscription_id, status: row.status, priceId: row.price_id,
      currentPeriodEndsAt: row.current_period_ends_at,
      scheduledChangeAction: row.scheduled_change_action,
    } : null,
  };
});

app.post('/v1/billing/portal', async (request, reply) => {
  const token = bearer(request);
  const user = token ? await userForAccessToken(token) : null;
  if (!user) return reply.code(401).send({ error: 'Sign in before managing your subscription.' });
  const customerResult = await pool.query<{ paddle_customer_id: string }>(
    'select paddle_customer_id from paddle_customers where user_id = $1 limit 1', [user.id],
  );
  const customer = customerResult.rows[0];
  if (!customer) return reply.code(404).send({ error: 'No Paddle subscription is linked to this account yet.' });
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) return reply.code(503).send({ error: 'Billing portal is not configured yet.' });
  const subscriptions = await pool.query<{ paddle_subscription_id: string }>(
    'select paddle_subscription_id from subscriptions where user_id = $1 limit 25', [user.id],
  );
  const paddleResponse = await fetch(
    `${paddleApiBase(process.env.PADDLE_ENVIRONMENT, apiKey)}/customers/${customer.paddle_customer_id}/portal-sessions`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'paddle-version': '1' },
      body: JSON.stringify({ subscription_ids: subscriptions.rows.map((item) => item.paddle_subscription_id) }),
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
