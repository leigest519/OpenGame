// Adapted from gnuser/RobloxCursorClickerSite checkout-api/paypal.js.
// Credentials stay server-side. Provider reads, not browser redirects, settle orders.
import { z } from 'zod';
import { StudioError } from './errors';
import { accessMode, appOrigin } from './config';

const packsSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z0-9-]{1,60}$/),
        credits: z.number().int().min(1).max(100000),
        amountMinor: z.number().int().min(100).max(1000000),
      })
      .strict(),
  )
  .max(10)
  .refine((p) => new Set(p.map((x) => x.id)).size === p.length);
export function paymentSettings() {
  const env = process.env;
  const environment = env.OPENGAME_PAYPAL_ENVIRONMENT || 'sandbox';
  let rawPacks: unknown;
  try {
    rawPacks = JSON.parse(env.OPENGAME_CREDIT_PACKS || '[]');
  } catch {
    rawPacks = null;
  }
  const parsedPacks = packsSchema.safeParse(rawPacks);
  // Invalid catalog disables new sales without preventing existing refunds/webhooks.
  const packs = parsedPacks.success ? parsedPacks.data : [];
  const clientId = env.OPENGAME_PAYPAL_CLIENT_ID || '';
  const secret = env.OPENGAME_PAYPAL_CLIENT_SECRET || '';
  const merchant = env.OPENGAME_PAYPAL_MERCHANT_ID || '';
  const webhookId = env.OPENGAME_PAYPAL_WEBHOOK_ID || '';
  const ready =
    ['sandbox', 'live'].includes(environment) &&
    !!clientId &&
    !!secret &&
    /^[A-Z0-9]{13}$/.test(merchant) &&
    !!webhookId &&
    accessMode === 'invite';
  return {
    environment,
    clientId,
    secret,
    merchant,
    webhookId,
    packs,
    ready,
    enabled:
      ready &&
      packs.length > 0 &&
      env.OPENGAME_PAYPAL_ENABLED === 'true' &&
      (environment === 'sandbox' ||
        (env.OPENGAME_PAYPAL_LIVE_READY === 'true' &&
          appOrigin.startsWith('https://'))),
    base:
      environment === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com',
  };
}
export type PaymentSettings = ReturnType<typeof paymentSettings>;
// Only these provider fields are consumed; optional fields are checked before use.
export interface PayPalObject {
  id?: string;
  intent?: string;
  status?: string;
  access_token?: string;
  verification_status?: string;
  event_type?: string;
  amount?: { currency_code?: string; value?: string };
  purchase_units?: Array<{
    custom_id?: string;
    reference_id?: string;
    payee?: { merchant_id?: string };
    amount?: { currency_code?: string; value?: string };
    payments?: { captures?: PayPalObject[] };
  }>;
  links?: Array<{ rel: string; href: string }>;
  resource?: PayPalObject & {
    supplementary_data?: {
      related_ids?: { order_id?: string; capture_id?: string };
    };
  };
  details?: Array<{ issue?: string }>;
}
export function paypalClient(config: PaymentSettings) {
  let token: string | undefined;
  async function request(
    url: string,
    init: RequestInit,
  ): Promise<PayPalObject> {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (text.length > 524288) throw new StudioError('支付服务响应异常。', 502);
    let value: PayPalObject;
    try {
      value = JSON.parse(text);
    } catch {
      throw new StudioError('支付服务暂不可用。', 502);
    }
    if (!response.ok) {
      if (value.details?.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED'))
        return {};
      throw new StudioError(
        'PayPal 尚未确认付款，请稍后刷新订单；不要重复付款。',
        502,
      );
    }
    return value;
  }
  return async (path: string, body?: unknown, requestId?: string) => {
    if (!config.ready) throw new StudioError('支付服务尚未配置。', 503);
    if (!token) {
      const auth = await request(config.base + '/v1/oauth2/token', {
        method: 'POST',
        headers: {
          authorization:
            'Basic ' +
            Buffer.from(config.clientId + ':' + config.secret).toString(
              'base64',
            ),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!auth.access_token) throw new StudioError('支付服务暂不可用。', 502);
      token = auth.access_token;
    }
    return request(config.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        prefer: 'return=representation',
        ...(requestId ? { 'paypal-request-id': requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
}
export function amountMinor(value?: string): number {
  if (!value || !/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return -1;
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function approvalUrl(
  value: PayPalObject,
  config: PaymentSettings,
): string | null {
  const link = value.links?.find(
    (l) => l.rel === 'payer-action' || l.rel === 'approve',
  );
  if (!link) return null;
  const url = new URL(link.href);
  if (
    url.protocol !== 'https:' ||
    url.hostname !==
      (config.environment === 'live'
        ? 'www.paypal.com'
        : 'www.sandbox.paypal.com') ||
    url.username ||
    url.password ||
    url.port
  )
    throw new StudioError('支付跳转地址无效。', 502);
  return url.href;
}
