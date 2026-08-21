alter table analytics_events
  add column if not exists country_code char(2),
  add column if not exists browser_language text;

alter table analytics_events
  drop constraint if exists analytics_events_country_code_check;

alter table analytics_events
  add constraint analytics_events_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

create index if not exists analytics_events_country_occurred_at_idx
  on analytics_events(country_code, occurred_at);
