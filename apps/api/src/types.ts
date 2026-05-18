export interface Env {
  APP_URL: string;
  DATABASE_URL: string;
  ENVIRONMENT: string;
  KV: KVNamespace;
  R2?: R2Bucket;
  PUBLIC_URL: string;
  COOKIE_DOMAIN?: string;
  RESEND_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_STARTER_PRICE_ID: string;
  STRIPE_PRO_PRICE_ID: string;
  STRIPE_ENTERPRISE_PRICE_ID: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  QB_CLIENT_ID: string;
  QB_CLIENT_SECRET: string;
  QB_WEBHOOK_VERIFIER_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  CRON_SECRET: string;
}

export type Variables = {
  orgId: string;
  userId?: string;
  session?: unknown;
  userRole?: string;
  permissions?: string[];
};
