-- Edge Functions use the service role to process trusted Paddle webhooks.
-- RLS bypass does not replace the underlying table privileges.
grant select, insert, update, delete
  on public.paddle_events,
     public.paddle_customers,
     public.subscriptions,
     public.paddle_transactions
  to service_role;

