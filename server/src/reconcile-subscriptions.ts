import { pool } from './database.js';
import { paddleApiBase, upsertPaddleSubscription } from './paddle.js';
import {
  cacheDiffers, subscriptionCacheValues, type PaddleSubscriptionData,
} from './paddle-subscription.js';
import { allowedNoSubPriceIds } from './subscription-access.js';

interface Candidate extends Record<string, unknown> {
  paddle_subscription_id: string;
}

interface PaddleResponse {
  data?: PaddleSubscriptionData | PaddleSubscriptionData[];
  error?: { detail?: string };
}

const apiKey = process.env.PADDLE_API_KEY;
if (!apiKey) throw new Error('PADDLE_API_KEY is required for billing reconciliation.');
const apiBase = paddleApiBase(process.env.PADDLE_ENVIRONMENT, apiKey);
const reconcileAll = process.argv.includes('--all');
const allowedPriceIds = [...allowedNoSubPriceIds()];
if (!allowedPriceIds.length) throw new Error('NOSUB_PRO_PRICE_IDS must contain at least one Paddle price ID.');
const runResult = await pool.query<{ id: string }>(
  `insert into billing_reconciliation_runs default values returning id::text`,
);
const runId = runResult.rows[0]!.id;

let checkedCount = 0;
let repairedCount = 0;
const errors: string[] = [];

async function paddleRequest(path: string): Promise<PaddleResponse> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { authorization: `Bearer ${apiKey}`, 'paddle-version': '1' },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as PaddleResponse;
  if (!response.ok) throw new Error(body.error?.detail ?? `Paddle API failed (${response.status}).`);
  return body;
}

try {
  // Validate subscription.read even when the local cache is empty.
  await paddleRequest('/subscriptions?per_page=1');
  const candidates = await pool.query<Candidate>(
    `select * from subscriptions
      where price_ids && $2::text[]
        and ($1::boolean
         or status = 'trialing'
         or (status in ('active', 'past_due')
             and coalesce(paddle_last_synced_at, to_timestamp(0)) < now() - interval '24 hours')
        )
      order by case when status = 'trialing' then 0 else 1 end, paddle_last_synced_at nulls first`,
    [reconcileAll, allowedPriceIds],
  );

  for (const current of candidates.rows) {
    checkedCount += 1;
    try {
      const body = await paddleRequest(`/subscriptions/${current.paddle_subscription_id}`);
      if (!body.data || Array.isArray(body.data)) throw new Error('Paddle returned no subscription data.');
      const differs = cacheDiffers(current, subscriptionCacheValues(body.data));
      const client = await pool.connect();
      try {
        await client.query('begin');
        await upsertPaddleSubscription(client, body.data, { authoritative: true });
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      if (differs) repairedCount += 1;
    } catch (error) {
      errors.push(`${current.paddle_subscription_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const status = errors.length ? 'failed' : 'completed';
await pool.query(
  `update billing_reconciliation_runs
      set finished_at = now(), status = $2, checked_count = $3, repaired_count = $4,
          failed_count = $5, error_summary = $6
    where id = $1`,
  [runId, status, checkedCount, repairedCount, errors.length, errors.join('\n').slice(0, 4000) || null],
);

const summary = { status, checkedCount, repairedCount, failedCount: errors.length, errors };
if (errors.length) {
  console.error(JSON.stringify(summary));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(summary));
}
await pool.end();
