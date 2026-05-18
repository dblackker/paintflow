import type { Context, Next } from 'hono';

export const securityHeaders = async (c: Context, next: Next) => {
  await next();
  
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  
  // Only in production
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
};

export const corsHeaders = async (c: Context, next: Next) => {
  const origin = c.req.header('Origin');
  const allowedOrigins = [
    'https://app.paintflow.app',
    'https://paintflow.app',
    'http://localhost:4321',
  ];
  
  if (origin && allowedOrigins.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }
  
  await next();
};
