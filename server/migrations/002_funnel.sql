create table if not exists analytics_events (
  id bigserial primary key,
  event_name text not null check (event_name in ('page_view')),
  anonymous_id uuid not null,
  path text not null,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_occurred_at_idx
  on analytics_events(occurred_at);
create index if not exists analytics_events_visitor_idx
  on analytics_events(anonymous_id, occurred_at);
