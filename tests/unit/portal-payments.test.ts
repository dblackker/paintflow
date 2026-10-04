import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPortalRoutes, portalInvoicePaymentState } from '../../apps/api/src/routes/portal.ts';
import type { ObligationBalance } from '../../apps/api/src/lib/payment-operations.ts';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const dialect = new PgDialect();
const env = { DATABASE_URL: 'synthetic-no-database', PUBLIC_URL: 'https://app.example.test' } as any;
const token = { token: 'synthetic-public-token', orgId: 'org-a', leadId: 'lead-a', expiresAt: new Date('2099-01-01') };
const invoice = { id: 'invoice-a', orgId: token.orgId, leadId: token.leadId, jobId: 'job-a', estimateId: null,
  changeOrderId: null, total: '100.00', status: 'sent', description: 'Project deposit', invoiceNumber: 'INV-100', dueDate: null };
const balance: ObligationBalance = { total: '100.00', allocated: '60.00', credits: '0.00', netCollected: '60.00',
  remaining: '40.00', closed: false, needsReview: false, pendingRefunds: 0 };
const order = { id: 'change-a', orgId: token.orgId, jobId: 'job-a', status: 'approved', paymentRequired: true,
  paymentStatus: 'pending', amount: '500.00', paymentDueAmount: '500.00' };
const job = { id: 'job-a', orgId: token.orgId, leadId: token.leadId };

function fixtures(options: { invoice?: any; balances?: Record<string, ObligationBalance>; token?: any; processing?: boolean;
  legacyChangePayment?: boolean; order?: any; relatedInvoices?: any[]; ledgerUnavailable?: boolean } = {}) {
  const item = options.invoice ?? invoice;
  const publicToken = options.token ?? token;
  const change = options.order ?? order;
  const filters: { name: string; params: unknown[]; text: string }[] = [];
  const calls: { org: string; invoice: string | null; estimate: string | null }[] = [];
  const checkout: any[] = [];
  const capture = (name: string, where: any) => {
    const query = dialect.sqlToQuery(where);
    filters.push({ name, params: query.params, text: query.sql });
    return query.params;
  };
  const db = {
    query: {
      portalTokens: { findFirst: async ({ where }: any) => capture('token', where)[0] === publicToken.token ? publicToken : undefined },
      leads: { findFirst: async ({ where }: any) => { capture('lead', where); return { id: token.leadId, orgId: token.orgId, name: 'Synthetic customer' }; } },
      estimates: { findFirst: async ({ where }: any) => { capture('estimate', where); return { id: 'estimate-a', orgId: token.orgId, signedAt: '2026-09-01' }; } },
      jobs: { findFirst: async ({ where }: any) => { const params = capture('job', where); return params.includes(job.orgId) && params.includes(job.leadId) ? job : undefined; } },
      changeOrders: {
        findFirst: async ({ where }: any) => { const params = capture('order', where); return params.includes(change.id) && params.includes(change.orgId) ? change : undefined; },
        findMany: async ({ where }: any) => { capture('orders', where); return []; },
      },
      customerInvoices: {
        findFirst: async ({ where }: any) => { const params = capture('invoice', where); return [item.id, item.orgId, item.leadId].every((value) => params.includes(value)) ? item : undefined; },
        findMany: async ({ where }: any) => { capture('invoices', where); return options.relatedInvoices ?? [item]; },
      },
      customerPayments: {
        findFirst: async ({ where }: any) => {
          capture('payment', where);
          const query = dialect.sqlToQuery(where).sql;
          return query.includes('"invoice_id" is null') ? (options.legacyChangePayment ? { id: 'legacy-payment' } : undefined)
            : options.processing ? { id: 'processing-payment' } : undefined;
        },
        // Deliberately incomplete display history: it is NOT the financial source of truth.
        findMany: async ({ where }: any) => { capture('history', where); return []; },
      },
      stripeConnections: { findFirst: async ({ where }: any) => {
        capture('stripe', where); return { onboardingComplete: true, stripeAccountId: 'acct_synthetic' };
      } },
    },
    execute: async (sql: any) => { capture('ledger', sql); return { rows: [{ result: balance }] }; },
    update: () => assert.fail('Checkout or portal read mutated a signed document/payment status'),
    insert: () => assert.fail('Checkout or portal read invented a payment/ledger entry'),
  };
  const deps = {
    db: () => db as any,
    balance: async (_db: any, org: string, invoiceId: string | null, estimateId: string | null) => {
      calls.push({ org, invoice: invoiceId, estimate: estimateId });
      if (options.ledgerUnavailable) throw new Error('Synthetic ledger unavailable');
      return options.balances?.[invoiceId || estimateId || ''] ?? balance;
    },
    checkout: async (_env: any, params: any) => { checkout.push(params); return { id: 'session-synthetic', url: 'https://checkout.stripe.com/c/pay/synthetic' }; },
  };
  return { db, deps, calls, filters, checkout };
}

test('invoice balance/credit summaries come from the authoritative obligation, not refunded net cash', () => {
  const state = portalInvoicePaymentState(invoice as any, { ...balance, allocated: '100.00', credits: '25.00', netCollected: '75.00', remaining: '0.00' });
  assert.equal(state.balanceDue, '0.00');
  assert.equal(state.status, 'partially_refunded');
  assert.equal(state.creditedAmount, '25.00');
  assert.equal(state.payable, false);
  assert.equal(state.balance.remaining, '0.00');
  assert.equal(invoice.total, '100.00');
});

test('full credit refunds stay terminal and legacy unknown refund dispositions require review', () => {
  const refunded = portalInvoicePaymentState(invoice as any, { ...balance, allocated: '100.00', credits: '100.00', netCollected: '0.00', remaining: '0.00', closed: true });
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.payable, false);
  const legacy = portalInvoicePaymentState(invoice as any, { ...balance, needsReview: true, remaining: '0.00' });
  assert.equal(legacy.status, 'needs_review');
  assert.equal(legacy.balanceDue, null);
  assert.equal(legacy.payable, false);
});

test('remaining unpaid balance is collectible after a partial credit, but credited money is not added back', () => {
  const state = portalInvoicePaymentState(invoice as any, { ...balance, allocated: '75.00', credits: '25.00', netCollected: '50.00', remaining: '25.00' });
  assert.equal(state.balanceDue, '25.00');
  assert.equal(state.payable, true);
});

test('checkout-attempt pending status becomes due; only recorded provider processing disables another checkout', () => {
  const pending = { ...invoice, status: 'payment_pending' };
  assert.equal(portalInvoicePaymentState(pending as any, balance).status, 'due');
  assert.equal(portalInvoicePaymentState(pending as any, balance).payable, true);
  const processing = portalInvoicePaymentState(pending as any, balance, { processing: true });
  assert.equal(processing.status, 'processing');
  assert.equal(processing.payable, false);
  assert.match(processing.paymentUnavailableReason!, /submitted payment/);
});

test('refund reservations, inconsistent legacy paid state, malformed balance and due dates fail safely', () => {
  assert.equal(portalInvoicePaymentState(invoice as any, { ...balance, pendingRefunds: 1 }).payable, false);
  assert.equal(portalInvoicePaymentState({ ...invoice, status: 'paid' } as any, balance).needsReview, true);
  assert.equal(portalInvoicePaymentState({ ...invoice, dueDate: '2026-09-30' } as any, balance, { now: new Date('2026-10-01') }).status, 'overdue');
  assert.equal(portalInvoicePaymentState({ ...invoice, dueDate: '2026-10-01' } as any, balance, { now: new Date('2026-10-01T23:59:00Z') }).status, 'due');
  assert.throws(() => portalInvoicePaymentState(invoice as any, { ...balance, remaining: 'not-money' }), (error: any) => error.code === 'PAYMENT_BALANCE_UNAVAILABLE');
});

test('invoice checkout ignores caller amount and charges only freshly read authoritative cents', async () => {
  const f = fixtures();
  const response = await createPortalRoutes(f.deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, {
    method: 'POST', body: JSON.stringify({ amount: 9999 }), headers: { 'Content-Type': 'application/json' },
  }, env);
  assert.equal(response.status, 200);
  assert.equal(f.checkout.length, 1);
  assert.equal(f.checkout[0].amount, 40);
  assert.equal(f.checkout[0].metadata.invoiceId, invoice.id);
  assert.deepEqual(f.calls, [{ org: token.orgId, invoice: invoice.id, estimate: null }]);
  assert.equal((await response.json()).data.amountDue, '40.00');
});

test('the real readPaymentBalance SQL helper is tenant scoped at the portal integration point', async () => {
  const f = fixtures();
  const { balance: _balance, ...deps } = f.deps;
  const response = await createPortalRoutes(deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, { method: 'POST' }, env);
  assert.equal(response.status, 200);
  const sql = f.filters.find((entry) => entry.name === 'ledger')!;
  assert.match(sql.text, /payment_obligation_balance/);
  assert.deepEqual(sql.params, [token.orgId, invoice.id, null]);
  assert.equal(f.checkout[0].amount, 40);
});

test('legacy agreement payments cap linked invoices and never change the signed total', async () => {
  const item = { ...invoice, estimateId: 'estimate-a' };
  const f = fixtures({ invoice: item, balances: { 'estimate-a': { ...balance, remaining: '10.25' } } });
  const response = await createPortalRoutes(f.deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, { method: 'POST' }, env);
  assert.equal(response.status, 200);
  assert.equal(f.checkout[0].amount, 10.25);
  assert.deepEqual(f.calls.map((call) => [call.invoice, call.estimate]), [[invoice.id, null], [null, 'estimate-a']]);
  assert.equal(item.total, '100.00');
});

test('no checkout occurs for credit-closed, needs-review, processing or refund-reserved balances', async () => {
  for (const options of [
    { balances: { [invoice.id]: { ...balance, closed: true, remaining: '0.00', credits: '100.00' } } },
    { balances: { [invoice.id]: { ...balance, needsReview: true } } },
    { balances: { [invoice.id]: { ...balance, pendingRefunds: 1 } } },
    { processing: true }, { ledgerUnavailable: true },
  ]) {
    const f = fixtures(options);
    const response = await createPortalRoutes(f.deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, { method: 'POST' }, env);
    assert.equal(response.status, options.ledgerUnavailable ? 503 : 409);
    assert.deepEqual(f.checkout, []);
  }
});

test('GET exposes authoritative balances/credits even when display payment history is empty', async () => {
  const f = fixtures({ balances: { [invoice.id]: { ...balance, allocated: '100.00', credits: '25.00', netCollected: '75.00', remaining: '0.00' } } });
  const response = await createPortalRoutes(f.deps).request('/synthetic-public-token', {}, env);
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.invoices[0].balanceDue, '0.00');
  assert.equal(data.invoices[0].creditedAmount, '25.00');
  assert.equal(data.invoices[0].balance.allocated, '100.00');
  assert.equal(data.invoices[0].payable, false);
  assert.equal(data.estimate.signedAt, '2026-09-01');
});

test('ledger outage blocks payment but keeps signed documents accessible in the portal', async () => {
  const f = fixtures({ ledgerUnavailable: true });
  const response = await createPortalRoutes(f.deps).request('/synthetic-public-token', {}, env);
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.estimate.signedAt, '2026-09-01');
  assert.equal(data.invoices[0].payable, false);
  assert.equal(data.invoices[0].balance, null);
  assert.equal(data.invoices[0].balanceDue, null);
});

test('change order checkout uses its related invoice balance, never the old change order amount', async () => {
  const item = { ...invoice, changeOrderId: order.id };
  const f = fixtures({ invoice: item });
  const response = await createPortalRoutes(f.deps).request(`/synthetic-public-token/change-orders/${order.id}/checkout`, { method: 'POST' }, env);
  assert.equal(response.status, 200);
  assert.equal(f.checkout[0].amount, 40);
  assert.equal(f.checkout[0].metadata.invoiceId, invoice.id);
  assert.equal(f.checkout[0].metadata.changeOrderId, order.id);
  assert.match(f.checkout[0].cancelUrl, /invoicePaymentCanceled=invoice-a/);
  assert.equal(order.paymentStatus, 'pending');
});

test('legacy unsupported or ambiguous change order invoices cannot start an unsafe independent charge', async () => {
  for (const relatedInvoices of [[], [{ ...invoice, changeOrderId: order.id }, { ...invoice, id: 'duplicate', changeOrderId: order.id }]]) {
    const f = fixtures({ relatedInvoices });
    const response = await createPortalRoutes(f.deps).request(`/synthetic-public-token/change-orders/${order.id}/checkout`, { method: 'POST' }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'CHANGE_ORDER_INVOICE_REQUIRED');
    assert.deepEqual(f.checkout, []);
  }
  const legacy = fixtures({ invoice: { ...invoice, changeOrderId: order.id }, legacyChangePayment: true });
  const response = await createPortalRoutes(legacy.deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, { method: 'POST' }, env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PAYMENT_REVIEW_REQUIRED');
  assert.deepEqual(legacy.checkout, []);
});

test('public token scopes invoices/jobs to its customer and rejects expired tokens', async () => {
  const foreign = fixtures({ invoice: { ...invoice, leadId: 'lead-b' } });
  const response = await createPortalRoutes(foreign.deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, { method: 'POST' }, env);
  assert.equal(response.status, 404);
  assert.deepEqual(foreign.checkout, []);
  const expired = fixtures({ token: { ...token, expiresAt: new Date(0) } });
  assert.equal((await createPortalRoutes(expired.deps).request(`/synthetic-public-token/invoices/${invoice.id}/checkout`, { method: 'POST' }, env)).status, 404);
  assert.deepEqual(expired.calls, []);
});

test('unallocated arbitrary-amount portal pay route is retired', async () => {
  const f = fixtures();
  const response = await createPortalRoutes(f.deps).request('/synthetic-public-token/pay', { method: 'POST', body: '{"amount":10000}' }, env);
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'INVOICE_REQUIRED');
  assert.deepEqual(f.checkout, []);
});

test('Postgres integer and trailing-zero numeric scales normalize without accepting negative or fractional cents', () => {
  const state = portalInvoicePaymentState(invoice as any, { ...balance, total: '100', allocated: '100.0000',
    credits: '0.0000', netCollected: '100.00', remaining: '0.00' });
  assert.equal(state.payable, false);
  assert.equal(state.balance.total, '100.00');
  assert.equal(state.balance.credits, '0.00');
  for (const remaining of ['-1', '0.001', '100000000.00', 'NaN']) {
    assert.throws(() => portalInvoicePaymentState(invoice as any, { ...balance, remaining }), (error: any) => error.code === 'PAYMENT_BALANCE_UNAVAILABLE');
  }
});
