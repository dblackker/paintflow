export interface Env {
  DATABASE_URL: string;
  KV: KVNamespace;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
}

export type Variables = {
  orgId: string;
  userId?: string;
};
