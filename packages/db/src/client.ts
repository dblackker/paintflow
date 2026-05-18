import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';

// Configure Neon to use fetch
neonConfig.fetchConnectionCache = true;

function configureLocalNeon(url: string) {
  if (url.includes('@db:5432')) {
    neonConfig.fetchEndpoint = 'http://db:5432/sql';
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
  } else if (url.includes('@localhost:5432') || url.includes('@127.0.0.1:5432')) {
    neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
    neonConfig.useSecureWebSocket = false;
    neonConfig.poolQueryViaFetch = true;
  }
}

export function createDb(url: string) {
  configureLocalNeon(url);
  const sql = neon(url);
  const db = drizzle(sql, { schema });
  
  // Neon HTTP does not keep a stable per-request Postgres session for SET LOCAL.
  // API routes enforce tenant isolation with explicit org_id filters.
  return db;
}

export type DbClient = ReturnType<typeof createDb>;
