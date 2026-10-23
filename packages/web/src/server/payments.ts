import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { migrate, pool, transaction } from './db';
import { appOrigin } from './config';
import { StudioError } from './errors';
import {
  paymentSettings,
  paypalClient,
  amountMinor,
  approvalUrl,
  type PayPalObject,
} from './paypal';
import type { CreditOrder, PaymentAccount } from '../shared/payments';

interface Order {
  id: string;
  owner_id: string;
  environment: string;
  pack_id: string;
  credits: number;
  amount_minor: number;
  merchant_id: string;
  provider_id: string | null;
  capture_id: string | null;
  capture_request_id: string;
  approval_url: string | null;
  status: string;
  granted: boolean;
  revoked: boolean;
  created_at: Date;
}
const providerId = /^[A-Z0-9]{8,32}$/;
const revokedStatuses = ['REFUNDED', 'PARTIALLY_REFUNDED', 'REVERSED'];
function publicOrder(row: Order): CreditOrder {
  return {
    id: row.id,
    packId: row.pack_id,
    credits: row.credits,
    amountMinor: row.amount_minor,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    approvalUrl: row.approval_url,
  };
}
async function ownedOrder(ownerId: string, id: string): Promise<Order> {
  await migrate();
  const row = (
    await pool().query(
      'SELECT * FROM studio_credit_orders WHERE id=$1 AND owner_id=$2',
      [id, ownerId],
    )
  ).rows[0];
  if (!row) throw new StudioError('找不到这笔订单。', 404);
  return row;
}
export async function paymentAccount(ownerId: string): Promise<PaymentAccount> {
  await migrate();
  const config = paymentSettings();
  const rows = (
    await pool().query(
      'SELECT * FROM studio_credit_orders WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50',
      [ownerId],
    )
  ).rows;
  return {
    enabled: config.enabled,
    sandbox: config.environment === 'sandbox',
    packs: config.enabled ? config.packs : [],
    orders: rows.map(publicOrder),
  };
}
export async function createCreditOrder(ownerId: string, input: unknown) {
  const { requestId, packId } = z
    .object({ requestId: z.string().uuid(), packId: z.string().max(60) })
    .strict()
    .parse(input);
  const config = paymentSettings();
  if (!config.enabled) throw new StudioError('额度购买暂未开放。', 503);
  const pack = config.packs.find((p) => p.id === packId);
  if (!pack) throw new StudioError('这个套餐已不可购买。', 400);
  // Freeze price and owner before contacting PayPal. A lost response retries this ID.
  const row: Order = await transaction(async (client) => {
    const user = (
      await client.query(
        'SELECT id FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
        [ownerId],
      )
    ).rows[0];
    if (!user) throw new StudioError('请重新登录。', 401);
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',
      [requestId],
    );
    const old = (
      await client.query('SELECT * FROM studio_credit_orders WHERE id=$1', [
        requestId,
      ])
    ).rows[0];
    if (old) {
      if (
        old.owner_id !== ownerId ||
        old.pack_id !== packId ||
        old.environment !== config.environment
      )
        throw new StudioError('订单重试参数不一致。', 409);
      return old;
    }
    const count = (
      await client.query(
        "SELECT count(*)::int AS n FROM studio_credit_orders WHERE owner_id=$1 AND created_at>now()-interval '1 hour'",
        [ownerId],
      )
    ).rows[0].n;
    if (count >= 10)
      throw new StudioError('创建订单过于频繁，请稍后再试。', 429);
    return (
      await client.query(
        `INSERT INTO studio_credit_orders(id,owner_id,environment,pack_id,credits,amount_minor,merchant_id,capture_request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          requestId,
          ownerId,
          config.environment,
          pack.id,
          pack.credits,
          pack.amountMinor,
          config.merchant,
          randomUUID(),
        ],
      )
    ).rows[0];
  });
  if (row.provider_id) return publicOrder(row);
  if (Date.now() - row.created_at.getTime() > 3600000)
    throw new StudioError(
      '这笔未完成的订单已超时，请联系支持核对后重新购买。',
      409,
    );
  const call = paypalClient(config);
  const amount = {
    currency_code: 'USD',
    value: (row.amount_minor / 100).toFixed(2),
  };
  const value = await call(
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: row.pack_id,
          custom_id: row.id,
          payee: { merchant_id: row.merchant_id },
          amount,
          description: `OpenGame ${row.credits} creation credits`,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: `${appOrigin}/?credit_order=${row.id}`,
            cancel_url: `${appOrigin}/?credit_cancel=${row.id}`,
          },
        },
      },
    },
    row.id,
  );
  if (!providerId.test(value.id || ''))
    throw new StudioError('支付订单尚未创建，请重试。', 502);
  const link = approvalUrl(value, config);
  if (!link) throw new StudioError('支付链接尚未就绪，请重试。', 502);
  const updated = (
    await pool().query(
      `UPDATE studio_credit_orders SET provider_id=$2,approval_url=$3,
    status=CASE WHEN status='CREATING' THEN 'CREATED' ELSE status END,updated_at=now()
    WHERE id=$1 AND (provider_id IS NULL OR provider_id=$2) RETURNING *`,
      [row.id, value.id, link],
    )
  ).rows[0];
  if (!updated) throw new StudioError('支付订单不一致，请联系支持。', 409);
  return publicOrder(updated);
}
function verifyOrder(value: PayPalObject, row: Order) {
  const unit =
    value.purchase_units?.length === 1 ? value.purchase_units[0] : undefined;
  if (
    value.id !== row.provider_id ||
    value.intent !== 'CAPTURE' ||
    !unit ||
    unit.custom_id !== row.id ||
    unit.reference_id !== row.pack_id ||
    unit.payee?.merchant_id !== row.merchant_id ||
    unit.amount?.currency_code !== 'USD' ||
    amountMinor(unit.amount?.value) !== row.amount_minor
  )
    throw new StudioError('付款信息核对失败，请联系支持。', 502);
  return unit;
}
async function persist(
  row: Order,
  status: string,
  captureId: string,
  event?: PayPalObject,
) {
  return transaction(async (client) => {
    // Same user lock as job consumption prevents refund/purchase races with quota checks.
    await client.query('SELECT id FROM studio_users WHERE id=$1 FOR UPDATE', [
      row.owner_id,
    ]);
    const current: Order = (
      await client.query(
        'SELECT * FROM studio_credit_orders WHERE id=$1 FOR UPDATE',
        [row.id],
      )
    ).rows[0];
    if (current.capture_id && current.capture_id !== captureId)
      throw new StudioError('付款编号不一致。', 502);
    if (event) {
      const inserted = await client.query(
        `INSERT INTO studio_credit_events(environment,id,order_id) VALUES($1,$2,$3)
        ON CONFLICT DO NOTHING RETURNING id`,
        [row.environment, event.id, row.id],
      );
      if (!inserted.rowCount) return publicOrder(current);
    }
    // Refund/reversal is terminal for the credit grant; late success cannot restore it.
    if (
      current.status === 'REVERSED' ||
      (current.status === 'REFUNDED' && status !== 'REVERSED') ||
      (current.status === 'PARTIALLY_REFUNDED' &&
        !revokedStatuses.includes(status)) ||
      (current.status === 'PAID' &&
        !['PAID', ...revokedStatuses].includes(status))
    )
      return publicOrder(current);
    const grant = status === 'PAID' && !current.granted && !current.revoked;
    const revoke =
      revokedStatuses.includes(status) && current.granted && !current.revoked;
    if (grant || revoke) {
      const delta = grant ? row.credits : -row.credits;
      await client.query(
        'INSERT INTO studio_credit_ledger(order_id,kind,delta) VALUES($1,$2,$3)',
        [row.id, grant ? 'purchase' : 'revoke', delta],
      );
      await client.query(
        'UPDATE studio_users SET paid_job_credits=paid_job_credits+$2 WHERE id=$1',
        [row.owner_id, delta],
      );
    }
    const updated = (
      await client.query(
        `UPDATE studio_credit_orders SET status=$2,capture_id=$3,
      granted=granted OR $4,revoked=revoked OR $5,updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id, status, captureId, grant, revokedStatuses.includes(status)],
      )
    ).rows[0];
    return publicOrder(updated);
  });
}
async function reconcile(row: Order, event?: PayPalObject) {
  const config = paymentSettings();
  if (
    row.environment !== config.environment ||
    row.merchant_id !== config.merchant
  )
    throw new StudioError('订单支付环境不匹配，请联系支持。', 409);
  if (!row.provider_id) return publicOrder(row);
  const call = paypalClient(config);
  const unit = verifyOrder(
    await call(`/v2/checkout/orders/${row.provider_id}`),
    row,
  );
  const captures = unit.payments?.captures || [];
  if (!captures.length) {
    if (event) throw new StudioError('付款状态尚未同步。', 503);
    return publicOrder(row);
  }
  if (captures.length !== 1 || !providerId.test(captures[0].id || ''))
    throw new StudioError('付款明细异常。', 502);
  const capture = await call(`/v2/payments/captures/${captures[0].id}`);
  if (
    capture.id !== captures[0].id ||
    capture.amount?.currency_code !== 'USD' ||
    amountMinor(capture.amount?.value) !== row.amount_minor ||
    (event && eventCaptureId(event, config.environment) !== capture.id)
  )
    throw new StudioError('付款明细核对失败。', 502);
  const status =
    (
      {
        COMPLETED: 'PAID',
        REFUNDED: 'REFUNDED',
        PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
        DECLINED: 'DENIED',
        DENIED: 'DENIED',
        FAILED: 'DENIED',
      } as Record<string, string>
    )[capture.status || ''] || 'PENDING';
  if (
    (event?.event_type === 'PAYMENT.CAPTURE.COMPLETED' &&
      !['PAID', ...revokedStatuses].includes(status)) ||
    (event?.event_type === 'PAYMENT.CAPTURE.REFUNDED' &&
      !revokedStatuses.includes(status))
  )
    throw new StudioError('付款状态尚未同步。', 503);
  return persist(
    row,
    event?.event_type === 'PAYMENT.CAPTURE.REVERSED' ? 'REVERSED' : status,
    capture.id!,
    event,
  );
}
export async function creditOrder(
  ownerId: string,
  id: string,
  capture = false,
) {
  const row = await ownedOrder(ownerId, z.string().uuid().parse(id));
  const config = paymentSettings();
  if (
    capture &&
    row.provider_id &&
    !row.capture_id &&
    !revokedStatuses.includes(row.status)
  ) {
    if (
      !config.enabled ||
      row.environment !== config.environment ||
      row.merchant_id !== config.merchant
    )
      throw new StudioError('付款暂未开放，请稍后刷新订单。', 503);
    const call = paypalClient(config);
    const order = await call(`/v2/checkout/orders/${row.provider_id}`);
    const unit = verifyOrder(order, row);
    if (!unit.payments?.captures?.length && order.status === 'APPROVED') {
      try {
        await call(
          `/v2/checkout/orders/${row.provider_id}/capture`,
          {},
          row.capture_request_id,
        );
      } catch {
        /* A lost capture response is recovered through canonical provider reads below. */
      }
    }
  }
  return reconcile(row);
}
function eventCaptureId(
  event: PayPalObject,
  environment: string,
): string | undefined {
  const resource = event.resource;
  const related = resource?.supplementary_data?.related_ids?.capture_id;
  if (related && providerId.test(related)) return related;
  if (
    event.event_type !== 'PAYMENT.CAPTURE.REFUNDED' ||
    revokedStatuses.includes(resource?.status || '')
  )
    return resource?.id;
  for (const link of resource?.links || []) {
    if (link.rel !== 'up') continue;
    try {
      const url = new URL(link.href);
      const hosts =
        environment === 'live'
          ? ['api.paypal.com', 'api-m.paypal.com']
          : ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'];
      const match = url.pathname.match(
        /^\/v2\/payments\/captures\/([A-Z0-9]{8,32})$/,
      );
      if (
        url.protocol === 'https:' &&
        hosts.includes(url.hostname) &&
        !url.port &&
        !url.username &&
        !url.password &&
        match
      )
        return match[1];
    } catch {
      /* Untrusted provider URLs are never fetched. */
    }
  }
}
export async function creditWebhook(request: Request, input: unknown) {
  const event = z
    .object({
      id: z.string().min(1).max(200),
      event_type: z.string().max(100),
      resource: z.record(z.string(), z.unknown()),
    })
    .passthrough()
    .parse(input) as PayPalObject;
  const config = paymentSettings();
  const fields: Record<string, string> = {};
  for (const name of [
    'auth-algo',
    'cert-url',
    'transmission-id',
    'transmission-sig',
    'transmission-time',
  ]) {
    const value = request.headers.get('paypal-' + name);
    if (!value || value.length > 4096)
      throw new StudioError('支付通知签名缺失。', 400);
    fields[name.replaceAll('-', '_')] = value;
  }
  const certificate = new URL(fields.cert_url);
  const allowed =
    config.environment === 'live'
      ? ['api.paypal.com', 'api-m.paypal.com']
      : ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'];
  if (
    certificate.protocol !== 'https:' ||
    !allowed.includes(certificate.hostname) ||
    certificate.port ||
    certificate.username ||
    certificate.password
  )
    throw new StudioError('支付通知证书无效。', 400);
  const verified = await paypalClient(config)(
    '/v1/notifications/verify-webhook-signature',
    { ...fields, webhook_id: config.webhookId, webhook_event: input },
  );
  if (verified.verification_status !== 'SUCCESS')
    throw new StudioError('支付通知签名无效。', 400);
  if (
    ![
      'COMPLETED',
      'PENDING',
      'DECLINED',
      'DENIED',
      'REFUNDED',
      'REVERSED',
    ].some((x) => event.event_type === 'PAYMENT.CAPTURE.' + x)
  )
    return { ok: true };
  await migrate();
  const related = event.resource?.supplementary_data?.related_ids?.order_id;
  const captureId = eventCaptureId(event, config.environment);
  const row = (
    await pool().query(
      `SELECT * FROM studio_credit_orders WHERE environment=$1 AND
    (provider_id=$2 OR capture_id=$3) LIMIT 1`,
      [config.environment, related || null, captureId || null],
    )
  ).rows[0];
  // Other products sharing this merchant/app are not OpenGame orders.
  if (!row) return { ok: true };
  await reconcile(row, event);
  return { ok: true };
}
