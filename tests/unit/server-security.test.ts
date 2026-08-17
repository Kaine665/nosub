import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  signCheckoutToken, verifyCheckoutToken, verifyPaddleSignature,
} from '../../server/src/security.js';

describe('server security', () => {
  it('verifies a current Paddle signature and rejects a modified payload', () => {
    const now = 1_700_000_000;
    const body = '{"event_id":"evt_1"}';
    const signature = createHmac('sha256', 'secret').update(`${now}:${body}`).digest('hex');
    const header = `ts=${now};h1=${signature}`;
    expect(verifyPaddleSignature(body, header, 'secret', now)).toBe(true);
    expect(verifyPaddleSignature(`${body} `, header, 'secret', now)).toBe(false);
  });

  it('rejects stale Paddle signatures', () => {
    const timestamp = 1_700_000_000;
    const body = '{}';
    const signature = createHmac('sha256', 'secret').update(`${timestamp}:${body}`).digest('hex');
    expect(verifyPaddleSignature(body, `ts=${timestamp};h1=${signature}`, 'secret', timestamp + 31)).toBe(false);
  });

  it('signs a short-lived checkout identity and rejects tampering or expiry', () => {
    const now = 1_700_000_000;
    const claims = {
      userId: '11111111-1111-4111-8111-111111111111',
      email: 'buyer@example.com',
      expiresAt: now + 600,
    };
    const token = signCheckoutToken(claims, 'checkout-secret');
    expect(verifyCheckoutToken(token, 'checkout-secret', now)).toEqual(claims);
    expect(verifyCheckoutToken(`${token}x`, 'checkout-secret', now)).toBeNull();
    expect(verifyCheckoutToken(token, 'checkout-secret', now + 601)).toBeNull();
  });
});
