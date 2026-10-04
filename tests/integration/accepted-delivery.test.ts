import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deliverAcceptedEstimate } from '../../apps/api/src/lib/accepted-estimate-delivery';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const originalFetch = globalThis.fetch;
const sender = { EMAIL_FROM: 'sender-before@example.invalid', EMAIL_FROM_NAME: 'Original sender' };
const env = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_delivery_test',
  ENVIRONMENT: 'test',
  PUBLIC_URL: 'https://example.invalid',
  EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 'synthetic_never_live',
  ...sender,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForSend(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The mocked provider send did not start.')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe(
  'accepted delivery frozen retries and attempt fencing',
  { concurrency: 1 },
  () => {
    let pool: ReturnType<typeof disposableDatabase>;
    let restore: (() => void) | undefined;
    before(async () => {
      pool = disposableDatabase();
      restore = bridgeNeonToPostgres(pool);
      await migrateDisposableDatabase(pool);
    });
    beforeEach(() => {
      globalThis.fetch = async () => {
        throw new Error('Unexpected external request in accepted delivery tests.');
      };
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });
    after(async () => {
      restore?.();
      globalThis.fetch = originalFetch;
      await pool?.end();
    });

    async function fixture() {
      const orgId = randomUUID();
      const leadId = randomUUID();
      const estimateId = randomUUID();
      const invoiceId = randomUUID();
      const deliveryId = randomUUID();
      const portalUrl = `https://example.invalid/portal/frozen-${deliveryId}?invoiceId=${invoiceId}`;
      await pool.query('insert into organizations(id,name,slug) values($1,$2,$2)', [
        orgId,
        `delivery-${orgId}`,
      ]);
      await pool.query(
        "insert into leads(id,org_id,name,email) values($1,$2,'Original customer','customer-before@example.invalid')",
        [leadId, orgId],
      );
      await pool.query(
        "insert into org_settings(org_id,company_name,email,phone) values($1,'Original company','reply-before@example.invalid','5550000001')",
        [orgId],
      );
      await pool.query(
        "insert into email_templates(org_id,key,category,name,subject,html,text) values($1,'invoice.deposit.created','invoice','Original deposit template','Original {{invoiceNumber}} for {{leadName}}',$2,$3)",
        [
          orgId,
          '<p>Original {{leadName}} | {{companyName}} | {{invoiceAmount}} | {{portalUrl}}</p>',
          'Original text for {{leadName}} | {{invoiceAmount}}',
        ],
      );
      await pool.query(
        "insert into estimates(id,org_id,lead_id,status,total,packages,signed_at) values($1,$2,$3,'accepted',110.35,'[]',now())",
        [estimateId, orgId, leadId],
      );
      await pool.query(
        "insert into customer_invoices(id,org_id,lead_id,estimate_id,invoice_number,description,line_items,subtotal,tax,total) values($1,$2,$3,$4,'DEP-SYNTHETIC','Original deposit','[]',55.18,0,55.18)",
        [invoiceId, orgId, leadId, estimateId],
      );
      await pool.query(
        'insert into accepted_estimate_deliveries(id,org_id,estimate_id,invoice_id,portal_url) values($1,$2,$3,$4,$5)',
        [deliveryId, orgId, estimateId, invoiceId, portalUrl],
      );
      return { orgId, leadId, estimateId, invoiceId, deliveryId, portalUrl };
    }

    type Fixture = Awaited<ReturnType<typeof fixture>>;
    type ProviderRequest = { body: string; key: string };
    function capture(f: Fixture, url: string | URL | Request, options?: RequestInit): ProviderRequest {
      assert.equal(String(url), 'https://api.resend.com/emails');
      assert.equal(options?.method, 'POST');
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('Authorization'), 'Bearer synthetic_never_live');
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.equal(headers.get('Idempotency-Key'), `accepted-estimate/${f.deliveryId}`);
      assert.equal(typeof options?.body, 'string');
      return { body: String(options!.body), key: headers.get('Idempotency-Key')! };
    }
    async function stored(f: Fixture) {
      return (
        await pool.query('select * from accepted_estimate_deliveries where org_id=$1 and id=$2', [
          f.orgId,
          f.deliveryId,
        ])
      ).rows[0];
    }
    async function logs(f: Fixture) {
      return (
        await pool.query("select * from email_sends where org_id=$1 and metadata->>'deliveryKey'=$2", [
          f.orgId,
          `accepted-estimate/${f.deliveryId}`,
        ])
      ).rows;
    }

    test('failed retry freezes byte-identical Resend payload and key despite changed template, sender and customer', async () => {
      const f = await fixture();
      const requests: ProviderRequest[] = [];
      globalThis.fetch = async (url, options) => {
        requests.push(capture(f, url, options));
        return requests.length === 1
          ? Response.json({ error: 'Synthetic transient failure' }, { status: 503 })
          : Response.json({ id: `synthetic-${f.deliveryId}` });
      };
      await deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      assert.equal(requests.length, 1);
      const first = await stored(f);
      assert.equal(first.status, 'pending');
      assert.equal(first.attempts, 1);
      assert.ok(first.lease_until);
      assert.ok(first.prepared_email);
      assert.equal((await logs(f)).length, 0);
      const expectedBody = JSON.stringify({
        from: 'Original sender <sender-before@example.invalid>',
        to: ['customer-before@example.invalid'],
        subject: 'Original DEP-SYNTHETIC for Original customer',
        html: `<p>Original Original customer | Original company | $55.18 | ${f.portalUrl}</p>`,
        reply_to: 'reply-before@example.invalid',
      });
      assert.equal(requests[0].body, expectedBody);

      await pool.query(
        "update leads set name='Changed customer',email='customer-after@example.invalid' where id=$1 and org_id=$2",
        [f.leadId, f.orgId],
      );
      await pool.query(
        "update org_settings set company_name='Changed company',email='reply-after@example.invalid',phone='5550000002' where org_id=$1",
        [f.orgId],
      );
      await pool.query(
        "update email_templates set name='Changed template',subject='CHANGED SUBJECT',html='<p>CHANGED BODY</p>',text='CHANGED TEXT' where org_id=$1",
        [f.orgId],
      );
      await pool.query(
        "update customer_invoices set invoice_number='DEP-CHANGED',description='Changed deposit',subtotal=99.99,total=99.99 where id=$1 and org_id=$2",
        [f.invoiceId, f.orgId],
      );
      await pool.query(
        "update accepted_estimate_deliveries set portal_url='https://example.invalid/changed',lease_until=now()-interval '1 second' where id=$1 and org_id=$2",
        [f.deliveryId, f.orgId],
      );
      await deliverAcceptedEstimate(
        {
          ...env,
          EMAIL_FROM: 'sender-after@example.invalid',
          EMAIL_FROM_NAME: 'Changed sender',
          PUBLIC_URL: 'https://changed.example.invalid',
        } as never,
        f.orgId,
        f.deliveryId,
      );

      assert.equal(requests.length, 2);
      assert.deepEqual(Buffer.from(requests[1].body, 'utf8'), Buffer.from(requests[0].body, 'utf8'));
      assert.equal(requests[1].key, requests[0].key);
      const second = await stored(f);
      assert.equal(second.status, 'sent');
      assert.equal(second.attempts, 2);
      assert.equal(second.lease_until, null);
      assert.equal(second.last_error, null);
      assert.deepEqual(second.prepared_email, first.prepared_email);
      const sent = await logs(f);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to_email, 'customer-before@example.invalid');
      assert.equal(sent[0].from_email, 'sender-before@example.invalid');
      assert.equal(sent[0].reply_to, 'reply-before@example.invalid');
      assert.equal(sent[0].rendered_html, JSON.parse(expectedBody).html);
      assert.equal(sent[0].rendered_text, 'Original text for Original customer | $55.18');
      await deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      assert.equal(requests.length, 2);
    });

    test('live lease excludes overlapping claimants and a completed delivery is not sent again', async () => {
      const f = await fixture();
      const started = deferred<void>();
      const response = deferred<Response>();
      const requests: ProviderRequest[] = [];
      globalThis.fetch = async (url, options) => {
        requests.push(capture(f, url, options));
        started.resolve();
        return response.promise;
      };
      const first = deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      try {
        await waitForSend(started.promise);
        await Promise.all(
          Array.from({ length: 4 }, () => deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId)),
        );
        assert.equal(requests.length, 1);
        const claimed = await stored(f);
        assert.equal(claimed.status, 'sending');
        assert.equal(claimed.attempts, 1);
        assert.ok(claimed.lease_until);
      } finally {
        response.resolve(Response.json({ id: `synthetic-${f.deliveryId}` }));
        await first;
      }
      const completed = await stored(f);
      assert.equal(completed.status, 'sent');
      assert.equal(completed.attempts, 1);
      assert.equal(completed.lease_until, null);
      assert.equal((await logs(f)).length, 1);
      await deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      assert.equal(requests.length, 1);
    });

    test('late first-attempt failure cannot reset a newer successful attempt or its frozen payload', async () => {
      const f = await fixture();
      const started = deferred<void>();
      const lateResponse = deferred<Response>();
      const requests: ProviderRequest[] = [];
      globalThis.fetch = async (url, options) => {
        requests.push(capture(f, url, options));
        if (requests.length === 1) {
          started.resolve();
          return lateResponse.promise;
        }
        return Response.json({ id: `synthetic-second-${f.deliveryId}` });
      };
      const first = deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      let successful: Awaited<ReturnType<typeof stored>>;
      try {
        await waitForSend(started.promise);
        const initial = await stored(f);
        assert.equal(initial.status, 'sending');
        assert.equal(initial.attempts, 1);
        // Advance only this fixture's lease, keeping the provider response pending.
        await pool.query(
          "update accepted_estimate_deliveries set lease_until=now()-interval '1 second' where id=$1 and org_id=$2",
          [f.deliveryId, f.orgId],
        );
        await deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
        successful = await stored(f);
        assert.equal(successful.status, 'sent');
        assert.equal(successful.attempts, 2);
        assert.ok(successful.sent_at);
        assert.equal(successful.lease_until, null);
        assert.equal(successful.last_error, null);
        assert.deepEqual(successful.prepared_email, initial.prepared_email);
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[1], requests[0]);
      } finally {
        lateResponse.resolve(Response.json({ error: 'Synthetic late first failure' }, { status: 503 }));
        await first;
      }
      assert.deepEqual(await stored(f), successful!);
      const sent = await logs(f);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].provider_message_id, `synthetic-second-${f.deliveryId}`);
      await deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      assert.equal(requests.length, 2);
    });

    test('stale failure cannot take the lease from a newer attempt that is still sending', async () => {
      const f = await fixture();
      const firstStarted = deferred<void>();
      const secondStarted = deferred<void>();
      const firstResponse = deferred<Response>();
      const secondResponse = deferred<Response>();
      const requests: ProviderRequest[] = [];
      globalThis.fetch = async (url, options) => {
        requests.push(capture(f, url, options));
        assert.ok(requests.length <= 2);
        if (requests.length === 1) {
          firstStarted.resolve();
          return firstResponse.promise;
        }
        secondStarted.resolve();
        return secondResponse.promise;
      };
      const first = deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
      let second: Promise<void> | undefined;
      try {
        await waitForSend(firstStarted.promise);
        await pool.query(
          "update accepted_estimate_deliveries set lease_until=now()-interval '1 second' where id=$1 and org_id=$2",
          [f.deliveryId, f.orgId],
        );
        second = deliverAcceptedEstimate(env as never, f.orgId, f.deliveryId);
        await waitForSend(secondStarted.promise);
        const leased = await stored(f);
        assert.equal(leased.status, 'sending');
        assert.equal(leased.attempts, 2);
        assert.ok(leased.lease_until);
        firstResponse.resolve(Response.json({ error: 'Synthetic superseded failure' }, { status: 503 }));
        await first;
        assert.deepEqual(await stored(f), leased);
        assert.equal((await logs(f)).length, 0);
        assert.deepEqual(requests[1], requests[0]);
      } finally {
        firstResponse.resolve(Response.json({ error: 'Synthetic superseded failure' }, { status: 503 }));
        secondResponse.resolve(Response.json({ id: `synthetic-second-${f.deliveryId}` }));
        await first;
        await second;
      }
      const completed = await stored(f);
      assert.equal(completed.status, 'sent');
      assert.equal(completed.attempts, 2);
      assert.equal(completed.lease_until, null);
      assert.equal(completed.last_error, null);
      assert.equal((await logs(f)).length, 1);
    });

    test('foreign tenant and disabled provider cannot claim or prepare this delivery', async () => {
      const f = await fixture();
      const initial = await stored(f);
      await deliverAcceptedEstimate(env as never, randomUUID(), f.deliveryId);
      await deliverAcceptedEstimate({ ...env, RESEND_API_KEY: '' } as never, f.orgId, f.deliveryId);
      await deliverAcceptedEstimate(
        { ...env, EMAIL_PROVIDER: 'mailchannels' } as never,
        f.orgId,
        f.deliveryId,
      );
      assert.deepEqual(await stored(f), initial);
      assert.equal((await logs(f)).length, 0);
      assert.equal(
        (await pool.query('select count(*) from portal_tokens where org_id=$1', [f.orgId])).rows[0].count,
        '0',
      );
    });
  },
);
