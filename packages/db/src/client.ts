import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';

// Configure Neon to use fetch
neonConfig.fetchConnectionCache = true;

export function createDb(url: string) {
  const sql = neon(url);
  const db = drizzle(sql, { schema });
  
  // Neon HTTP does not keep a stable per-request Postgres session for SET LOCAL.
  // API routes enforce tenant isolation with explicit org_id filters.
  return db;
}

export type DbClient = ReturnType<typeof createDb>;
