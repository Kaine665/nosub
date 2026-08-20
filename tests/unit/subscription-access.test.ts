import { describe, expect, it, vi } from 'vitest';
import { processPaddleEvent, upsertPaddleSubscription } from '../../server/src/paddle.js';
import { allowedNoSubPriceIds, hasProAccess, paidAccessGraceMs } from '../../server/src/subscription-access.js';
import { cacheDiffers, subscriptionCacheValues } from '../../server/src/paddle-subscription.js';

const now = new Date('2026-08-27T00:00:00.000Z');
const officialPrices = new Set(['pri_official_month', 'pri_official_year']);

describe('subscription access safety', () => {
  it('trialing only grants access before the explicit trial end', () => {
    expect(hasProAccess({
      status: 'trialing', priceIds: ['pri_official_month'],
      trialEndsAt: '2026-08-27T00:00:01Z', currentPeriodEndsAt: null,
    }, now, 0, officialPrices)).toBe(true);
    expect(hasProAccess({
      status: 'trialing', priceIds: ['pri_official_month'],
      trialEndsAt: '2026-08-27T00:00:00Z', currentPeriodEndsAt: null,
    }, now, 0, officialPrices)).toBe(false);
  });

  it('fails closed when a trial has no trustworthy end time', () => {
    expect(hasProAccess({
      status: 'trialing', priceIds: ['pri_official_month'], trialEndsAt: null, currentPeriodEndsAt: null,
    }, now, 0, officialPrices)).toBe(false);
  });

  it('gives paid subscriptions a bounded grace period', () => {
    const record = {
      status: 'active', priceIds: ['pri_official_month'],
      trialEndsAt: null, currentPeriodEndsAt: '2026-08-26T00:00:00Z',
    };
    expect(hasProAccess(record, now, 48 * 60 * 60 * 1000, officialPrices)).toBe(true);
    expect(hasProAccess(
      record, new Date('2026-08-28T00:00:00Z'), 48 * 60 * 60 * 1000, officialPrices,
    )).toBe(false);
  });

  it('allows past_due only inside the same bounded paid grace period', () => {
    expect(hasProAccess({
      status: 'past_due', priceIds: ['pri_official_year'],
      trialEndsAt: null, currentPeriodEndsAt: '2026-08-26T12:00:00Z',
    }, now, 24 * 60 * 60 * 1000, officialPrices)).toBe(true);
    expect(hasProAccess({
      status: 'past_due', priceIds: ['pri_official_year'],
      trialEndsAt: null, currentPeriodEndsAt: '2026-08-25T23:59:59Z',
    }, now, 24 * 60 * 60 * 1000, officialPrices)).toBe(false);
  });

  it('never grants paused or canceled access', () => {
    for (const status of ['paused', 'canceled']) {
      expect(hasProAccess({
        status, priceIds: ['pri_official_month'],
        trialEndsAt: '2099-01-01T00:00:00Z', currentPeriodEndsAt: '2099-01-01T00:00:00Z',
      }, now, 0, officialPrices)).toBe(false);
    }
  });

  it('never grants an active subscription for another product or an empty whitelist', () => {
    const record = {
      status: 'active', priceIds: ['pri_other_project'], trialEndsAt: null,
      currentPeriodEndsAt: '2099-01-01T00:00:00Z',
    };
    expect(hasProAccess(record, now, 0, officialPrices)).toBe(false);
    expect(hasProAccess({ ...record, priceIds: ['pri_official_month', 'pri_other_project'] }, now, 0, officialPrices))
      .toBe(true);
    expect(hasProAccess(record, now, 0, new Set())).toBe(false);
  });

  it('parses only valid Paddle price IDs from configuration', () => {
    expect([...allowedNoSubPriceIds(' pri_month , invalid, pri_year, pri_month ')])
      .toEqual(['pri_month', 'pri_year']);
  });

  it('defaults invalid grace configuration to 72 hours', () => {
    expect(paidAccessGraceMs('invalid')).toBe(72 * 60 * 60 * 1000);
    expect(paidAccessGraceMs('-1')).toBe(72 * 60 * 60 * 1000);
  });
});

describe('Paddle subscription cache', () => {
  it('uses item trial_dates as the authoritative trial window', () => {
    const values = subscriptionCacheValues({
      id: 'sub_1', customer_id: 'ctm_1', status: 'trialing', updated_at: '2026-08-20T00:00:00Z',
      next_billed_at: '2026-08-29T00:00:00Z',
      items: [{
        status: 'trialing',
        trial_dates: { starts_at: '2026-08-20T00:00:00Z', ends_at: '2026-08-27T00:00:00Z' },
        price: { id: 'pri_1', product_id: 'pro_1' },
      }],
    });
    expect(values.trialStartedAt).toBe('2026-08-20T00:00:00Z');
    expect(values.trialEndsAt).toBe('2026-08-27T00:00:00Z');
    expect(values.priceIds).toEqual(['pri_1']);
  });

  it('keeps every distinct price ID from a multi-item subscription', () => {
    const values = subscriptionCacheValues({
      id: 'sub_1', customer_id: 'ctm_1', status: 'active',
      items: [
        { price: { id: 'pri_addon', product_id: 'pro_addon' } },
        { price: { id: 'pri_official_month', product_id: 'pro_1' } },
        { price: { id: 'pri_addon', product_id: 'pro_addon' } },
      ],
    });
    expect(values.priceId).toBe('pri_addon');
    expect(values.priceIds).toEqual(['pri_addon', 'pri_official_month']);
  });

  it('uses next_billed_at only as a trial compatibility fallback', () => {
    const trial = subscriptionCacheValues({
      id: 'sub_1', customer_id: 'ctm_1', status: 'trialing', next_billed_at: '2026-08-27T00:00:00Z',
      items: [{ price: { id: 'pri_1', product_id: 'pro_1' } }],
    });
    const active = subscriptionCacheValues({
      id: 'sub_2', customer_id: 'ctm_1', status: 'active', next_billed_at: '2026-09-27T00:00:00Z',
      items: [{ price: { id: 'pri_1', product_id: 'pro_1' } }],
    });
    expect(trial.trialEndsAt).toBe('2026-08-27T00:00:00Z');
    expect(active.trialEndsAt).toBeNull();
  });

  it('does not report drift for equivalent timestamp formats', () => {
    const incoming = subscriptionCacheValues({
      id: 'sub_1', customer_id: 'ctm_1', status: 'active',
      current_billing_period: { starts_at: '2026-08-20T00:00:00Z', ends_at: '2026-09-20T00:00:00Z' },
      items: [{ price: { id: 'pri_1', product_id: 'pro_1' } }],
    });
    expect(cacheDiffers({
      status: 'active', price_id: 'pri_1', product_id: 'pro_1',
      price_ids: ['pri_1'],
      trial_started_at: null, trial_ends_at: null,
      current_period_starts_at: new Date('2026-08-20T00:00:00.000Z'),
      current_period_ends_at: new Date('2026-09-20T00:00:00.000Z'),
      next_billed_at: null, scheduled_change_action: null, scheduled_change_at: null, canceled_at: null,
    }, incoming)).toBe(false);
  });

  it('guards webhook writes against older out-of-order events', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as unknown as Parameters<typeof upsertPaddleSubscription>[0];
    await upsertPaddleSubscription(client, {
      id: 'sub_1', customer_id: 'ctm_1', status: 'trialing',
      next_billed_at: '2026-08-27T00:00:00Z',
      items: [{ price: { id: 'pri_1', product_id: 'pro_1' } }],
    }, { eventOccurredAt: '2026-08-20T00:00:00Z' });
    const subscriptionQuery = query.mock.calls[1] as [string, unknown[]];
    expect(subscriptionQuery[0]).toContain('excluded.last_event_occurred_at >= subscriptions.last_event_occurred_at');
    expect(subscriptionQuery[1][15]).toBe('2026-08-20T00:00:00Z');
  });

  it('lets authoritative reconciliation repair state regardless of webhook order', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as unknown as Parameters<typeof upsertPaddleSubscription>[0];
    await upsertPaddleSubscription(client, {
      id: 'sub_1', customer_id: 'ctm_1', status: 'active',
      current_billing_period: { starts_at: '2026-08-20T00:00:00Z', ends_at: '2026-09-20T00:00:00Z' },
      items: [{ price: { id: 'pri_1', product_id: 'pro_1' } }],
    }, { authoritative: true });
    const subscriptionQuery = query.mock.calls[1] as [string, unknown[]];
    expect(subscriptionQuery[0]).not.toContain('excluded.last_event_occurred_at >= subscriptions.last_event_occurred_at');
  });

  it('does not link a Paddle customer to a NoSub user by matching email alone', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const client = { query } as unknown as Parameters<typeof processPaddleEvent>[0];
    await processPaddleEvent(client, {
      event_id: 'evt_1', event_type: 'customer.created', occurred_at: '2026-08-20T00:00:00Z',
      data: { id: 'ctm_other', email: 'same@example.com' },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('values ($1, null, $2)');
    expect(query.mock.calls[0]?.[0]).not.toContain('select id from users');
  });
});
