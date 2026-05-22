export interface Env {
  APP_URL: string;
  DATABASE_URL: string;
  ENVIRONMENT: string;
  KV: KVNamespace;
  R2?: R2Bucket;
  PUBLIC_URL: string;
  CORS_ORIGINS?: string;
  COOKIE_DOMAIN?: string;
  MAGIC_LINK_EMAIL_LIMIT?: string;
  MAGIC_LINK_IP_LIMIT?: string;
  EMAIL_PROVIDER?: 'mailchannels' | 'resend';
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  MAILCHANNELS_API_KEY?: string;
  RESEND_API_KEY?: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_STARTER_PRICE_ID: string;
  STRIPE_PRO_PRICE_ID: string;
  STRIPE_ENTERPRISE_PRICE_ID: string;
  STRIPE_CONNECT_CLIENT_ID?: string;
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
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export type Variables = {
  orgId: string;
  userId?: string;
  session?: unknown;
  userRole?: string;
  permissions?: string[];
  authSource?: 'cookie' | 'bearer' | 'none';
};
