# Paddle Live 上线清单

Paddle Sandbox 与 Live 是两套完全独立的数据和凭据。不要混用测试商品、Price ID、Token、API Key 或 Webhook Secret。

## 1. Paddle Live 账户

- 完成 Paddle Live 账户审核。
- 在 Live Catalog 创建 NoSub 产品以及月付、季付、年付三个价格。
- 在 Developer tools → Authentication 创建 Live Client-side Token。
- 创建仅包含所需权限的 Live API Key，并安全保存；不要提交到 Git。

## 2. GitHub Actions 变量

在仓库 Settings → Secrets and variables → Actions → Variables 更新：

```text
VITE_PADDLE_ENVIRONMENT=production
VITE_PADDLE_CLIENT_TOKEN=<Live client-side token>
VITE_PADDLE_MONTHLY_PRICE_ID=<Live monthly Price ID>
VITE_PADDLE_QUARTERLY_PRICE_ID=<Live quarterly Price ID>
VITE_PADDLE_ANNUAL_PRICE_ID=<Live annual Price ID>
```

更新后手动运行 `Deploy billing site` workflow，并确认套餐页不再显示 Test mode。

## 3. Supabase Function Secrets

为生产项目设置：

```text
PADDLE_ENVIRONMENT=production
PADDLE_API_KEY=<Live API key>
PADDLE_WEBHOOK_SECRET=<Live notification destination secret>
```

然后重新部署 `customer-portal` 和 `paddle-webhook` 两个函数。

## 4. Live Webhook

在 Paddle Live 的 Developer tools → Notifications 创建 HTTPS destination，指向生产 `paddle-webhook` 函数，并订阅：

- `customer.created`
- `customer.updated`
- 所有需要同步的 `subscription.*` 生命周期事件
- `transaction.completed`

每个 notification destination 都有独立 Secret，必须将 Live Secret 写入 `PADDLE_WEBHOOK_SECRET`。

## 5. 上线验收

1. 使用真实低价商品完成一次 Live 支付。
2. 检查 `paddle_events` 已记录并处理完成。
3. 检查 `paddle_customers` 和 `subscriptions` 已关联到正确的 Supabase 用户。
4. 在扩展设置页刷新套餐状态，确认显示 `PRO`。
5. 在 YouTube 中确认翻译可用。
6. 打开客户门户，确认使用的是 Live `api.paddle.com`。
7. 完成一次退款或取消订阅测试，确认权限能够正确回收。
