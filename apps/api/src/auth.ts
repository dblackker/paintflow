// Better Auth configuration placeholder
// TODO: Implement magic link auth with Workers KV sessions

export interface Session {
  userId: string;
  orgId: string;
  expiresAt: Date;
}

export async function createSession(userId: string, orgId: string): Promise<string> {
  // TODO: Generate session token, store in KV with TTL
  const token = crypto.randomUUID();
  // await KV.put(`session:${token}`, JSON.stringify({ userId, orgId }), { expirationTtl: 604800 });
  return token;
}

export async function getSession(token: string): Promise<Session | null> {
  // TODO: Lookup from KV
  // const data = await KV.get(`session:${token}`);
  // return data ? JSON.parse(data) : null;
  return null;
}

export async function requireAuth(c: any) {
  const token = c.req.cookie('session');
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const session = await getSession(token);
  if (!session) {
    return c.json({ error: 'Invalid session' }, 401);
  }
  c.set('userId', session.userId);
  c.set('orgId', session.orgId);
}
