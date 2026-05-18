import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL!;

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
