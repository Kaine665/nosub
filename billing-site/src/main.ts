import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import './style.css';

type BillingCycle = 'month' | 'year';

const config = {
  environment: import.meta.env.VITE_PADDLE_ENVIRONMENT,
  token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
  prices: {
    month: import.meta.env.VITE_PADDLE_MONTHLY_PRICE_ID,
    year: import.meta.env.VITE_PADDLE_ANNUAL_PRICE_ID,
  },
};

for (const [key, value] of Object.entries(config)) {
  if (!value) throw new Error(`Missing required Paddle configuration: ${key}`);
}
if (!config.prices.month || !config.prices.year) {
  throw new Error('Missing required Paddle price IDs.');
}
if (config.environment !== 'sandbox' && config.environment !== 'production') {
  throw new Error('VITE_PADDLE_ENVIRONMENT must be sandbox or production.');
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');

app.innerHTML = `
  <main>
    <nav class="nav shell" aria-label="Primary navigation">
      <a class="brand" href="./" aria-label="NoSub home">
        <span class="brand-mark" aria-hidden="true">N</span>
        <span>NoSub</span>
      </a>
      <a class="nav-link" href="#pricing">Pricing</a>
    </nav>

    <section class="hero shell">
      <div class="eyebrow"><span></span> Built for focused listeners</div>
      <h1>Turn real YouTube videos into<br><em>English listening practice.</em></h1>
      <p>Repeat the moment. Reveal the line. Understand every word.<br>NoSub turns videos you already love into deliberate practice.</p>
      <a class="hero-cta" href="#pricing">Choose your plan <span aria-hidden="true">↓</span></a>
    </section>

    <section class="pricing shell" id="pricing" aria-labelledby="pricing-title">
      <div class="section-heading">
        <div>
          <p class="kicker">Simple pricing</p>
          <h2 id="pricing-title">Start free. Upgrade when<br>you want to go deeper.</h2>
        </div>
        <div class="billing-toggle" role="group" aria-label="Billing cycle">
          <button type="button" data-cycle="month" class="active">Monthly</button>
          <button type="button" data-cycle="year">Yearly <span>Save 50%</span></button>
        </div>
      </div>

      <div class="plans">
        <article class="plan free-plan">
          <div>
            <p class="plan-label">For getting started</p>
            <h3>Free</h3>
            <p class="plan-description">The essential listening loop for any English YouTube video.</p>
            <div class="price"><strong>$0</strong><span>forever</span></div>
          </div>
          <ul>
            <li>Repeat the current subtitle</li>
            <li>Reveal and hide subtitles</li>
            <li>Keyboard-first controls</li>
            <li>Word lookup while watching</li>
          </ul>
          <a class="button secondary" href="https://chromewebstore.google.com/detail/gjdbacmibabccgnjckmgflaomjboibji">Use NoSub free</a>
        </article>

        <article class="plan pro-plan">
          <div class="popular">Best value</div>
          <div>
            <p class="plan-label">For serious learners</p>
            <h3>NoSub Pro</h3>
            <p class="plan-description">Build a daily practice habit with unlimited learning tools.</p>
            <div class="price loading" id="pro-price"><strong>—</strong><span>Loading local price…</span></div>
            <p class="billing-note" id="billing-note">Billed monthly. Cancel anytime.</p>
          </div>
          <ul>
            <li>Everything in Free</li>
            <li>Unlimited instant translation</li>
            <li>Unlimited word explanations</li>
            <li>Learning history and saved words</li>
            <li>Future Pro listening features</li>
          </ul>
          <button class="button primary" id="subscribe" type="button" disabled>
            <span>Get NoSub Pro</span><span aria-hidden="true">→</span>
          </button>
          <p class="secure-note">Secure checkout powered by Paddle</p>
        </article>
      </div>
    </section>

    <section class="promise shell">
      <p>Real videos. Real voices.</p>
      <h2>Listening gets better<br>when practice feels real.</h2>
      <div class="shortcuts" aria-label="NoSub keyboard shortcuts">
        <div><kbd>A</kbd><span>Repeat</span></div>
        <div><kbd>S</kbd><span>Reveal</span></div>
        <div><kbd>D</kbd><span>Previous</span></div>
        <div><kbd>E</kbd><span>Translate</span></div>
      </div>
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

const priceElement = document.querySelector<HTMLDivElement>('#pro-price');
const billingNote = document.querySelector<HTMLParagraphElement>('#billing-note');
const subscribeButton = document.querySelector<HTMLButtonElement>('#subscribe');
const toggleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-cycle]'));

let paddle: Paddle | undefined;
let currentCycle: BillingCycle = 'month';

function setStatus(message: string): void {
  if (!priceElement) return;
  priceElement.classList.add('loading');
  priceElement.innerHTML = `<strong>—</strong><span>${message}</span>`;
}

async function updatePrice(): Promise<void> {
  if (!paddle || !priceElement || !billingNote || !subscribeButton) return;
  setStatus('Loading local price…');
  subscribeButton.disabled = true;

  try {
    const result = await paddle.PricePreview({
      items: [{ priceId: config.prices[currentCycle], quantity: 1 }],
    });
    const lineItem = result.data.details.lineItems[0];
    if (!lineItem) throw new Error('Paddle returned no price.');

    priceElement.classList.remove('loading');
    priceElement.innerHTML = `<strong>${lineItem.formattedTotals.total}</strong><span>/${currentCycle}</span>`;
    billingNote.textContent = currentCycle === 'year'
      ? 'Billed yearly. Save 50% compared with monthly billing.'
      : 'Billed monthly. Cancel anytime.';
    subscribeButton.disabled = false;
  } catch (error) {
    console.error('Unable to preview Paddle price', error);
    setStatus('Price unavailable — please try again');
  }
}

function selectCycle(cycle: BillingCycle): void {
  currentCycle = cycle;
  for (const button of toggleButtons) {
    button.classList.toggle('active', button.dataset.cycle === cycle);
  }
  void updatePrice();
}

for (const button of toggleButtons) {
  button.addEventListener('click', () => selectCycle(button.dataset.cycle as BillingCycle));
}

subscribeButton?.addEventListener('click', () => {
  paddle?.Checkout.open({
    items: [{ priceId: config.prices[currentCycle], quantity: 1 }],
    settings: {
      displayMode: 'overlay',
      variant: 'one-page',
      theme: 'light',
      successUrl: `${window.location.origin}${import.meta.env.BASE_URL}?checkout=success`,
    },
  });
});

if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
  const hero = document.querySelector<HTMLElement>('.hero');
  hero?.insertAdjacentHTML('afterbegin', '<div class="success-banner">Payment received. Your NoSub Pro access is being prepared.</div>');
}

async function start(): Promise<void> {
  paddle = await initializePaddle({
    environment: config.environment,
    token: config.token,
  });
  if (!paddle) {
    setStatus('Checkout unavailable');
    return;
  }
  await updatePrice();
}

void start();
