import {
  CheckoutEventNames,
  initializePaddle,
  type Paddle,
  type PaddleEventData,
} from '@paddle/paddle-js';
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
const params = new URLSearchParams(window.location.hash.slice(1));
const cycle = params.get('cycle') as BillingCycle | null;
const email = params.get('email')?.trim() ?? '';
const checkoutToken = params.get('checkout_token') ?? '';
const validCycles: BillingCycle[] = ['month', 'quarter', 'year'];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');
const appRoot = app;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(title: string, detail: string, error = false): void {
  appRoot.innerHTML = `
    <main class="checkout-bridge">
      <a class="brand" href="./"><span class="brand-mark" aria-hidden="true">N</span><span>NoSub</span></a>
      <div class="checkout-loader${error ? ' error' : ''}" aria-hidden="true"></div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(detail)}</p>
      ${error ? '<a class="hero-cta" href="./">Back to NoSub</a>' : ''}
    </main>`;
}

function fail(detail: string): void {
  render('Checkout could not start.', detail, true);
}

function paddleErrorDetails(error: unknown): { code: string; detail: string } {
  if (error instanceof Error) return { code: '', detail: error.message };
  if (!error || typeof error !== 'object') {
    return { code: '', detail: 'Paddle did not provide an error code.' };
  }
  const value = error as Record<string, unknown>;
  const nested = value.error && typeof value.error === 'object'
    ? value.error as Record<string, unknown>
    : null;
  const code = String(nested?.code ?? value.code ?? '').trim();
  const detail = String(nested?.detail ?? value.detail ?? '').trim();
  return { code, detail };
}

function paddleErrorMessage(error: unknown): string {
  const { code, detail } = paddleErrorDetails(error);
  if (code === 'transaction_checkout_not_enabled') {
    return 'Paddle has not enabled live checkout for this seller account yet. Complete or await approval of the Paddle onboarding process, then try again.';
  }
  const reason = code && detail ? `${code}: ${detail}` : detail || code;
  return `${reason || 'Paddle did not provide an error code.'} Check that api.paddle.com, create-checkout.paddle.com, and buy.paddle.com are reachable, then try again.`;
}

async function start(): Promise<void> {
  if (!cycle || !validCycles.includes(cycle) || !email || !checkoutToken) {
    fail('Return to the NoSub extension settings, sign in, and choose a plan again.');
    return;
  }
  if (!config.token || !config.prices[cycle] || (config.environment !== 'sandbox' && config.environment !== 'production')) {
    fail('Billing is not configured yet. Please try again later.');
    return;
  }

  render('Opening secure checkout…', `Your selected plan will be linked to ${email}.`);
  let paddle: Paddle | undefined;
  const checkoutError = (event: PaddleEventData): void => {
    if (event.name !== CheckoutEventNames.CHECKOUT_ERROR
      && event.name !== CheckoutEventNames.CHECKOUT_FAILED) return;
    paddle?.Checkout.close();
    fail(`Paddle checkout failed. ${paddleErrorMessage(event)}`);
  };
  try {
    paddle = await initializePaddle({
      environment: config.environment,
      token: config.token,
      eventCallback: checkoutError,
    });
  } catch {
    fail('Paddle could not be loaded. Check your connection and try again from the extension settings.');
    return;
  }
  if (!paddle) {
    fail('Paddle could not be loaded. Check your connection and try again from the extension settings.');
    return;
  }
  try {
    await paddle.PricePreview({
      items: [{ priceId: config.prices[cycle], quantity: 1 }],
    });
  } catch (error) {
    fail(`Paddle could not validate this plan. ${paddleErrorMessage(error)}`);
    return;
  }
  paddle.Checkout.open({
    items: [{ priceId: config.prices[cycle], quantity: 1 }],
    customer: { email },
    customData: { nosub_checkout_token: checkoutToken },
    settings: {
      displayMode: 'overlay', variant: 'one-page', theme: 'light',
      successUrl: `${window.location.origin}${import.meta.env.BASE_URL}checkout.html?checkout=success`,
    },
  });
}

if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
  render('Payment received.', 'Return to NoSub settings and refresh your plan status.');
} else {
  void start();
}
