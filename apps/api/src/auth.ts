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
  
  const session = JSON.parse(data) as Session;
  
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

  const state = JSON.parse(data) as { orgId?: string; userId?: string; createdAt?: number };
  if (!state.orgId || !state.createdAt || Date.now() - state.createdAt > 10 * 60 * 1000) {
    return null;
  }

  return { orgId: state.orgId, userId: state.userId };
}

export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const token = getCookie(c, 'session');
  
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
