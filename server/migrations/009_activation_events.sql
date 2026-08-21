do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'analytics_events' and column_name = 'occurred_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'analytics_events' and column_name = 'received_at'
  ) then
    alter table analytics_events rename column occurred_at to received_at;
  end if;
end $$;

alter table analytics_events
  add column if not exists event_id uuid,
  add column if not exists video_session_id uuid,
  add column if not exists occurred_at timestamptz,
  add column if not exists properties jsonb not null default '{}'::jsonb;

update analytics_events
set event_id = gen_random_uuid()
where event_id is null;

update analytics_events
set occurred_at = coalesce(received_at, created_at, now())
where occurred_at is null;

alter table analytics_events
  alter column event_id set not null,
  alter column occurred_at set not null,
  alter column occurred_at set default now();

alter table analytics_events
  drop constraint if exists analytics_events_event_name_check;

alter table analytics_events
  add constraint analytics_events_event_name_check
  check (event_name in (
    'page_view',
    'extension_installed',
    'nosub_started',
    'youtube_opened',
    'listening_started',
    'subtitle_translation_used',
    'google_signed_in',
    'youtube_video_opened',
    'caption_load_succeeded',
    'caption_load_failed',
    'listening_session_started',
    'core_action_completed'
  ));

create unique index if not exists analytics_events_event_id_idx
  on analytics_events(event_id);

drop index if exists analytics_events_occurred_at_idx;
drop index if exists analytics_events_visitor_idx;
drop index if exists analytics_events_name_occurred_at_idx;
drop index if exists analytics_events_country_occurred_at_idx;

create index analytics_events_occurred_at_idx
  on analytics_events(occurred_at);
create index analytics_events_visitor_idx
  on analytics_events(anonymous_id, occurred_at);
create index analytics_events_name_occurred_at_idx
  on analytics_events(event_name, occurred_at);
create index analytics_events_country_occurred_at_idx
  on analytics_events(country_code, occurred_at);
create index analytics_events_video_session_idx
  on analytics_events(video_session_id, occurred_at)
  where video_session_id is not null;
