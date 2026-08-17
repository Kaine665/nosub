import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyGoogleAccessToken } from '../../server/src/google-auth.js';

const clientId = '123456.apps.googleusercontent.com';

afterEach(() => vi.unstubAllGlobals());

describe('Google authentication', () => {
  it('accepts a current NoSub token and returns the stable Google subject', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        aud: clientId,
        scope: 'openid https://www.googleapis.com/auth/userinfo.email',
        expires_in: '3200',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: 'google-user-123', email: 'Learner@Example.com', email_verified: true,
      }), { status: 200 })));

    await expect(verifyGoogleAccessToken('token', clientId)).resolves.toEqual({
      subject: 'google-user-123', email: 'learner@example.com',
    });
  });

  it('rejects tokens issued for another OAuth client', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        aud: 'another.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/userinfo.email',
        expires_in: '3200',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: 'google-user-123', email: 'learner@example.com', email_verified: true,
      }), { status: 200 })));

    await expect(verifyGoogleAccessToken('token', clientId)).rejects.toThrow('not issue this token');
  });
});
