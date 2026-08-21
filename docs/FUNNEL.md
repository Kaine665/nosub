# NoSub conversion funnel

The production funnel combines three sources:

1. Chrome Web Store page views, entered into the report with `--store-views`.
2. First-party `page_view`, `extension_installed`, and `nosub_started` events stored in
   `analytics_events` under a stable installation-scoped `anonymous_id`.
3. Google sign-in links stored in `analytics_identities`. The server derives
   `user_id` from a valid NoSub session; email addresses never establish the link.
4. Registrations, Paddle subscription events, and completed Paddle transactions in PostgreSQL.

The extension never sends a YouTube video ID or browsing URL with product activity.
`nosub_started` uses the fixed path `/youtube/watch`.

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
