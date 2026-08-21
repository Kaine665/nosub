# NoSub conversion funnel

The production funnel combines three sources:

1. Chrome Web Store page views and installs, entered with `--store-views` and `--store-installs`.
2. First-party `page_view`, `extension_installed`, `youtube_opened`, `listening_started`,
   `subtitle_translation_used`, and `google_signed_in` events stored in
   `analytics_events` under a stable installation-scoped `anonymous_id`.
3. Google sign-in links stored in `analytics_identities`. The server derives
   `user_id` from a valid NoSub session; email addresses never establish the link.
4. Registrations, Paddle subscription events, and completed Paddle transactions in PostgreSQL.

The extension records its version and `production`/`development` environment. The server's
receive time is the authoritative event date. It never receives a YouTube video ID, title,
subtitle text, or browsing URL; product events use fixed paths.

The extension sends its BCP 47 browser language. The API resolves the source IP against a local
GeoLite2 database and stores only the resulting two-letter country code. Raw source IP addresses
are not stored in `analytics_events` or routine API access logs. The weekly report groups each
new anonymous installation by its first reported country and browser language.

`analytics_identities` is the explicit bridge from an anonymous installation to a signed-in
NoSub user. Paddle subscriptions remain linked to that user, never to an IP address or guessed email.

Generate a weekly Markdown report on the production server:

```bash
cd /opt/nosub
sudo docker compose exec -T api npm run report:funnel -- \
  --from 2026-08-10 --to 2026-08-16 --store-views 15 --store-installs 20
```

Use an output path to save the report:

```bash
npm run report:funnel -- --from 2026-08-10 --to 2026-08-16 \
  --store-views 15 --store-installs 20 --output /tmp/nosub-funnel.md
```

The trial row is omitted when there are no real `trialing` Paddle events. A cancellation is counted as churn only when Paddle emits `subscription.canceled`, not when a cancellation is merely scheduled.

Chrome Web Store installs and NoSub's distinct `extension_installed` events are intentionally
shown side by side. They need not be identical; a large gap is a diagnostic signal for offline
installs, failed delivery, old extension versions, or mismatched time zones/reporting windows.
