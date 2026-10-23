import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { PayPalObject } from '../../src/server/paypal';

Object.assign(process.env, {
  OPENGAME_ACCESS_MODE: 'invite',
  OPENGAME_AUTH_PROVIDER: 'invite',
  OPENGAME_PREVIEW_SECRET: randomBytes(32).toString('hex'),
  OPENGAME_PAYPAL_ENVIRONMENT: 'sandbox',
  OPENGAME_PAYPAL_ENABLED: 'true',
  OPENGAME_PAYPAL_CLIENT_ID: 'test-client',
  OPENGAME_PAYPAL_CLIENT_SECRET: 'test-secret',
  OPENGAME_PAYPAL_MERCHANT_ID: 'MERCHANT00001',
  OPENGAME_PAYPAL_WEBHOOK_ID: 'test-webhook',
  OPENGAME_CREDIT_PACKS: JSON.stringify([
    { id: 'starter', credits: 3, amountMinor: 500 },
  ]),
});
const { databaseUrl, appOrigin } = await import('../../src/server/config');
const { pool, migrate } = await import('../../src/server/db');
const { createInvitation } = await import('../../src/server/access');
const { dispatch } = await import('../../src/server/api');
const { createCreditOrder, creditOrder, paymentAccount } =
  await import('../../src/server/payments');
const { accountQuota } = await import('../../src/server/referrals');
const { submitJob, cancelJob, claimJob, finishPlanning, failJob } =
  await import('../../src/server/store');
const originalFetch = globalThis.fetch;
let admin: pg.Client;
const name = `opengame_payments_${process.pid}`;
const orders = new Map<string, PayPalObject>();
const captures = new Map<string, PayPalObject>();
const createKeys = new Map<string, string>();
const captureKeys = new Set<string>();
let sequence = 0;
let lostCreate = false;
let lostCapture = false;
let signatureValid = true;
let calls = 0;

before(async () => {
  const original = databaseUrl();
  admin = new pg.Client({ connectionString: original });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(original);
  url.pathname = `/${name}`;
  process.env.OPENGAME_DATABASE_URL = url.toString();
  await migrate();
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(
      url.origin,
      'https://api-m.sandbox.paypal.com',
      'No real PayPal requests in tests',
    );
    const body = init?.body ? String(init.body) : '';
    if (url.pathname === '/v1/oauth2/token')
      return Response.json({ access_token: 'mock-token' });
    if (url.pathname === '/v1/notifications/verify-webhook-signature')
      return Response.json({
        verification_status: signatureValid ? 'SUCCESS' : 'FAILURE',
      });
    const requestId = new Headers(init?.headers).get('paypal-request-id')!;
    if (url.pathname === '/v2/checkout/orders' && init?.method === 'POST') {
      let id = createKeys.get(requestId);
      if (!id) {
        id = `ORDER${String(++sequence).padStart(10, '0')}`;
        createKeys.set(requestId, id);
        orders.set(id, {
          ...JSON.parse(body),
          id,
          status: 'CREATED',
          links: [
            {
              rel: 'payer-action',
              href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
            },
          ],
        });
      }
      if (lostCreate) {
        lostCreate = false;
        throw new Error('Simulated lost create response');
      }
      return Response.json(orders.get(id));
    }
    const captureMatch = url.pathname.match(
      /^\/v2\/checkout\/orders\/([^/]+)\/capture$/,
    );
    if (captureMatch) {
      const order = orders.get(captureMatch[1])!;
      assert.equal(order.status, 'APPROVED');
      if (!captureKeys.has(requestId)) {
        captureKeys.add(requestId);
        const capture = {
          id: `CAPTURE${String(++sequence).padStart(10, '0')}`,
          status: 'COMPLETED',
          amount: order.purchase_units![0].amount,
        };
        captures.set(capture.id, capture);
        order.purchase_units![0].payments = { captures: [capture] };
        order.status = 'COMPLETED';
      }
      if (lostCapture) {
        lostCapture = false;
        throw new Error('Simulated lost capture response');
      }
      return Response.json(order);
    }
    const orderMatch = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (orderMatch) return Response.json(orders.get(orderMatch[1]));
    const detail = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)$/);
    if (detail) return Response.json(captures.get(detail[1]));
    throw new Error('Unexpected provider endpoint: ' + url.pathname);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await pool().end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  }
});
async function member() {
  const user = await createInvitation('Payment test');
  const request = new Request(appOrigin + '/api/session', {
    method: 'POST',
    headers: {
      host: new URL(appOrigin).host,
      origin: appOrigin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ code: user.code }),
  });
  const response = await dispatch(request, ['session']);
  assert.equal(response.status, 200);
  return { ...user, cookie: response.headers.get('set-cookie')!.split(';')[0] };
}
async function newOrder(user: { id: string }) {
  const row = await createCreditOrder(user.id, {
    requestId: randomUUID(),
    packId: 'starter',
  });
  const provider = orders.get(
    new URL(row.approvalUrl!).searchParams.get('token')!,
  )!;
  return { row, provider };
}
async function paid(user: { id: string }) {
  const value = await newOrder(user);
  value.provider.status = 'APPROVED';
  await creditOrder(user.id, value.row.id, true);
  return {
    ...value,
    capture: captures.get(
      value.provider.purchase_units![0].payments!.captures![0].id!,
    )!,
  };
}
async function webhook(
  provider: PayPalObject,
  capture: PayPalObject,
  type = 'COMPLETED',
  id = randomUUID(),
) {
  const event = {
    id,
    event_type: 'PAYMENT.CAPTURE.' + type,
    resource: {
      id: capture.id,
      status: capture.status,
      supplementary_data: {
        related_ids: { order_id: provider.id, capture_id: capture.id },
      },
    },
  };
  const request = new Request(appOrigin + '/api/payments/webhook', {
    method: 'POST',
    headers: {
      host: new URL(appOrigin).host,
      'content-type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url':
        'https://api.sandbox.paypal.com/v1/notifications/certs/test',
      'paypal-transmission-id': id,
      'paypal-transmission-sig': 'mock-signature',
      'paypal-transmission-time': new Date().toISOString(),
    },
    body: JSON.stringify(event),
  });
  return dispatch(request, ['payments', 'webhook']);
}

test('disabled or unpriced sales fail closed and never contact PayPal', async () => {
  const user = await member();
  const before = calls;
  process.env.OPENGAME_PAYPAL_ENABLED = 'false';
  assert.equal((await paymentAccount(user.id)).enabled, false);
  await assert.rejects(
    createCreditOrder(user.id, { requestId: randomUUID(), packId: 'starter' }),
    /暂未开放/,
  );
  process.env.OPENGAME_PAYPAL_ENABLED = 'true';
  const packs = process.env.OPENGAME_CREDIT_PACKS!;
  process.env.OPENGAME_CREDIT_PACKS = '[]';
  await assert.rejects(
    createCreditOrder(user.id, { requestId: randomUUID(), packId: 'starter' }),
    /暂未开放/,
  );
  process.env.OPENGAME_CREDIT_PACKS = packs;
  assert.equal(calls, before);
});
test('price is server-owned; lost create response retries the same provider order and frozen price', async () => {
  const user = await member();
  const requestId = randomUUID();
  await assert.rejects(
    createCreditOrder(user.id, {
      requestId,
      packId: 'starter',
      amountMinor: 1,
    }),
  );
  lostCreate = true;
  await assert.rejects(
    createCreditOrder(user.id, { requestId, packId: 'starter' }),
    /lost create/,
  );
  process.env.OPENGAME_CREDIT_PACKS = JSON.stringify([
    { id: 'starter', credits: 9, amountMinor: 900 },
  ]);
  const order = await createCreditOrder(user.id, {
    requestId,
    packId: 'starter',
  });
  assert.equal(order.amountMinor, 500);
  assert.equal(order.credits, 3);
  assert.equal(
    orders.get(createKeys.get(requestId)!)!.purchase_units![0].amount!.value,
    '5.00',
  );
  process.env.OPENGAME_CREDIT_PACKS = JSON.stringify([
    { id: 'starter', credits: 3, amountMinor: 500 },
  ]);
  const other = await member();
  await assert.rejects(
    createCreditOrder(other.id, { requestId, packId: 'starter' }),
    /不一致/,
  );
  await assert.rejects(creditOrder(other.id, order.id), /找不到/);
});
test('approval or a forged return is not payment; capture loss and repeats grant exactly once', async () => {
  const user = await member();
  const { row, provider } = await newOrder(user);
  await creditOrder(user.id, row.id, true);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  provider.status = 'APPROVED';
  await creditOrder(user.id, row.id);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  lostCapture = true;
  assert.equal((await creditOrder(user.id, row.id, true)).status, 'PAID');
  await Promise.all([
    creditOrder(user.id, row.id, true),
    creditOrder(user.id, row.id, true),
  ]);
  const capture = captures.get(
    provider.purchase_units![0].payments!.captures![0].id!,
  )!;
  const eventId = randomUUID();
  const responses = await Promise.all([
    webhook(provider, capture, 'COMPLETED', eventId),
    webhook(provider, capture, 'COMPLETED', eventId),
  ]);
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal((await accountQuota(user.id)).paidRemaining, 3);
  assert.equal(
    (
      await pool().query(
        'SELECT * FROM studio_credit_ledger WHERE order_id=$1',
        [row.id],
      )
    ).rowCount,
    1,
  );
});
test('wrong amount, merchant and capture identity cannot grant credits', async () => {
  const user = await member();
  const { row, provider } = await newOrder(user);
  const unit = provider.purchase_units![0];
  const merchant = unit.payee!.merchant_id;
  unit.payee!.merchant_id = 'ATTACKER00001';
  await assert.rejects(creditOrder(user.id, row.id, true), /核对失败/);
  unit.payee!.merchant_id = merchant;
  provider.status = 'APPROVED';
  const capture = {
    id: `CAPTURE${String(++sequence).padStart(10, '0')}`,
    status: 'COMPLETED',
    amount: { currency_code: 'USD', value: '0.01' },
  };
  captures.set(capture.id, capture);
  unit.payments = { captures: [capture] };
  await assert.rejects(creditOrder(user.id, row.id), /核对失败/);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
});
test('pending capture grants through webhook after browser closes; invalid signatures do nothing', async () => {
  const user = await member();
  const { row, provider } = await newOrder(user);
  const capture = {
    id: `CAPTURE${String(++sequence).padStart(10, '0')}`,
    status: 'PENDING',
    amount: provider.purchase_units![0].amount,
  };
  captures.set(capture.id, capture);
  provider.purchase_units![0].payments = { captures: [capture] };
  await creditOrder(user.id, row.id);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  capture.status = 'COMPLETED';
  signatureValid = false;
  assert.equal((await webhook(provider, capture)).status, 400);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  signatureValid = true;
  assert.equal((await webhook(provider, capture)).status, 200);
  assert.equal((await accountQuota(user.id)).paidRemaining, 3);
});
test('refunds still reconcile while sales are disabled; stale success cannot reinstate credits', async () => {
  const user = await member();
  const { row, provider, capture } = await paid(user);
  process.env.OPENGAME_PAYPAL_ENABLED = 'false';
  capture.status = 'REFUNDED';
  assert.equal((await webhook(provider, capture, 'REFUNDED')).status, 200);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  capture.status = 'COMPLETED';
  await webhook(provider, capture);
  assert.equal((await creditOrder(user.id, row.id)).status, 'REFUNDED');
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  assert.equal(
    (
      await pool().query(
        'SELECT * FROM studio_credit_ledger WHERE order_id=$1',
        [row.id],
      )
    ).rowCount,
    2,
  );
  process.env.OPENGAME_PAYPAL_ENABLED = 'true';
});
test('reversal revokes credits even when provider capture read still reports completed', async () => {
  const user = await member();
  const { provider, capture } = await paid(user);
  assert.equal((await webhook(provider, capture, 'REVERSED')).status, 200);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  await webhook(provider, capture);
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
});
test('base, referral and purchased credits are consumed in order; retries and planning cannot double debit', async () => {
  const user = await member();
  await paid(user);
  await pool().query(
    'UPDATE studio_users SET daily_job_limit=1,total_job_limit=1,bonus_job_credits=1 WHERE id=$1',
    [user.id],
  );
  const base = await submitJob({
    ownerId: user.id,
    prompt: 'base',
    requestKey: randomUUID(),
  });
  await cancelJob(base.jobId, user.id);
  const bonus = await submitJob({
    ownerId: user.id,
    projectId: base.projectId,
    prompt: 'bonus',
    requestKey: randomUUID(),
  });
  await cancelJob(bonus.jobId, user.id);
  const input = {
    ownerId: user.id,
    projectId: base.projectId,
    prompt: 'paid',
    requestKey: randomUUID(),
  };
  const [a, b] = await Promise.all([submitJob(input), submitJob(input)]);
  assert.deepEqual(a, b);
  await cancelJob(a.jobId, user.id);
  assert.equal((await accountQuota(user.id)).paidRemaining, 2);
  const chat = await submitJob({
    ownerId: user.id,
    projectId: base.projectId,
    prompt: 'plan',
    kind: 'chat',
    requestKey: randomUUID(),
  });
  const job = (await claimJob())!;
  assert.equal(job.id, chat.jobId);
  const plan = {
    action: 'implement' as const,
    reply: '开始',
    plan: {
      goal: 'game',
      decisions: [],
      tasks: [{ title: '规则', detail: '规则' }],
      checks: ['重开'],
    },
  };
  await finishPlanning(job, plan);
  await assert.rejects(finishPlanning(job, plan), /执行权/);
  await cancelJob(chat.jobId, user.id);
  await failJob(job, 'Test cancellation', true);
  assert.equal((await accountQuota(user.id)).paidRemaining, 1);
  const last = await submitJob({ ...input, requestKey: randomUUID() });
  await cancelJob(last.jobId, user.id);
  assert.equal((await accountQuota(user.id)).available, 0);
  await assert.rejects(
    submitJob({ ...input, requestKey: randomUUID() }),
    /上限/,
  );
  const flags = (
    await pool().query(
      'SELECT uses_bonus,uses_paid FROM studio_jobs WHERE id=ANY($1::uuid[])',
      [[base.jobId, bonus.jobId, a.jobId]],
    )
  ).rows;
  assert.equal(flags.filter((x) => x.uses_paid).length, 1);
  assert.equal(flags.filter((x) => x.uses_bonus).length, 1);
});
test('session, origin and amount injection protections cover payment routes', async () => {
  const user = await member();
  const make = (cookie: string, origin: string) =>
    new Request(appOrigin + '/api/payments/orders', {
      method: 'POST',
      headers: {
        host: new URL(appOrigin).host,
        origin,
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ requestId: randomUUID(), packId: 'starter' }),
    });
  assert.equal(
    (await dispatch(make('', appOrigin), ['payments', 'orders'])).status,
    401,
  );
  assert.equal(
    (
      await dispatch(make(user.cookie, 'https://attacker.example'), [
        'payments',
        'orders',
      ])
    ).status,
    403,
  );
  const noSignature = new Request(appOrigin + '/api/payments/webhook', {
    method: 'POST',
    headers: {
      host: new URL(appOrigin).host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: 'forged',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {},
    }),
  });
  assert.equal(
    (await dispatch(noSignature, ['payments', 'webhook'])).status,
    400,
  );
});

test('partial refunds suspend the pack exactly once, then advance to full refund', async () => {
  const user = await member();
  const { provider, capture } = await paid(user);
  capture.status = 'PARTIALLY_REFUNDED';
  await webhook(provider, capture, 'REFUNDED');
  await webhook(provider, capture, 'REFUNDED');
  assert.equal((await accountQuota(user.id)).paidRemaining, 0);
  capture.status = 'REFUNDED';
  await webhook(provider, capture, 'REFUNDED');
  assert.equal(
    (
      await pool().query(
        'SELECT paid_job_credits FROM studio_users WHERE id=$1',
        [user.id],
      )
    ).rows[0].paid_job_credits,
    0,
  );
});
test('payment and credits roll back together on ledger failure and recover on webhook retry', async () => {
  const user = await member();
  const { row, provider } = await newOrder(user);
  const capture = {
    id: `CAPTURE${String(++sequence).padStart(10, '0')}`,
    status: 'COMPLETED',
    amount: provider.purchase_units![0].amount,
  };
  captures.set(capture.id, capture);
  provider.purchase_units![0].payments = { captures: [capture] };
  await pool()
    .query(`CREATE FUNCTION reject_test_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test ledger failure'; END $$;
    CREATE TRIGGER reject_credit BEFORE INSERT ON studio_credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_test_credit();`);
  const eventId = randomUUID();
  try {
    assert.equal(
      (await webhook(provider, capture, 'COMPLETED', eventId)).status,
      503,
    );
    assert.equal((await accountQuota(user.id)).paidRemaining, 0);
    assert.equal(
      (
        await pool().query('SELECT * FROM studio_credit_events WHERE id=$1', [
          eventId,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await pool().query(
          'SELECT status FROM studio_credit_orders WHERE id=$1',
          [row.id],
        )
      ).rows[0].status,
      'CREATED',
    );
  } finally {
    await pool().query(
      'DROP TRIGGER reject_credit ON studio_credit_ledger; DROP FUNCTION reject_test_credit()',
    );
  }
  assert.equal(
    (await webhook(provider, capture, 'COMPLETED', eventId)).status,
    200,
  );
  assert.equal((await accountQuota(user.id)).paidRemaining, 3);
});
test('refunded spent credits remain debt against later purchases and invalid catalog does not block refunds', async () => {
  const user = await member();
  const { provider, capture } = await paid(user);
  await pool().query(
    'UPDATE studio_users SET daily_job_limit=1,total_job_limit=1 WHERE id=$1',
    [user.id],
  );
  const base = await submitJob({
    ownerId: user.id,
    prompt: 'base',
    requestKey: randomUUID(),
  });
  await cancelJob(base.jobId, user.id);
  const job = await submitJob({
    ownerId: user.id,
    projectId: base.projectId,
    prompt: 'paid',
    requestKey: randomUUID(),
  });
  await cancelJob(job.jobId, user.id);
  assert.equal((await accountQuota(user.id)).paidRemaining, 2);
  const packs = process.env.OPENGAME_CREDIT_PACKS!;
  process.env.OPENGAME_CREDIT_PACKS = 'invalid json';
  assert.equal((await paymentAccount(user.id)).enabled, false);
  capture.status = 'REFUNDED';
  assert.equal((await webhook(provider, capture, 'REFUNDED')).status, 200);
  process.env.OPENGAME_CREDIT_PACKS = packs;
  await paid(user);
  assert.equal((await accountQuota(user.id)).paidRemaining, 2);
});
