export function paddleApiBase(environment: string | undefined, apiKey: string): string {
  const normalized = environment?.trim().toLowerCase()
    ?? (apiKey.includes('_live_') ? 'production' : 'sandbox');

  if (normalized === 'production' || normalized === 'live') {
    return 'https://api.paddle.com';
  }
  if (normalized === 'sandbox') {
    return 'https://sandbox-api.paddle.com';
  }
  throw new Error('PADDLE_ENVIRONMENT must be production or sandbox.');
}
