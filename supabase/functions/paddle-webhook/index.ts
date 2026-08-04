import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyPaddleSignature } from '../_shared/paddle-signature.ts';

type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: Record<string, unknown>;
};

type PaddleItem = {
  price?: {
    id?: string;
    product_id?: string;
  };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function serviceRoleKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;

  const rawKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!rawKeys) throw new Error('Missing Supabase secret key environment variable.');
  const keys = JSON.parse(rawKeys) as Record<string, string>;
  const key = keys.service_role ?? keys.secret ?? Object.values(keys)[0];
  if (!key) throw new Error('Supabase secret key dictionary is empty.');
  return key;
}

function firstPrice(data: Record<string, unknown>): { priceId: string; productId: string } {
  const item = (data.items as PaddleItem[] | undefined)?.[0];
  const priceId = item?.price?.id;
  const productId = item?.price?.product_id;
  if (!priceId || !productId) throw new Error('Paddle event has no price or product ID.');
  return { priceId, productId };
}

async function processEvent(
  event: PaddleEvent,
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  const data = event.data;

  if (event.event_type === 'customer.created' || event.event_type === 'customer.updated') {
    const { error } = await supabase.rpc('link_paddle_customer', {
      p_customer_id: data.id as string,
      p_email: (data.email as string | null) ?? null,
    });
    if (error) throw error;
    return;
  }

  if (event.event_type.startsWith('subscription.')) {
    const customerId = data.customer_id as string;
    const subscriptionId = data.id as string;
    const { priceId, productId } = firstPrice(data);

    const { error: customerError } = await supabase
      .from('paddle_customers')
      .upsert({ paddle_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: 'paddle_customer_id' });
    if (customerError) throw customerError;

    const { data: customer, error: lookupError } = await supabase
      .from('paddle_customers')
      .select('user_id')
      .eq('paddle_customer_id', customerId)
      .single();
    if (lookupError) throw lookupError;

    const billingPeriod = data.current_billing_period as { starts_at?: string; ends_at?: string } | null;
    const scheduledChange = data.scheduled_change as { action?: string; effective_at?: string } | null;
    const { error } = await supabase.from('subscriptions').upsert({
      paddle_subscription_id: subscriptionId,
      paddle_customer_id: customerId,
      user_id: customer?.user_id ?? null,
      status: data.status as string,
      price_id: priceId,
      product_id: productId,
      current_period_starts_at: billingPeriod?.starts_at ?? null,
      current_period_ends_at: billingPeriod?.ends_at ?? null,
      scheduled_change_action: scheduledChange?.action ?? null,
      scheduled_change_at: scheduledChange?.effective_at ?? null,
      canceled_at: (data.canceled_at as string | null) ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'paddle_subscription_id' });
    if (error) throw error;
    return;
  }

  if (event.event_type === 'transaction.completed') {
    const customerId = (data.customer_id as string | null) ?? null;
    const subscriptionId = (data.subscription_id as string | null) ?? null;
    const details = data.details as { totals?: { total?: string; currency_code?: string } } | undefined;

    if (customerId) {
      const { error: customerError } = await supabase
        .from('paddle_customers')
        .upsert({ paddle_customer_id: customerId, updated_at: new Date().toISOString() }, { onConflict: 'paddle_customer_id' });
      if (customerError) throw customerError;
    }

    const { error } = await supabase.from('paddle_transactions').upsert({
      paddle_transaction_id: data.id as string,
      paddle_customer_id: customerId,
      paddle_subscription_id: subscriptionId,
      status: data.status as string,
      currency_code: details?.totals?.currency_code ?? (data.currency_code as string | null) ?? null,
      total: details?.totals?.total ?? null,
      occurred_at: event.occurred_at,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'paddle_transaction_id' });
    if (error) throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const rawBody = await request.text();
  const signature = request.headers.get('paddle-signature') ?? '';
  const webhookSecret = requiredEnv('PADDLE_WEBHOOK_SECRET');

  if (!await verifyPaddleSignature(rawBody, signature, webhookSecret)) {
    return json({ error: 'Invalid Paddle signature' }, 401);
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
    if (!event.event_id || !event.event_type || !event.occurred_at || !event.data) {
      throw new Error('Missing required webhook fields.');
    }
  } catch {
    return json({ error: 'Invalid Paddle payload' }, 400);
  }

  const supabase = createClient(requiredEnv('SUPABASE_URL'), serviceRoleKey(), {
    auth: { persistSession: false },
  });

  const { data: existing } = await supabase
    .from('paddle_events')
    .select('processing_status, attempts')
    .eq('event_id', event.event_id)
    .maybeSingle();
  if (existing?.processing_status === 'completed') {
    return json({ received: true, duplicate: true });
  }

  const { error: eventError } = await supabase.from('paddle_events').upsert({
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    processing_status: 'processing',
    attempts: (existing?.attempts ?? 0) + 1,
    last_error: null,
    payload: event,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (eventError) {
    console.error('Unable to record Paddle event', event.event_id, eventError);
    return json({ error: 'Unable to record event' }, 500);
  }

  try {
    await processEvent(event, supabase);
    const { error } = await supabase.from('paddle_events').update({
      processing_status: 'completed',
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('event_id', event.event_id);
    if (error) throw error;
    return json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('paddle_events').update({
      processing_status: 'failed',
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).eq('event_id', event.event_id);
    console.error('Paddle webhook processing failed', event.event_id, message);
    return json({ error: 'Webhook processing failed' }, 500);
  }
});
