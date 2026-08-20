export interface PaddleSubscriptionItem {
  status?: string;
  trial_dates?: { starts_at?: string; ends_at?: string } | null;
  price?: { id?: string; product_id?: string };
}

export interface PaddleSubscriptionData extends Record<string, unknown> {
  id: string;
  customer_id: string;
  status: string;
  updated_at?: string;
  next_billed_at?: string | null;
  canceled_at?: string | null;
  current_billing_period?: { starts_at?: string; ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
  items?: PaddleSubscriptionItem[];
}

export interface SubscriptionCacheValues {
  subscriptionId: string;
  customerId: string;
  status: string;
  priceId: string;
  productId: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  nextBilledAt: string | null;
  scheduledChangeAction: string | null;
  scheduledChangeAt: string | null;
  canceledAt: string | null;
  paddleUpdatedAt: string | null;
}

function firstDate(items: PaddleSubscriptionItem[], key: 'starts_at' | 'ends_at'): string | null {
  const values = items
    .map((item) => item.trial_dates?.[key])
    .filter((value): value is string => Boolean(value))
    .sort();
  return values[0] ?? null;
}

export function subscriptionCacheValues(data: PaddleSubscriptionData): SubscriptionCacheValues {
  const item = data.items?.[0];
  const priceId = item?.price?.id;
  const productId = item?.price?.product_id;
  if (!data.id || !data.customer_id || !priceId || !productId) {
    throw new Error('Paddle subscription has no subscription, customer, price, or product ID.');
  }
  const trialStartedAt = firstDate(data.items ?? [], 'starts_at');
  const itemTrialEndsAt = firstDate(data.items ?? [], 'ends_at');
  return {
    subscriptionId: data.id,
    customerId: data.customer_id,
    status: data.status,
    priceId,
    productId,
    trialStartedAt,
    trialEndsAt: itemTrialEndsAt ?? (data.status === 'trialing' ? data.next_billed_at ?? null : null),
    currentPeriodStartsAt: data.current_billing_period?.starts_at ?? null,
    currentPeriodEndsAt: data.current_billing_period?.ends_at ?? null,
    nextBilledAt: data.next_billed_at ?? null,
    scheduledChangeAction: data.scheduled_change?.action ?? null,
    scheduledChangeAt: data.scheduled_change?.effective_at ?? null,
    canceledAt: data.canceled_at ?? null,
    paddleUpdatedAt: data.updated_at ?? null,
  };
}

export function cacheDiffers(
  current: Record<string, unknown>,
  incoming: SubscriptionCacheValues,
): boolean {
  const pairs: Array<[string, unknown]> = [
    ['status', incoming.status], ['price_id', incoming.priceId], ['product_id', incoming.productId],
    ['trial_started_at', incoming.trialStartedAt], ['trial_ends_at', incoming.trialEndsAt],
    ['current_period_starts_at', incoming.currentPeriodStartsAt],
    ['current_period_ends_at', incoming.currentPeriodEndsAt], ['next_billed_at', incoming.nextBilledAt],
    ['scheduled_change_action', incoming.scheduledChangeAction],
    ['scheduled_change_at', incoming.scheduledChangeAt], ['canceled_at', incoming.canceledAt],
  ];
  return pairs.some(([key, value]) => {
    const existing = current[key];
    if (existing == null || value == null) return existing != value;
    const existingText = existing instanceof Date ? existing.toISOString() : String(existing);
    const existingDate = Date.parse(existingText);
    const incomingDate = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(existingDate) && Number.isFinite(incomingDate)) return existingDate !== incomingDate;
    return existingText !== value;
  });
}
