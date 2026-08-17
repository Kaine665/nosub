import type { BillingCycle } from '../auth/types.js';

export const BILLING_URL = 'https://kaine665.github.io/nosub/checkout.html';

export function buildBillingUrl(cycle: BillingCycle, email = '', checkoutToken = ''): string {
  const params = new URLSearchParams();
  params.set('cycle', cycle);
  if (email.trim()) params.set('email', email.trim());
  if (checkoutToken) params.set('checkout_token', checkoutToken);
  const fragment = params.toString();
  return fragment ? `${BILLING_URL}#${fragment}` : BILLING_URL;
}
