import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import './style.css';

type BillingCycle = 'month' | 'quarter' | 'year';

const config = {
  environment: import.meta.env.VITE_PADDLE_ENVIRONMENT,
  token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
  prices: {
    month: import.meta.env.VITE_PADDLE_MONTHLY_PRICE_ID,
    quarter: import.meta.env.VITE_PADDLE_QUARTERLY_PRICE_ID,
    year: import.meta.env.VITE_PADDLE_ANNUAL_PRICE_ID,
  },
};
const signedInEmail = new URLSearchParams(window.location.hash.slice(1)).get('email')?.trim() ?? '';
const checkoutToken = new URLSearchParams(window.location.hash.slice(1)).get('checkout_token') ?? '';
const API_URL = 'https://api-nosub.43-130-246-125.sslip.io';
const VISITOR_KEY = 'nosub-anonymous-visitor-v1';

function anonymousVisitorId(): string {
  const existing = localStorage.getItem(VISITOR_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(VISITOR_KEY, created);
  return created;
}

function trackPageView(): void {
  const query = new URLSearchParams(window.location.search);
  let referrerHost = '';
  try { referrerHost = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* ignore */ }
  void fetch(`${API_URL}/v1/analytics/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      event_name: 'page_view', anonymous_id: anonymousVisitorId(), path: window.location.pathname,
      referrer_host: referrerHost || null,
      utm_source: query.get('utm_source'), utm_medium: query.get('utm_medium'),
      utm_campaign: query.get('utm_campaign'),
    }),
  }).catch(() => undefined);
}

trackPageView();

const hasPaddleConfig = Boolean(
  config.token && config.prices.month && config.prices.quarter && config.prices.year
  && (config.environment === 'sandbox' || config.environment === 'production'),
);

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');

app.innerHTML = `
  <main>
    <nav class="nav shell" aria-label="Primary navigation">
      <a class="brand" href="./" aria-label="NoSub home">
        <span class="brand-mark" aria-hidden="true">N</span>
        <span>NoSub</span>
      </a>
      <a class="nav-link" href="./">Back to NoSub</a>
    </nav>

    <section class="checkout-hero shell">
      <div class="eyebrow"><span></span> NoSub Pro</div>
      <h1>Choose your practice plan.</h1>
      <p>Every plan unlocks the complete NoSub learning experience. Checkout is securely processed by Paddle.</p>
      ${signedInEmail && checkoutToken
        ? `<div class="checkout-session">Ready for checkout as <strong>${signedInEmail.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</strong></div>`
        : '<div class="checkout-session warning">To activate Pro automatically, open this page from the NoSub extension after signing in.</div>'}
    </section>

    <section class="pricing shell" id="pricing" aria-labelledby="pricing-title">
      <div class="section-heading">
        <div>
          <p class="kicker">Simple pricing</p>
          <h2 id="pricing-title">Choose the pace that<br>fits your practice.</h2>
        </div>
        <p class="pricing-intro">Every Pro plan includes the complete NoSub learning experience. Save more when you commit to consistent practice.</p>
      </div>

      <div class="plans">
        <article class="plan monthly-plan">
          <div>
            <p class="plan-label">Flexible</p>
            <h3>Monthly</h3>
            <p class="plan-description">Explore every Pro feature without a long commitment.</p>
            <div class="price loading" data-price="month"><strong>—</strong><span>Loading local price…</span></div>
            <p class="billing-note">Renews monthly. Cancel anytime.</p>
          </div>
          <ul>
            <li>Unlimited instant translation</li>
            <li>Unlimited word explanations</li>
            <li>Learning history and saved words</li>
            <li>All future Pro listening features</li>
          </ul>
          <button class="button secondary" data-subscribe="month" type="button">
            <span>Choose monthly</span><span aria-hidden="true">→</span>
          </button>
        </article>

        <article class="plan featured-plan">
          <div class="popular">Most popular</div>
          <div>
            <p class="plan-label">Build momentum</p>
            <h3>3 months</h3>
            <p class="plan-description">Enough time to turn focused listening into a real habit.</p>
            <div class="price loading" data-price="quarter"><strong>—</strong><span>Loading local price…</span></div>
            <p class="billing-note">Save 20% compared with monthly billing.</p>
          </div>
          <ul>
            <li>Unlimited instant translation</li>
            <li>Unlimited word explanations</li>
            <li>Learning history and saved words</li>
            <li>All future Pro listening features</li>
          </ul>
          <button class="button primary" data-subscribe="quarter" type="button">
            <span>Choose 3 months</span><span aria-hidden="true">→</span>
          </button>
          <p class="secure-note">Secure checkout powered by Paddle</p>
        </article>

        <article class="plan value-plan">
            <div class="value-badge">Best value · Save 35%</div>
          <div>
            <p class="plan-label">Make it count</p>
            <h3>Yearly</h3>
            <p class="plan-description">The lowest monthly price for committed learners.</p>
            <div class="price loading" data-price="year"><strong>—</strong><span>Loading local price…</span></div>
            <p class="billing-note">Save 35% compared with monthly billing.</p>
          </div>
          <ul>
            <li>Unlimited instant translation</li>
            <li>Unlimited word explanations</li>
            <li>Learning history and saved words</li>
            <li>All future Pro listening features</li>
          </ul>
          <button class="button value-button" data-subscribe="year" type="button">
            <span>Choose yearly</span><span aria-hidden="true">→</span>
          </button>
          <p class="secure-note">Secure checkout powered by Paddle</p>
        </article>
      </div>
      <p class="free-note">Not ready for Pro? <a href="https://chromewebstore.google.com/detail/gjdbacmibabccgnjckmgflaomjboibji">Keep using NoSub Free</a> — no card required.</p>
    </section>

    <footer class="shell">
      <a class="brand" href="./"><span class="brand-mark" aria-hidden="true">N</span><span>NoSub</span></a>
      <p>© 2026 Wuxi Gongqian Technology Co., Ltd.</p>
      <div class="footer-links">
        <a href="./terms.html">Terms</a>
        <a href="./privacy.html">Privacy</a>
        <a href="./refund.html">Refunds</a>
        <a href="mailto:xl1469608@gmail.com">Support</a>
      </div>
    </footer>
  </main>
`;

let paddle: Paddle | undefined;

const periodLabels: Record<BillingCycle, string> = {
  month: 'month',
  quarter: '3 months',
  year: 'year',
};

async function updatePrice(cycle: BillingCycle): Promise<void> {
  const priceElement = document.querySelector<HTMLDivElement>(`[data-price="${cycle}"]`);
  const subscribeButton = document.querySelector<HTMLButtonElement>(`[data-subscribe="${cycle}"]`);
  if (!paddle || !priceElement || !subscribeButton) return;

  try {
    const result = await paddle.PricePreview({
      items: [{ priceId: config.prices[cycle], quantity: 1 }],
    });
    const lineItem = result.data.details.lineItems[0];
    if (!lineItem) throw new Error('Paddle returned no price.');

    priceElement.classList.remove('loading');
    priceElement.innerHTML = `<strong>${lineItem.formattedTotals.total}</strong><span>/${periodLabels[cycle]}</span>`;
    subscribeButton.disabled = false;
  } catch (error) {
    console.error('Unable to preview Paddle price', error);
    priceElement.innerHTML = '<strong>—</strong><span>Price unavailable</span>';
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-subscribe]')) {
  button.addEventListener('click', () => {
    if (!signedInEmail || !checkoutToken) {
      window.alert('Open this pricing page from the NoSub extension after signing in, so your Pro access can be activated securely.');
      return;
    }
    const cycle = button.dataset.subscribe as BillingCycle;
    if (!paddle) {
      window.alert('Secure checkout is still loading. Please try again in a moment.');
      return;
    }
    paddle.Checkout.open({
      items: [{ priceId: config.prices[cycle], quantity: 1 }],
      customer: { email: signedInEmail },
      customData: { nosub_checkout_token: checkoutToken },
      settings: {
        displayMode: 'overlay',
        variant: 'one-page',
        theme: 'light',
        successUrl: `${window.location.origin}${import.meta.env.BASE_URL}pricing.html?checkout=success`,
      },
    });
  });
}

if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
  const hero = document.querySelector<HTMLElement>('.checkout-hero');
  hero?.insertAdjacentHTML('afterbegin', '<div class="success-banner">Payment received. Your NoSub Pro access is being prepared.</div>');
}

async function start(): Promise<void> {
  if (!hasPaddleConfig) {
    for (const element of document.querySelectorAll<HTMLDivElement>('[data-price]')) {
      element.classList.remove('loading');
      element.innerHTML = '<strong>—</strong><span>Checkout configuration unavailable</span>';
    }
    return;
  }
  paddle = await initializePaddle({
    environment: config.environment,
    token: config.token,
  });
  if (!paddle) {
    for (const element of document.querySelectorAll<HTMLDivElement>('[data-price]')) {
      element.innerHTML = '<strong>—</strong><span>Checkout unavailable</span>';
    }
    return;
  }
  await Promise.all((['month', 'quarter', 'year'] as BillingCycle[]).map(updatePrice));
}

void start();
