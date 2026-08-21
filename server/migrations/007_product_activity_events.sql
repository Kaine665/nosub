alter table analytics_events
  add column if not exists app_version text,
  add column if not exists environment text;

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
    'google_signed_in'
  ));

alter table analytics_events
  drop constraint if exists analytics_events_environment_check;

alter table analytics_events
  add constraint analytics_events_environment_check
  check (environment is null or environment in ('production', 'development'));

create index if not exists analytics_events_name_occurred_at_idx
  on analytics_events(event_name, occurred_at);
