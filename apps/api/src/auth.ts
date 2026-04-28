import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { generateToken, sha256, verifyPassword } from './crypto.js';
import type { Actor, UserRow } from './types.js';

export const SESSION_COOKIE = 'vibestack_session';
const SESSION_DAYS = 14;

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = generateToken('vss');
  const tokenHash = sha256(token);
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
    [userId, tokenHash]
  );
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean, domain?: string): void {
  if (domain) {
    clearHostOnlySessionCookie(reply, secure);
  }

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    domain,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean, domain?: string): void {
  if (domain) {
    clearHostOnlySessionCookie(reply, secure);
  }

  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    domain,
    path: '/'
  });
}

function clearHostOnlySessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    path: '/'
  });
}

export async function loginWithPassword(db: Db, email: string, password: string): Promise<UserRow | null> {
  const user = await db.maybeOne<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  if (!user || user.status !== 'active') {
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return null;
  }
  await db.query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1', [user.id]);
  return { ...user, last_login_at: new Date() };
}

async function actorFromBearer(db: Db, request: FastifyRequest): Promise<Actor | null> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return null;
  }

  const token = auth.slice('Bearer '.length).trim();
  if (!token) {
    return null;
  }

  const row = await db.maybeOne<UserRow & { token_id: string }>(
    `SELECT users.*, api_tokens.id AS token_id
     FROM api_tokens
     JOIN users ON users.id = api_tokens.user_id
     WHERE api_tokens.token_hash = $1
       AND api_tokens.revoked_at IS NULL
       AND users.status = 'active'`,
    [sha256(token)]
  );
  if (!row) {
    return null;
  }

  await db.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [row.token_id]);
  return { user: row, actorType: 'api_token', tokenId: row.token_id };
}

async function actorFromSession(db: Db, request: FastifyRequest): Promise<Actor | null> {
  const cookieValue = request.cookies[SESSION_COOKIE];
  if (!cookieValue) {
    return null;
  }

  const unsigned = request.unsignCookie(cookieValue);
  if (!unsigned.valid || !unsigned.value) {
    return null;
  }

  const row = await db.maybeOne<UserRow & { session_id: string }>(
    `SELECT users.*, sessions.id AS session_id
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1
       AND sessions.expires_at > now()
       AND users.status = 'active'`,
    [sha256(unsigned.value)]
  );
  if (!row) {
    return null;
  }

  await db.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [row.session_id]);
  return { user: row, actorType: 'user' };
}

export async function getActor(db: Db, request: FastifyRequest): Promise<Actor | null> {
  return (await actorFromBearer(db, request)) ?? (await actorFromSession(db, request));
}

export async function requireActor(db: Db, request: FastifyRequest): Promise<Actor> {
  const actor = await getActor(db, request);
  if (!actor) {
    throw new HttpError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required.',
      statusCode: 401,
      agentHint: 'Log in with email/password or send a valid personal API token as a Bearer token.'
    });
  }
  return actor;
}
