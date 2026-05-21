export async function createCheckoutSession(env: any, params: {
  amount: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  connectedAccountId?: string;
  productName?: string;
}) {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(params.connectedAccountId ? { 'Stripe-Account': params.connectedAccountId } : {}),
    },
    body: new URLSearchParams({
      'mode': 'payment',
      'success_url': params.successUrl,
      'cancel_url': params.cancelUrl,
      'line_items[0][price_data][currency]': params.currency || 'usd',
      'line_items[0][price_data][product_data][name]': params.productName || 'Painting Services - 50% Deposit',
      'line_items[0][price_data][unit_amount]': Math.round(params.amount * 100).toString(),
      'line_items[0][quantity]': '1',
      ...Object.entries(params.metadata).reduce((acc, [key, value]) => {
        acc[`metadata[${key}]`] = value;
        return acc;
      }, {} as Record<string, string>),
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('Stripe error:', error);
    throw new Error('Failed to create checkout session');
  }
  
  return await response.json() as { id: string; url: string | null };
}

export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  // Stripe webhook signature verification
  // Format: t=timestamp,v1=signature
  const parts = signature.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const sig = parts.find(p => p.startsWith('v1='))?.split('=')[1];
  
  if (!timestamp || !sig) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) return false;
  
  const signedPayload = `${timestamp}.${payload}`;
  
  // Compute HMAC SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );
  
  const expectedSig = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return timingSafeEqual(expectedSig, sig);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }

  return diff === 0;
}
