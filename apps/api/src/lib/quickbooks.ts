import { createDb } from '@paintflow/db';
import { quickbooksConnections, leads, estimates } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';

export const QB_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com';
export const QB_PROD_BASE = 'https://quickbooks.api.intuit.com';

export function getQbBase(env: any): string {
  return env.QB_ENV === 'production' ? QB_PROD_BASE : QB_SANDBOX_BASE;
}

export async function getValidAccessToken(env: any, orgId: string): Promise<string> {
  const db = createDb(env.DATABASE_URL);
  
  const connection = await db.query.quickbooksConnections.findFirst({
    where: eq(quickbooksConnections.orgId, orgId),
  });
  
  if (!connection) {
    throw new Error('QuickBooks not connected');
  }
  
  // Check if token expires in next 5 minutes
  const expiresAt = new Date(connection.tokenExpiresAt).getTime();
  const now = Date.now();
  
  if (expiresAt - now < 5 * 60 * 1000) {
    // Refresh token
    const tokens = await refreshAccessToken(env, connection.refreshToken);
    
    await db.update(quickbooksConnections)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(quickbooksConnections.id, connection.id));
    
    return tokens.access_token;
  }
  
  return connection.accessToken;
}

export async function refreshAccessToken(env: any, refreshToken: string) {
  const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('QB token refresh error:', error);
    throw new Error('Failed to refresh QB token');
  }
  
  return await response.json();
}

export async function createQBCustomer(env: any, orgId: string, lead: any) {
  const accessToken = await getValidAccessToken(env, orgId);
  const base = getQbBase(env);
  
  const connection = await createDb(env.DATABASE_URL).query.quickbooksConnections.findFirst({
    where: eq(quickbooksConnections.orgId, orgId),
  });
  
  const payload = {
    DisplayName: lead.name,
    PrimaryEmailAddr: lead.email ? { Address: lead.email } : undefined,
    PrimaryPhone: lead.phone ? { FreeFormNumber: lead.phone } : undefined,
  };
  
  const response = await fetch(
    `${base}/v3/company/${connection!.realmId}/customer`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  
  if (!response.ok) {
    const error = await response.text();
    console.error('QB customer create error:', error);
    throw new Error('Failed to create QB customer');
  }
  
  const result = await response.json();
  const customerId = result.Customer.Id;
  
  // Save customer ID
  const db = createDb(env.DATABASE_URL);
  await db.update(leads)
    .set({ qboCustomerId: customerId })
    .where(eq(leads.id, lead.id));
  
  return customerId;
}

export async function createQBInvoice(env: any, orgId: string, estimate: any, lead: any) {
  const accessToken = await getValidAccessToken(env, orgId);
  const base = getQbBase(env);
  
  const connection = await createDb(env.DATABASE_URL).query.quickbooksConnections.findFirst({
    where: eq(quickbooksConnections.orgId, orgId),
  });
  
  // Ensure customer exists
  let customerId = lead.qboCustomerId;
  if (!customerId) {
    customerId = await createQBCustomer(env, orgId, lead);
  }
  
  const packages = estimate.packages || [];
  const lineItems = packages.map((pkg: any, idx: number) => ({
    Id: (idx + 1).toString(),
    LineNum: idx + 1,
    Amount: pkg.total,
    DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: {
      ItemRef: {
        value: '1', // Use generic service item
        name: 'Painting Services',
      },
      Qty: 1,
      UnitPrice: pkg.total,
    },
    Description: pkg.name,
  }));
  
  const payload = {
    CustomerRef: { value: customerId },
    Line: lineItems,
    TxnDate: new Date().toISOString().split('T')[0],
    PrivateNote: `PaintFlow Estimate ${estimate.id}`,
  };
  
  const response = await fetch(
    `${base}/v3/company/${connection!.realmId}/invoice`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
  
  if (!response.ok) {
    const error = await response.text();
    console.error('QB invoice create error:', error);
    throw new Error('Failed to create QB invoice');
  }
  
  const result = await response.json();
  const invoiceId = result.Invoice.Id;
  
  // Save invoice ID
  const db = createDb(env.DATABASE_URL);
  await db.update(estimates)
    .set({ qboInvoiceId: invoiceId })
    .where(eq(estimates.id, estimate.id));
  
  return invoiceId;
}

export async function getCompanyInfo(env: any, accessToken: string, realmId: string) {
  const base = getQbBase(env);
  
  const response = await fetch(
    `${base}/v3/company/${realmId}/companyinfo/${realmId}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch company info');
  }
  
  return await response.json();
}
