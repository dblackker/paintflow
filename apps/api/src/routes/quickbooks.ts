import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { quickbooksConnections, leads, estimates, orgSettings } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createOAuthState, consumeOAuthState } from '../auth';
import { getCompanyInfo, createQBCustomer, createQBInvoice, getTaxCodes, getItems } from '../lib/quickbooks';

const qb = new Hono<{ Bindings: Env; Variables: Variables }>();

qb.use('/connect', authMiddleware);
qb.use('/status', authMiddleware);
qb.use('/sync/*', authMiddleware);
qb.use('/disconnect', authMiddleware);
qb.use('/tax-codes', authMiddleware);
qb.use('/items', authMiddleware);
qb.use('/settings', authMiddleware);

// GET /v1/quickbooks/connect
qb.get('/connect', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const state = await createOAuthState(c.env, 'quickbooks', orgId, userId);
  
  const authUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
  authUrl.searchParams.set('client_id', c.env.QB_CLIENT_ID);
  authUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
  authUrl.searchParams.set('redirect_uri', `${c.env.APP_URL}/v1/quickbooks/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);
  
  return c.redirect(authUrl.toString());
});

// GET /v1/quickbooks/callback
qb.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const realmId = c.req.query('realmId');
  
  if (!code || !realmId || !state) {
    return c.json({ error: 'Missing code, realmId, or state' }, 400);
  }

  const stateData = await consumeOAuthState(c.env, 'quickbooks', state);
  if (!stateData) {
    return c.json({ error: 'Invalid or expired state' }, 400);
  }
  
  try {
    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${c.env.QB_CLIENT_ID}:${c.env.QB_CLIENT_SECRET}`),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${c.env.APP_URL}/v1/quickbooks/callback`,
      }),
    });
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('QB token error:', error);
      return c.json({ error: 'Failed to get tokens' }, 500);
    }
    
    const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string; expires_in: number };
    const companyInfo = await getCompanyInfo(c.env, tokens.access_token, realmId);
    const companyName = companyInfo.CompanyInfo?.CompanyName || 'QuickBooks Company';
    const orgId = stateData.orgId;
    
    const db = createDb(c.env.DATABASE_URL);
    await db.insert(quickbooksConnections)
      .values({
        orgId,
        realmId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        companyName,
      })
      .onConflictDoUpdate({
        target: quickbooksConnections.orgId,
        set: {
          realmId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          companyName,
          updatedAt: new Date(),
        },
      });
    
    return c.redirect(`${c.env.PUBLIC_URL}/settings?qb_connected=true`);
  } catch (err) {
    console.error('QB callback error:', err);
    return c.json({ error: 'Connection failed' }, 500);
  }
});

// GET /v1/quickbooks/status
qb.get('/status', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const connection = await db.query.quickbooksConnections.findFirst({
    where: eq(quickbooksConnections.orgId, orgId),
  });
  
  if (!connection) {
    return c.json({ connected: false });
  }
  
  return c.json({
    connected: true,
    companyName: connection.companyName,
    connectedAt: connection.connectedAt,
  });
});

// GET /v1/quickbooks/tax-codes
qb.get('/tax-codes', async (c) => {
  const orgId = c.get('orgId');
  try {
    const taxCodes = await getTaxCodes(c.env, orgId);
    return c.json({ data: taxCodes });
  } catch (err) {
    console.error('QB tax codes error:', err);
    return c.json({ error: 'Failed to fetch tax codes' }, 500);
  }
});

// GET /v1/quickbooks/items
qb.get('/items', async (c) => {
  const orgId = c.get('orgId');
  try {
    const items = await getItems(c.env, orgId);
    return c.json({ data: items });
  } catch (err) {
    console.error('QB items error:', err);
    return c.json({ error: 'Failed to fetch items' }, 500);
  }
});

// GET /v1/quickbooks/settings
qb.get('/settings', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  
  return c.json({ data: settings || {} });
});

// PUT /v1/quickbooks/settings
qb.put('/settings', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  
  const [settings] = await db.insert(orgSettings)
    .values({
      orgId,
      qbTaxCode: body.qbTaxCode,
      qbItemId: body.qbItemId,
    })
    .onConflictDoUpdate({
      target: orgSettings.orgId,
      set: {
        qbTaxCode: body.qbTaxCode,
        qbItemId: body.qbItemId,
        updatedAt: new Date(),
      },
    })
    .returning();
  
  return c.json({ data: settings });
});

// POST /v1/quickbooks/sync/customer/:leadId
qb.post('/sync/customer/:leadId', async (c) => {
  const orgId = c.get('orgId');
  const leadId = c.req.param('leadId');
  const db = createDb(c.env.DATABASE_URL);
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
  });
  
  if (!lead || lead.orgId !== orgId) {
    return c.json({ error: 'Lead not found' }, 404);
  }
  
  try {
    const customerId = await createQBCustomer(c.env, orgId, lead);
    return c.json({ success: true, customerId });
  } catch (err) {
    console.error('QB sync customer error:', err);
    return c.json({ error: 'Failed to sync customer' }, 500);
  }
});

// POST /v1/quickbooks/sync/invoice/:estimateId
qb.post('/sync/invoice/:estimateId', async (c) => {
  const orgId = c.get('orgId');
  const estimateId = c.req.param('estimateId');
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, estimateId),
  });
  
  if (!estimate || estimate.orgId !== orgId) {
    return c.json({ error: 'Estimate not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }
  
  try {
    const invoiceId = await createQBInvoice(c.env, orgId, estimate, lead);
    return c.json({ success: true, invoiceId });
  } catch (err) {
    console.error('QB sync invoice error:', err);
    return c.json({ error: 'Failed to sync invoice' }, 500);
  }
});

// POST /v1/quickbooks/disconnect
qb.post('/disconnect', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  await db.delete(quickbooksConnections)
    .where(eq(quickbooksConnections.orgId, orgId));

  return c.json({ success: true });
});

// POST /v1/quickbooks/webhook
qb.post('/webhook', async (c) => {
  const signature = c.req.header('intuit-signature');
  const body = await c.req.text();
  
  if (c.env.QB_WEBHOOK_VERIFIER_TOKEN) {
    if (!signature) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(c.env.QB_WEBHOOK_VERIFIER_TOKEN),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedSig = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    
    if (expectedSig !== signature) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }
  
  try {
    const event = JSON.parse(body);
    const db = createDb(c.env.DATABASE_URL);
    
    for (const notification of event.eventNotifications || []) {
      const realmId = notification.realmId;
      
      const connection = await db.query.quickbooksConnections.findFirst({
        where: eq(quickbooksConnections.realmId, realmId),
      });
      
      if (!connection) continue;
      
      for (const dataChange of notification.dataChangeEvent?.entities || []) {
        const { name, id, operation } = dataChange;
        
        console.log(`QB webhook: ${operation} ${name} ${id} for realm ${realmId}`);
        
        if (name === 'Payment' && operation === 'Create') {
          try {
            const paymentRes = await fetch(
              `https://quickbooks.api.intuit.com/v3/company/${realmId}/payment/${id}`,
              {
                headers: {
                  'Authorization': `Bearer ${connection.accessToken}`,
                  'Accept': 'application/json',
                },
              }
            );
            
            if (paymentRes.ok) {
              const payment = await paymentRes.json() as any;
              const linkedInvoiceId = payment.QueryResponse?.Payment?.[0]?.Line?.[0]?.LinkedTxn?.[0]?.TxnId;
              
              if (linkedInvoiceId) {
                const estimate = await db.query.estimates.findFirst({
                  where: eq(estimates.qboInvoiceId, linkedInvoiceId),
                });
                
                if (estimate) {
                  await db.update(estimates)
                    .set({ 
                      qboPaymentId: id,
                      status: 'accepted',
                      updatedAt: new Date()
                    })
                    .where(eq(estimates.id, estimate.id));
                  
                  console.log(`Synced payment ${id} to estimate ${estimate.id}`);
                }
              }
            }
          } catch (err) {
            console.error('Failed to sync payment:', err);
          }
        }
        
        if (name === 'Invoice' && operation === 'Update') {
          console.log(`Invoice updated in QB: ${id}`);
        }
      }
    }
    
    return c.json({ received: true });
  } catch (err) {
    console.error('QB webhook error:', err);
    return c.json({ error: 'Webhook failed' }, 500);
  }
});

export default qb;
