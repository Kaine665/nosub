import { writeFile } from 'node:fs/promises';
import { pool } from './database.js';

interface FunnelRow {
  price_page_views: string;
  price_page_visitors: string;
  registrations: string;
  trials: string;
  first_payments: string;
  first_payment_amount: string;
  renewals: string;
  renewal_amount: string;
  churned: string;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : '—';
}

const now = new Date();
const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const from = option('--from') ?? isoDate(defaultFrom);
const to = option('--to') ?? isoDate(now);
const output = option('--output');
const storeViews = Number(option('--store-views') ?? 0);

if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  throw new Error('Use YYYY-MM-DD for --from and --to.');
}

const result = await pool.query<FunnelRow>(
  `with bounds as (
     select $1::date as starts_at, ($2::date + interval '1 day') as ends_at
   ),
   ranked_payments as (
     select t.*,
       row_number() over (
         partition by coalesce(t.paddle_subscription_id, t.paddle_customer_id, t.paddle_transaction_id)
         order by t.occurred_at, t.created_at, t.paddle_transaction_id
       ) as payment_number
     from paddle_transactions t
     where t.status = 'completed'
   ),
   first_trial as (
     select data->>'customer_id' as customer_id, min(occurred_at) as started_at
     from (
       select occurred_at, payload->'data' as data
       from paddle_events
       where event_type like 'subscription.%'
         and payload->'data'->>'status' = 'trialing'
         and processing_status = 'completed'
     ) trial_events
     group by data->>'customer_id'
   )
   select
     (select count(*) from analytics_events, bounds
       where event_name = 'page_view' and occurred_at >= starts_at and occurred_at < ends_at)::text as price_page_views,
     (select count(distinct anonymous_id) from analytics_events, bounds
       where event_name = 'page_view' and occurred_at >= starts_at and occurred_at < ends_at)::text as price_page_visitors,
     (select count(*) from users, bounds
       where created_at >= starts_at and created_at < ends_at)::text as registrations,
     (select count(*) from first_trial, bounds
       where started_at >= starts_at and started_at < ends_at)::text as trials,
     (select count(*) from ranked_payments, bounds
       where payment_number = 1 and occurred_at >= starts_at and occurred_at < ends_at)::text as first_payments,
     (select coalesce(sum(total::numeric), 0) / 100 from ranked_payments, bounds
       where payment_number = 1 and occurred_at >= starts_at and occurred_at < ends_at)::text as first_payment_amount,
     (select count(*) from ranked_payments, bounds
       where payment_number > 1 and occurred_at >= starts_at and occurred_at < ends_at)::text as renewals,
     (select coalesce(sum(total::numeric), 0) / 100 from ranked_payments, bounds
       where payment_number > 1 and occurred_at >= starts_at and occurred_at < ends_at)::text as renewal_amount,
     (select count(distinct payload->'data'->>'id') from paddle_events, bounds
       where event_type = 'subscription.canceled' and processing_status = 'completed'
         and occurred_at >= starts_at and occurred_at < ends_at)::text as churned`,
  [from, to],
);

const row = result.rows[0]!;
const visitors = Number(row.price_page_visitors);
const registrations = Number(row.registrations);
const trials = Number(row.trials);
const paid = Number(row.first_payments);
const renewals = Number(row.renewals);
const churned = Number(row.churned);
const hasTrial = trials > 0;

const markdown = `# NoSub 转化漏斗周报

统计区间：${from} 至 ${to}（含首尾日期，UTC）

| 阶段 | 数量 | 转化率 |
|---|---:|---:|
| Chrome 商店页面浏览 | ${storeViews || '未录入'} | — |
| 价格页浏览 | ${row.price_page_views} | — |
| 价格页匿名访客 | ${visitors} | — |
| 新注册 | ${registrations} | ${percent(registrations, visitors || storeViews)} |
${hasTrial ? `| 新试用 | ${trials} | ${percent(trials, registrations)} |\n` : ''}| 新付费用户 | ${paid} | ${percent(paid, hasTrial ? trials : registrations)} |
| 续费交易 | ${renewals} | — |
| 实际流失订阅 | ${churned} | — |

## 收入

- 首次付款金额：$${Number(row.first_payment_amount).toFixed(2)}
- 续费金额：$${Number(row.renewal_amount).toFixed(2)}

## 口径

- 价格页访客按第一方匿名 ID 去重。
- 新付费是同一订阅的第一笔成功交易；后续成功交易计为续费。
- 只有 Paddle 发出 \`subscription.canceled\`、订阅实际结束时才计流失。
- ${hasTrial ? '本期检测到真实 trialing 事件。' : '当前没有真实试用事件，因此漏斗不展示试用阶段。'}
- Chrome 商店浏览与注册目前无法做用户级归因，商店转化率只是区间级参考。
`;

if (output) await writeFile(output, markdown, 'utf8');
else process.stdout.write(markdown);

await pool.end();
