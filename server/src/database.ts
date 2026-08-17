import pg from 'pg';
import { hashToken, newToken } from './security.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export interface UserRecord {
  id: string;
  email: string;
}

export interface SessionPayload {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  user: UserRecord;
}

export async function createSession(client: pg.PoolClient, user: UserRecord): Promise<SessionPayload> {
  const accessToken = newToken();
  const refreshToken = newToken();
  const expiresIn = 60 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  await client.query(
    `insert into sessions
      (user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at)
     values ($1, $2, $3, to_timestamp($4), now() + interval '30 days')`,
    [user.id, hashToken(accessToken), hashToken(refreshToken), expiresAt],
  );
  return { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, expires_in: expiresIn, user };
}

export async function userForAccessToken(token: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRecord>(
    `select users.id, users.email::text
       from sessions join users on users.id = sessions.user_id
      where sessions.access_token_hash = $1
        and sessions.revoked_at is null
        and sessions.access_expires_at > now()`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}
