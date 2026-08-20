alter table subscriptions
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists next_billed_at timestamptz,
  add column if not exists paddle_updated_at timestamptz,
  add column if not exists paddle_last_synced_at timestamptz,
  add column if not exists last_event_occurred_at timestamptz;

create index if not exists subscriptions_reconciliation_idx
  on subscriptions (status, paddle_last_synced_at);

create table if not exists billing_reconciliation_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  checked_count integer not null default 0,
  repaired_count integer not null default 0,
  failed_count integer not null default 0,
  error_summary text
);

create index if not exists billing_reconciliation_runs_started_at_idx
  on billing_reconciliation_runs (started_at desc);
