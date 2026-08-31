import { writeFile } from 'node:fs/promises';
import { pool } from './database.js';

interface FunnelRow {
  server_installs: string;
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

interface ActivationRow {
  installed: string;
  mature_installs: string;
  opened_video: string;
  caption_succeeded: string;
  session_ready: string;
  core_action: string;
  activated_all: string;
  activated: string;
  caption_success_attempts: string;
  caption_failure_attempts: string;
}

interface ActionRow {
  action: string;
  input_method: string;
  completions: string;
  installations: string;
}

interface InstallationDimensionRow {
  dimension: string;
  installations: string;
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
const storeInstalls = Number(option('--store-installs') ?? 0);

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
     (select count(distinct anonymous_id) from analytics_events, bounds
       where event_name = 'extension_installed' and environment = 'production'
         and occurred_at >= starts_at and occurred_at < ends_at)::text as server_installs,
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

async function installationDistribution(column: 'country_code' | 'browser_language'):
Promise<InstallationDimensionRow[]> {
  const distribution = await pool.query<InstallationDimensionRow>(
    `with first_product_event as (
       select distinct on (anonymous_id)
         anonymous_id, country_code, browser_language, occurred_at
       from analytics_events
       where event_name <> 'page_view' and coalesce(environment, 'production') = 'production'
       order by anonymous_id, occurred_at
     )
     select coalesce(${column}, 'Unknown') as dimension, count(*)::text as installations
     from first_product_event
     where occurred_at >= $1::date and occurred_at < ($2::date + interval '1 day')
     group by coalesce(${column}, 'Unknown')
     order by count(*) desc, dimension`,
    [from, to],
  );
  return distribution.rows;
}

const [countries, languages] = await Promise.all([
  installationDistribution('country_code'),
  installationDistribution('browser_language'),
]);

const activationResult = await pool.query<ActivationRow>(
  `with bounds as (
     select $1::date as starts_at, ($2::date + interval '1 day') as ends_at
   ), installs as (
     select anonymous_id, min(occurred_at) as installed_at
     from analytics_events, bounds
     where event_name = 'extension_installed' and environment = 'production'
       and occurred_at >= starts_at and occurred_at < ends_at
     group by anonymous_id
   ), stages as (
     select i.*,
       exists(select 1 from analytics_events e where e.anonymous_id = i.anonymous_id
         and e.environment = 'production' and e.event_name = 'youtube_video_opened'
         and e.occurred_at between i.installed_at and i.installed_at + interval '168 hours') as opened,
       exists(select 1 from analytics_events e where e.anonymous_id = i.anonymous_id
         and e.environment = 'production' and e.event_name = 'caption_load_succeeded'
         and e.occurred_at between i.installed_at and i.installed_at + interval '168 hours') as captions,
       exists(select 1 from analytics_events e where e.anonymous_id = i.anonymous_id
         and e.environment = 'production' and e.event_name = 'listening_session_started'
         and e.occurred_at between i.installed_at and i.installed_at + interval '168 hours') as ready,
       exists(select 1 from analytics_events e where e.anonymous_id = i.anonymous_id
         and e.environment = 'production' and e.event_name = 'core_action_completed'
         and e.occurred_at between i.installed_at and i.installed_at + interval '168 hours') as acted
     from installs i
   )
   select
     count(*)::text as installed,
     count(*) filter (where installed_at + interval '168 hours' <= now())::text as mature_installs,
     count(*) filter (where opened)::text as opened_video,
     count(*) filter (where captions)::text as caption_succeeded,
     count(*) filter (where ready)::text as session_ready,
     count(*) filter (where acted)::text as core_action,
     count(*) filter (where ready and acted)::text as activated_all,
     count(*) filter (where installed_at + interval '168 hours' <= now() and ready and acted)::text as activated,
     (select count(*) from analytics_events, bounds where event_name = 'caption_load_succeeded'
       and environment = 'production' and occurred_at >= starts_at and occurred_at < ends_at)::text
       as caption_success_attempts,
     (select count(*) from analytics_events, bounds where event_name = 'caption_load_failed'
       and environment = 'production' and occurred_at >= starts_at and occurred_at < ends_at)::text
       as caption_failure_attempts
   from stages`,
  [from, to],
);

const actionResult = await pool.query<ActionRow>(
  `select properties->>'action' as action,
          properties->>'input_method' as input_method,
          count(*)::text as completions,
          count(distinct anonymous_id)::text as installations
     from analytics_events
    where event_name = 'core_action_completed' and environment = 'production'
      and occurred_at >= $1::date and occurred_at < ($2::date + interval '1 day')
    group by properties->>'action', properties->>'input_method'
    order by action, input_method`,
  [from, to],
);

const row = result.rows[0]!;
const serverInstalls = Number(row.server_installs);
const activation = activationResult.rows[0]!;
const matureInstalls = Number(activation.mature_installs);
const activated = Number(activation.activated);
const visitors = Number(row.price_page_visitors);
const registrations = Number(row.registrations);
const trials = Number(row.trials);
const paid = Number(row.first_payments);
const renewals = Number(row.renewals);
const churned = Number(row.churned);
const hasTrial = trials > 0;

function distributionTable(rows: InstallationDimensionRow[], label: string): string {
  if (rows.length === 0) return '尚无数据。';
  return `| ${label} | 新增匿名安装 |\n|---|---:|\n${rows
    .map((item) => `| ${item.dimension} | ${item.installations} |`).join('\n')}`;
}

function actionTable(rows: ActionRow[]): string {
  if (rows.length === 0) return '尚无数据。';
  return `| 操作 | 输入方式 | 成功次数 | 去重安装用户 |\n|---|---|---:|---:|\n${rows
    .map((item) => `| ${item.action} | ${item.input_method} | ${item.completions} | ${item.installations} |`).join('\n')}`;
}

const captionResults = Number(activation.caption_success_attempts) + Number(activation.caption_failure_attempts);

const markdown = `# NoSub 转化漏斗周报

统计区间：${from} 至 ${to}（含首尾日期，UTC）

| 阶段 | 数量 | 转化率 |
|---|---:|---:|
| Chrome 商店页面浏览 | ${storeViews || '未录入'} | — |
| Chrome 商店新增安装 | ${storeInstalls || '未录入'} | — |
| NoSub 收到安装事件 | ${serverInstalls} | ${storeInstalls ? percent(serverInstalls, storeInstalls) : '—'} 事件覆盖率 |
| 已完成 168 小时观察窗的安装用户 | ${matureInstalls} | — |
| 激活用户 | ${activated} | ${percent(activated, matureInstalls)} |
| 价格页浏览 | ${row.price_page_views} | — |
| 价格页匿名访客 | ${visitors} | — |
| 新注册 | ${registrations} | ${percent(registrations, visitors || storeViews)} |
${hasTrial ? `| 新试用 | ${trials} | ${percent(trials, registrations)} |\n` : ''}| 新付费用户 | ${paid} | ${percent(paid, hasTrial ? trials : registrations)} |
| 续费交易 | ${renewals} | — |
| 实际流失订阅 | ${churned} | — |

## 收入

- 首次付款金额：$${Number(row.first_payment_amount).toFixed(2)}
- 续费金额：$${Number(row.renewal_amount).toFixed(2)}

## 首次使用路径

本表以本期新增安装用户为起点，观察安装后连续 168 小时内到达的步骤。未满 168 小时的用户仍会显示实际进展，但不进入正式激活率分母。

| 步骤 | 去重安装用户 |
|---|---:|
| 成功安装 | ${activation.installed} |
| 打开有效视频 | ${activation.opened_video} |
| 字幕加载成功 | ${activation.caption_succeeded} |
| 会话进入可操作状态 | ${activation.session_ready} |
| 完成至少一次核心操作 | ${activation.core_action} |
| 激活 | ${activation.activated_all} |

## 字幕可用性

- 成功尝试：${activation.caption_success_attempts}
- 失败尝试：${activation.caption_failure_attempts}
- 字幕成功率：${percent(Number(activation.caption_success_attempts), captionResults)}

## 核心操作

${actionTable(actionResult.rows)}

## 新增匿名安装来源

### 国家或地区

${distributionTable(countries, '国家代码')}

### 浏览器语言

${distributionTable(languages, '语言标签')}

## 口径

- Chrome 商店新增安装与 NoSub 安装事件不是同一统计口径，不要求完全相等；事件覆盖率用于发现明显漏报。
- 安装、路径和激活按事件实际发生时间计算，并按匿名安装 ID 去重，只统计 production 环境。
- 激活要求安装后连续 168 小时内既有可操作会话，也至少成功完成一次 Q、A、S 或 D；未完成观察窗的安装不进入激活率分母。
- 价格页访客按第一方匿名 ID 去重。
- 新付费是同一订阅的第一笔成功交易；后续成功交易计为续费。
- 只有 Paddle 发出 \`subscription.canceled\`、订阅实际结束时才计流失。
- ${hasTrial ? '本期检测到真实 trialing 事件。' : '当前没有真实试用事件，因此漏斗不展示试用阶段。'}
- Chrome 商店浏览与注册目前无法做用户级归因，商店转化率只是区间级参考。
`;

if (output) await writeFile(output, markdown, 'utf8');
else process.stdout.write(markdown);

await pool.end();
