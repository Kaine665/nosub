import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rawN, rawR, rawP, rawSalt, rawKey] = encoded.split('$');
  if (algorithm !== 'scrypt' || !rawN || !rawR || !rawP || !rawSalt || !rawKey) return false;
  if (Number(rawN) !== SCRYPT_N || Number(rawR) !== SCRYPT_R || Number(rawP) !== SCRYPT_P) return false;
  const expected = Buffer.from(rawKey, 'base64url');
  const actual = await derive(password, Buffer.from(rawSalt, 'base64url'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

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
