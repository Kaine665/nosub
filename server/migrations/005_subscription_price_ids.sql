alter table subscriptions
  add column if not exists price_ids text[] not null default '{}';

update subscriptions
   set price_ids = array[price_id]
 where cardinality(price_ids) = 0;

create index if not exists subscriptions_price_ids_idx
  on subscriptions using gin (price_ids);
