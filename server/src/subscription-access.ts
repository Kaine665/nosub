export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | string;

export interface SubscriptionAccessRecord {
  status: SubscriptionStatus;
  priceIds: readonly string[];
  trialEndsAt: string | Date | null;
  currentPeriodEndsAt: string | Date | null;
}

export function allowedNoSubPriceIds(value = process.env.NOSUB_PRO_PRICE_IDS): ReadonlySet<string> {
  return new Set((value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^pri_[A-Za-z0-9]+$/.test(item)));
}

function time(value: string | Date | null): number | null {
  if (!value) return null;
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function paidAccessGraceMs(value = process.env.PAID_ACCESS_GRACE_HOURS): number {
  const hours = Number(value ?? 72);
  return Number.isFinite(hours) && hours >= 0 ? hours * 60 * 60 * 1000 : 72 * 60 * 60 * 1000;
}

export function hasProAccess(
  subscription: SubscriptionAccessRecord,
  now = new Date(),
  graceMs = paidAccessGraceMs(),
  allowedPriceIds = allowedNoSubPriceIds(),
): boolean {
  if (!subscription.priceIds.some((priceId) => allowedPriceIds.has(priceId))) return false;
  const nowMs = now.getTime();
  if (subscription.status === 'trialing') {
    const trialEndsAt = time(subscription.trialEndsAt);
    return trialEndsAt !== null && nowMs < trialEndsAt;
  }
  if (subscription.status === 'active' || subscription.status === 'past_due') {
    const periodEndsAt = time(subscription.currentPeriodEndsAt);
    return periodEndsAt !== null && nowMs < periodEndsAt + graceMs;
  }
  return false;
}
