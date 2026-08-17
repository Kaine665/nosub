# NoSub conversion funnel

The production funnel combines three sources:

1. Chrome Web Store page views, entered into the report with `--store-views`.
2. First-party pricing-page `page_view` events stored in `analytics_events`.
3. Registrations, Paddle subscription events, and completed Paddle transactions in PostgreSQL.

Generate a weekly Markdown report on the production server:

```bash
cd /opt/nosub
sudo docker compose exec -T api npm run report:funnel -- \
  --from 2026-08-10 --to 2026-08-16 --store-views 15
```

Use an output path to save the report:

```bash
npm run report:funnel -- --from 2026-08-10 --to 2026-08-16 \
  --store-views 15 --output /tmp/nosub-funnel.md
```

The trial row is omitted when there are no real `trialing` Paddle events. A cancellation is counted as churn only when Paddle emits `subscription.canceled`, not when a cancellation is merely scheduled.
