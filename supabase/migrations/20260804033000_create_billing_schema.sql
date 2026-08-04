create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.paddle_customers (
  paddle_customer_id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index paddle_customers_email_idx
  on public.paddle_customers (lower(email))
  where email is not null;

create table public.subscriptions (
  paddle_subscription_id text primary key,
  paddle_customer_id text not null references public.paddle_customers(paddle_customer_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
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

create index subscriptions_user_id_idx on public.subscriptions(user_id);
create index subscriptions_customer_id_idx on public.subscriptions(paddle_customer_id);

create table public.paddle_transactions (
  paddle_transaction_id text primary key,
  paddle_customer_id text references public.paddle_customers(paddle_customer_id) on delete set null,
  -- Transactions can arrive before subscription events, so this is intentionally
  -- not a foreign key. The Paddle ID is reconciled when the subscription event arrives.
  paddle_subscription_id text,
  status text not null,
  currency_code text,
  total text,
  occurred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.paddle_events (
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

alter table public.profiles enable row level security;
alter table public.paddle_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.paddle_transactions enable row level security;
alter table public.paddle_events enable row level security;

create policy "Users can read their profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their Paddle customer"
  on public.paddle_customers for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their subscriptions"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their transactions"
  on public.paddle_transactions for select
  to authenticated
  using (
    exists (
      select 1
      from public.paddle_customers customer
      where customer.paddle_customer_id = paddle_transactions.paddle_customer_id
        and customer.user_id = auth.uid()
    )
  );

revoke all on public.paddle_events from anon, authenticated;
grant select on public.profiles, public.paddle_customers, public.subscriptions, public.paddle_transactions to authenticated;

create or replace function public.sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (user_id, email, updated_at)
  values (new.id, new.email, now())
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();

  update public.paddle_customers
    set user_id = new.id,
        updated_at = now()
    where user_id is null
      and email is not null
      and lower(email) = lower(new.email);

  update public.subscriptions subscription
    set user_id = new.id,
        updated_at = now()
    from public.paddle_customers customer
    where subscription.paddle_customer_id = customer.paddle_customer_id
      and customer.user_id = new.id
      and subscription.user_id is distinct from new.id;

  return new;
end;
$$;

create trigger on_auth_user_synced
  after insert or update of email on auth.users
  for each row execute function public.sync_auth_user();

create or replace function public.link_paddle_customer(
  p_customer_id text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  matched_user_id uuid;
begin
  select id into matched_user_id
  from auth.users
  where p_email is not null and lower(email) = lower(p_email)
  order by created_at asc
  limit 1;

  insert into public.paddle_customers (
    paddle_customer_id,
    user_id,
    email,
    updated_at
  ) values (
    p_customer_id,
    matched_user_id,
    p_email,
    now()
  )
  on conflict (paddle_customer_id) do update
    set user_id = coalesce(excluded.user_id, paddle_customers.user_id),
        email = coalesce(excluded.email, paddle_customers.email),
        updated_at = now();

  update public.subscriptions
    set user_id = matched_user_id,
        updated_at = now()
    where paddle_customer_id = p_customer_id
      and matched_user_id is not null;

  return matched_user_id;
end;
$$;

revoke all on function public.link_paddle_customer(text, text) from public, anon, authenticated;
grant execute on function public.link_paddle_customer(text, text) to service_role;

create or replace function public.has_pro_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions
    where user_id = auth.uid()
      and status in ('active', 'trialing')
  );
$$;

revoke all on function public.has_pro_access() from public, anon;
grant execute on function public.has_pro_access() to authenticated;

comment on function public.has_pro_access() is
  'Returns whether the signed-in user currently has an active or trialing NoSub Pro subscription.';
