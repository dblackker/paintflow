import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import pg from 'pg';

export function disposableDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required. Use a disposable local _test database.');
  const url = new URL(connectionString);
  const host = url.searchParams.get('host') || url.hostname;
  if (!['localhost', '127.0.0.1', '/var/run/postgresql'].includes(host) || !url.pathname.endsWith('_test')
    || process.env.CREWMODO_RESET_TEST_DB !== '1') {
    throw new Error('Tests refuse remote/non-test databases or missing reset permission.');
  }
  return new pg.Pool({ connectionString, max: 12 });
}

export async function migrateDisposableDatabase(pool: pg.Pool) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const journal = JSON.parse(await readFile(new URL('../../packages/db/migrations/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) {
    const contents = await readFile(new URL(`../../packages/db/migrations/${entry.tag}.sql`, import.meta.url), 'utf8');
    for (const statement of contents.split('--> statement-breakpoint')) if (statement.trim()) await pool.query(statement);
  }
}

// Exercise the actual Neon HTTP/Drizzle adapter, but execute its SQL against disposable Postgres.
// Provider transport is replaced; database results, constraints and transactions are not mocked.
export function bridgeNeonToPostgres(pool: pg.Pool) {
  const requireDb = createRequire(new URL('../../packages/db/package.json', import.meta.url));
  const { neonConfig } = requireDb('@neondatabase/serverless');
  const original = neonConfig.fetchFunction;
  neonConfig.fetchFunction = async (_url: string, options: RequestInit) => {
    const connection = new URL(new Headers(options.headers).get('Neon-Connection-String') || '');
    if (connection.hostname !== 'localhost' || !connection.pathname.endsWith('_test')) throw new Error('A test attempted a non-local database request.');
    const body = JSON.parse(String(options.body));
    if (body.queries) throw new Error('Implement explicit local transaction handling before testing Neon batches.');
    try {
      const result = await pool.query({ text: body.query, values: body.params, rowMode: 'array' });
      return Response.json({ ...result, rows: result.rows.map((row: unknown[]) => row.map((value, index) => {
        if (value === null) return null;
        if ([114, 3802].includes(result.fields[index].dataTypeID)) return JSON.stringify(value);
        if (typeof value === 'boolean') return value ? 't' : 'f';
        if (value instanceof Date) {
          return result.fields[index].dataTypeID === 1114
            ? value.toISOString().replace('T', ' ').replace('Z', '') : value.toISOString();
        }
        return String(value);
      })) });
    } catch (error) {
      return Response.json({ ...(error as Record<string, unknown>), message: (error as Error).message }, { status: 400 });
    }
  };
  return () => { neonConfig.fetchFunction = original; };
}
