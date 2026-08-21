alter table analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table analytics_events
  add constraint analytics_events_event_name_check
  check (event_name in ('page_view', 'extension_installed', 'nosub_started'));

create table if not exists analytics_identities (
  anonymous_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (anonymous_id, user_id)
);

create index if not exists analytics_identities_user_idx
  on analytics_identities(user_id, linked_at);
