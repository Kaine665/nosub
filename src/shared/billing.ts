export const BILLING_URL = 'https://kaine665.github.io/nosub/pricing.html';

export function buildBillingUrl(email = '', checkoutToken = ''): string {
  const params = new URLSearchParams();
  if (email.trim()) params.set('email', email.trim());
  if (checkoutToken) params.set('checkout_token', checkoutToken);
  const fragment = params.toString();
  return fragment ? `${BILLING_URL}#${fragment}` : BILLING_URL;
}
