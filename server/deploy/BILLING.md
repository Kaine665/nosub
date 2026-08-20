# NoSub billing reliability

Paddle is the billing source of truth. NoSub keeps a lean local cache so access
checks do not depend on a live Paddle request.

## Access rules

- `trialing`: Pro only while `trial_ends_at > now()`; missing or expired trial
  end dates fail closed.
- `active`: Pro through `current_period_ends_at` plus the configured paid grace
  period.
- `past_due`: the same bounded paid grace period applies while reconciliation
  confirms Paddle's current state.
- `paused` and `canceled`: no Pro access.

`PAID_ACCESS_GRACE_HOURS` defaults to 72. Trial access never receives a grace
period.

## Synchronization

Webhook updates are deduplicated by `event_id`. Subscription updates compare
the incoming event's `occurred_at` with `last_event_occurred_at`, so an older
event cannot overwrite a newer cached state.

`nosub-billing-reconciliation.timer` runs hourly:

- every `trialing` subscription is checked;
- `active` and `past_due` subscriptions are checked at least daily;
- the current Paddle entity repairs any local drift;
- every run is saved in `billing_reconciliation_runs` and failures produce a
  non-zero service result in the system journal.

The Paddle API key must have the minimum permissions required by the existing
customer portal plus `subscription.read` for reconciliation. Keep the key in
`/opt/nosub/.env`; never put it in source control.

## Operations

```bash
cd /opt/nosub
docker compose exec -T api node dist/reconcile-subscriptions.js --all
systemctl status nosub-billing-reconciliation.timer
journalctl -u nosub-billing-reconciliation.service
curl --fail https://api-nosub.43-130-246-125.sslip.io/health
```

The health response contains only the last aggregate reconciliation result and
never includes customer or subscription identifiers.
