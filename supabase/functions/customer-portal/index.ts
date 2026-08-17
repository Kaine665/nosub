import { createClient } from 'npm:@supabase/supabase-js@2';
import { paddleApiBase } from '../_shared/paddle-environment.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type',
  'content-type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function namedKey(envName: string, preferred: string[]): string {
  const raw = requiredEnv(envName);
  const keys = JSON.parse(raw) as Record<string, string>;
  for (const name of preferred) if (keys[name]) return keys[name];
  const first = Object.values(keys)[0];
  if (!first) throw new Error(`${envName} is empty.`);
  return first;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization');
  const jwt = authorization?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in before managing your subscription.' }, 401);

  try {
    const url = requiredEnv('SUPABASE_URL');
    const publishable = namedKey('SUPABASE_PUBLISHABLE_KEYS', ['default', 'anon']);
    const secret = namedKey('SUPABASE_SECRET_KEYS', ['default', 'service_role', 'secret']);
    const authClient = createClient(url, publishable, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(jwt);
    if (userError || !userData.user) return json({ error: 'Your session has expired. Sign in again.' }, 401);

    const admin = createClient(url, secret, { auth: { persistSession: false } });
    const { data: customer, error: customerError } = await admin
      .from('paddle_customers')
      .select('paddle_customer_id')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (customerError) throw customerError;
    if (!customer) return json({ error: 'No Paddle subscription is linked to this account yet.' }, 404);

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from('subscriptions')
      .select('paddle_subscription_id')
      .eq('user_id', userData.user.id)
      .limit(25);
    if (subscriptionsError) throw subscriptionsError;

    const paddleApiKey = requiredEnv('PADDLE_API_KEY');
    const paddleResponse = await fetch(
      `${paddleApiBase(Deno.env.get('PADDLE_ENVIRONMENT'), paddleApiKey)}/customers/${customer.paddle_customer_id}/portal-sessions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${paddleApiKey}`,
          'content-type': 'application/json',
          'paddle-version': '1',
        },
        body: JSON.stringify({
          subscription_ids: (subscriptions ?? []).map((item) => item.paddle_subscription_id),
        }),
      },
    );
    const paddleBody = await paddleResponse.json() as {
      data?: { urls?: { general?: { overview?: string } } };
      error?: { detail?: string };
    };
    if (!paddleResponse.ok) throw new Error(paddleBody.error?.detail ?? `Paddle request failed (${paddleResponse.status}).`);
    const portalUrl = paddleBody.data?.urls?.general?.overview;
    if (!portalUrl) throw new Error('Paddle did not return a customer portal URL.');
    return json({ url: portalUrl });
  } catch (error) {
    console.error('Customer portal session failed', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
