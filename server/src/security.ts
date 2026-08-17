import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CheckoutClaims {
  userId: string;
  email: string;
  expiresAt: number;
}

/** Opaque, short-lived proof that a Paddle checkout was opened by a signed-in NoSub user. */
export function signCheckoutToken(claims: CheckoutClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyCheckoutToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): CheckoutClaims | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CheckoutClaims>;
    if (typeof claims.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.userId)) return null;
    if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null;
    if (typeof claims.expiresAt !== 'number' || claims.expiresAt < nowSeconds) return null;
    if (claims.expiresAt > nowSeconds + 60 * 60) return null;
    return claims as CheckoutClaims;
  } catch {
    return null;
  }
}

export function verifyPaddleSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const parts = header.split(';').reduce<Record<string, string[]>>((result, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return result;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    (result[key] ??= []).push(value);
    return result;
  }, {});
  const timestamp = Number(parts.ts?.[0]);
  const signatures = parts.h1 ?? [];
  if (!Number.isFinite(timestamp) || signatures.length === 0 || Math.abs(nowSeconds - timestamp) > 30) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}:${rawBody}`).digest();
  return signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const actual = Buffer.from(candidate, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
