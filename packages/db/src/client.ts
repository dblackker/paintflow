import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

export function createDb(url: string, orgId?: string) {
  const sql = neon(url);
  const db = drizzle(sql, { schema });
  
  // TODO: Set RLS context
  // if (orgId) {
  //   await sql`SELECT set_config('app.current_org_id', ${orgId}, true)`;
  // }
  
  return db;
}

export type DbClient = ReturnType<typeof createDb>;
