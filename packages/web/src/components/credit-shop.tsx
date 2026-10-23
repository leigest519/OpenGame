'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreditOrder, PaymentAccount } from '../shared/payments';

const labels: Record<string, string> = {
  CREATING: '支付链接待恢复',
  CREATED: '待付款',
  PENDING: '付款确认中',
  PAID: '已入账',
  DENIED: '付款未成功',
  REFUNDED: '已退款',
  PARTIALLY_REFUNDED: '部分退款，额度待核对',
  REVERSED: '付款已撤销',
};
async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/payments' + path, {
    cache: 'no-store',
    ...(data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || '支付服务暂不可用，请稍后重试。');
  return result;
}
export function CreditShop({ active }: { active: boolean }) {
  const [account, setAccount] = useState<PaymentAccount>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const retry = useRef<{ packId: string; requestId: string } | null>(null);
  const handledReturn = useRef(false);
  const refresh = useCallback(
    async () => setAccount(await api<PaymentAccount>('')),
    [],
  );
  useEffect(() => {
    if (!active) return;
    void refresh().catch((e) => setError(e.message));
  }, [active, refresh]);
  const check = useCallback(
    async (id: string, capture: boolean) => {
      setBusy(true);
      setError('');
      setMessage('正在向 PayPal 核对付款…');
      try {
        const order = await api<CreditOrder>(
          `/orders/${encodeURIComponent(id)}${capture ? '/capture' : ''}`,
          capture ? {} : undefined,
        );
        setMessage(
          order.status === 'PAID'
            ? `付款已确认，${order.credits} 次制作额度已入账。`
            : labels[order.status] || '付款待核对',
        );
        window.dispatchEvent(new Event('opengame-quota-changed'));
        await refresh();
      } catch (e) {
        setMessage('');
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );
  useEffect(() => {
    if (!active || handledReturn.current) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('credit_order');
    const cancelled = url.searchParams.get('credit_cancel');
    if (!id && !cancelled) return;
    handledReturn.current = true;
    if (id) void check(id, true);
    else
      setMessage(
        '你已返回工作台。若已付款，请在购买记录中核对状态；返回页面不会自动取消订单。',
      );
    for (const key of ['credit_order', 'credit_cancel', 'token', 'PayerID'])
      url.searchParams.delete(key);
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + url.search + url.hash,
    );
  }, [active, check]);
  async function buy(packId: string, requestId?: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('正在准备 PayPal 付款页面…');
    if (requestId || retry.current?.packId !== packId)
      retry.current = { packId, requestId: requestId || crypto.randomUUID() };
    try {
      const order = await api<CreditOrder>('/orders', retry.current!);
      if (order.status === 'PAID') {
        await check(order.id, false);
        return;
      }
      if (!order.approvalUrl)
        throw new Error('支付链接尚未就绪，请在购买记录中重试。');
      window.location.assign(order.approvalUrl);
    } catch (e) {
      setMessage('');
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (!active) return null;
  return (
    <section className="credit-shop" aria-labelledby="credit-shop-title">
      <h3 id="credit-shop-title">购买制作额度</h3>
      {!account && !error && <p>正在读取套餐…</p>}
      {account?.enabled ? (
        <>
          {account.sandbox && (
            <p role="status">
              测试环境：仅供 PayPal 沙箱账号测试，不接受真实付款。
            </p>
          )}
          <p>
            1 credit = 1 次制作。一次性购买，无自动续费；失败或取消也消耗一次。
          </p>
          <div className="credit-packs">
            {account.packs.map((pack) => (
              <button
                className="button"
                key={pack.id}
                disabled={busy}
                onClick={() => void buy(pack.id)}
              >
                <strong>{pack.credits} 次制作</strong>
                <span>${(pack.amountMinor / 100).toFixed(2)} USD · PayPal</span>
              </button>
            ))}
          </div>
          <details>
            <summary>额度使用与退款说明</summary>
            <p>
              优先使用基础额度和邀请奖励，再使用购买额度。购买额度不增加项目数量或纯讨论次数上限，账号有效期仍然适用。额度不能转让或提现。
            </p>
            <p>
              付款确认后自动入账；退款请通过 PayPal
              交易联系卖方，退款或撤销会收回对应额度。部分退款暂冻结该笔套餐额度，待人工核对。
            </p>
          </details>
        </>
      ) : (
        account && <p>额度购买暂未开放。</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error-box" role="alert">
          {error}{' '}
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void refresh()
                .then(() => setError(''))
                .catch((e) => setError(e.message))
            }
          >
            重新读取
          </button>
        </p>
      )}
      {!!account?.orders.length && (
        <>
          <h4>最近购买记录</h4>
          <ul className="credit-orders">
            {account.orders.map((order) => (
              <li key={order.id}>
                <div>
                  <strong>
                    {order.credits} 次 · ${(order.amountMinor / 100).toFixed(2)}{' '}
                    USD
                  </strong>
                  <span>{labels[order.status] || order.status}</span>
                </div>
                <small>
                  {new Date(order.createdAt).toLocaleString('zh-CN')} · 订单{' '}
                  {order.id}
                </small>
                <div>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void check(
                        order.id,
                        ['CREATED', 'PENDING'].includes(order.status),
                      )
                    }
                  >
                    核对付款
                  </button>
                  {account.enabled && order.status === 'CREATING' && (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void buy(order.packId, order.id)}
                    >
                      恢复支付链接
                    </button>
                  )}
                  {account.enabled &&
                    order.status === 'CREATED' &&
                    order.approvalUrl && (
                      <a className="button" href={order.approvalUrl}>
                        继续付款
                      </a>
                    )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
