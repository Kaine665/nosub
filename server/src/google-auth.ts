export interface GoogleIdentity {
  subject: string;
  email: string;
}

interface TokenInfo {
  aud?: string;
  scope?: string;
  expires_in?: string;
}

interface UserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

/** Validate a Chrome Identity access token before using its Google identity. */
export async function verifyGoogleAccessToken(accessToken: string, clientIds: string): Promise<GoogleIdentity> {
  if (!accessToken || accessToken.length > 4096) throw new Error('Invalid Google access token.');
  const allowedClientIds = new Set(clientIds.split(',').map((value) => value.trim()).filter(
    (value) => value.endsWith('.apps.googleusercontent.com'),
  ));
  if (allowedClientIds.size === 0) throw new Error('Google sign-in is not configured yet.');

  const headers = { authorization: `Bearer ${accessToken}` };
  const [tokenResponse, userResponse] = await Promise.all([
    fetch('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }),
    }),
    fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers }),
  ]);
  if (!tokenResponse.ok || !userResponse.ok) throw new Error('Google sign-in expired. Please try again.');

  const token = await tokenResponse.json() as TokenInfo;
  const user = await userResponse.json() as UserInfo;
  const scopes = new Set((token.scope ?? '').split(/\s+/).filter(Boolean));
  if (!token.aud || !allowedClientIds.has(token.aud) || !scopes.has(EMAIL_SCOPE) || Number(token.expires_in ?? 0) <= 0) {
    throw new Error('Google did not issue this token for NoSub.');
  }
  const email = user.email?.trim().toLowerCase() ?? '';
  if (!user.sub || !user.email_verified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Google did not return a verified email address.');
  }
  return { subject: user.sub, email };
}
