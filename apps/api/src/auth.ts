import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from './types';

export interface Session {
  userId: string;
  orgId: string;
  email: string;
  expiresAt: number;
}

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

export function getRequestSessionInfo(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const authHeader = c.req.header('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = match?.[1]?.trim();
  if (bearerToken) return { token: bearerToken, source: 'bearer' as const };

  const cookieToken = getCookie(c, 'session');
  if (cookieToken) return { token: cookieToken, source: 'cookie' as const };
  return { token: '', source: 'none' as const };
}

export function getRequestSessionToken(c: Context<{ Bindings: Env; Variables: Variables }>) {
  return getRequestSessionInfo(c).token;
}

export async function createSession(
  env: Env,
  userId: string,
  orgId: string,
  email: string
): Promise<string> {
  const token = crypto.randomUUID();
  const session: Session = {
    userId,
    orgId,
    email,
    expiresAt: Date.now() + SESSION_TTL * 1000,
  };
  
  await env.KV.put(
    `session:${token}`,
    JSON.stringify(session),
    { expirationTtl: SESSION_TTL }
  );
  
  return token;
}

export async function getSession(
  env: Env,
  token: string
): Promise<Session | null> {
  const data = await env.KV.get(`session:${token}`);
  if (!data) return null;
  
  let session: Session;
  try {
    session = JSON.parse(data) as Session;
  } catch {
    await env.KV.delete(`session:${token}`);
    return null;
  }

  if (!session.userId || !session.orgId || !session.email || typeof session.expiresAt !== 'number') {
    await env.KV.delete(`session:${token}`);
    return null;
  }
  
  // Check expiration
  if (session.expiresAt < Date.now()) {
    await env.KV.delete(`session:${token}`);
    return null;
  }
  
  return session;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.KV.delete(`session:${token}`);
}

export async function createOAuthState(
  env: Env,
  provider: string,
  orgId: string,
  userId?: string
): Promise<string> {
  const token = crypto.randomUUID();
  await env.KV.put(
    `oauth:${provider}:${token}`,
    JSON.stringify({ orgId, userId, createdAt: Date.now() }),
    { expirationTtl: 10 * 60 }
  );
  return token;
}

export async function consumeOAuthState(
  env: Env,
  provider: string,
  token?: string | null
): Promise<{ orgId: string; userId?: string } | null> {
  if (!token) return null;

  const key = `oauth:${provider}:${token}`;
  const data = await env.KV.get(key);
  if (!data) return null;

  await env.KV.delete(key);

  let state: { orgId?: string; userId?: string; createdAt?: number };
  try {
    state = JSON.parse(data) as { orgId?: string; userId?: string; createdAt?: number };
  } catch {
    return null;
  }
  if (!state.orgId || !state.createdAt || Date.now() - state.createdAt > 10 * 60 * 1000) {
    return null;
  }

  return { orgId: state.orgId, userId: state.userId };
}

export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const token = getRequestSessionToken(c);
  
  if (!token) {
    return c.json({ error: 'Unauthorized', code: 'NO_SESSION' }, 401);
  }
  
  const session = await getSession(c.env, token);
  
  if (!session) {
    return c.json({ error: 'Invalid or expired session', code: 'INVALID_SESSION' }, 401);
  }
  
  c.set('userId', session.userId);
  c.set('orgId', session.orgId);
  c.set('session', session);
}
