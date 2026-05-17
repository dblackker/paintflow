import { drizzle } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';

// Configure Neon to use fetch
neonConfig.fetchConnectionCache = true;

export function createDb(url: string, orgId?: string) {
  const sql = neon(url);
  const db = drizzle(sql, { schema });
  
  // If orgId is provided, set RLS context
  // Note: With HTTP driver, we need to set config per query
  // This is a simplified version - in production, wrap queries to set config first
  if (orgId) {
    // TODO: Execute SET LOCAL app.current_org_id = '...'
    // For now, we filter by orgId in queries explicitly
  }
  
  return db;
}

export type DbClient = ReturnType<typeof createDb>;
