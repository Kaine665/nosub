create extension if not exists citext;
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sessions_user_id_idx on sessions(user_id);

create table if not exists paddle_customers (
  paddle_customer_id text primary key,
  user_id uuid references users(id) on delete set null,
  email citext,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists paddle_customers_email_idx on paddle_customers(email);

create table if not exists subscriptions (
  paddle_subscription_id text primary key,
  paddle_customer_id text not null references paddle_customers(paddle_customer_id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  status text not null,
  price_id text not null,
  product_id text not null,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  scheduled_change_action text,
  scheduled_change_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_id_idx on subscriptions(user_id);
create index if not exists subscriptions_customer_id_idx on subscriptions(paddle_customer_id);

create table if not exists paddle_transactions (
  paddle_transaction_id text primary key,
  paddle_customer_id text references paddle_customers(paddle_customer_id) on delete set null,
  paddle_subscription_id text,
  status text not null,
  currency_code text,
  total text,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists paddle_events (
  event_id text primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1,
  last_error text,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
