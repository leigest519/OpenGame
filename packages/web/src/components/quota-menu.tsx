'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditShop } from './credit-shop';
import type { AccountQuota } from '../shared/quota';

export function QuotaMenu() {
  const [quota, setQuota] = useState<AccountQuota>();
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [invitation, setInvitation] = useState<{
    code: string;
    expiresAt: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has('credit_order') || query.has('credit_cancel')) {
      dialog.current?.showModal();
      setOpen(true);
    }
  }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '暂时无法读取额度');
      setQuota(value);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let dirty = true;
    const flush = () => {
      if (dirty && !document.hidden) {
        dirty = false;
        void refresh();
      }
    };
    const check = () => {
      dirty = true;
      flush();
    };
    flush();
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('opengame-quota-changed', check);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('opengame-quota-changed', check);
    };
  }, [refresh]);
  return (
    <>
      <button
        className="quota-trigger"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
          void refresh();
        }}
      >
        {error
          ? '额度暂不可用'
          : quota
            ? `剩余 ${quota.available} 次制作`
            : '读取额度…'}
        <span>额度与邀请</span>
      </button>
      <dialog
        ref={dialog}
        className="quota-dialog"
        aria-labelledby="quota-title"
        onClose={() => setOpen(false)}
      >
        <div className="quota-heading">
          <h2 id="quota-title">额度与邀请</h2>
          <button className="button" onClick={() => dialog.current?.close()}>
            关闭
          </button>
        </div>
        {quota && (
          <>
            <p className="quota-total">
              当前可用 <strong>{quota.available}</strong> 次制作
            </p>
            <dl className="quota-breakdown">
              <div>
                <dt>24 小时基础余额</dt>
                <dd>{quota.dailyRemaining} 次</dd>
              </div>
              <div>
                <dt>累计基础余额</dt>
                <dd>{quota.totalRemaining} 次</dd>
              </div>
              <div>
                <dt>邀请奖励余额</dt>
                <dd>{quota.bonusRemaining} 次</dd>
              </div>
              <div>
                <dt>购买额度余额</dt>
                <dd>{quota.paidRemaining} 次</dd>
              </div>
            </dl>
            <p>
              依次使用基础额度、邀请奖励和购买额度。失败或取消也计为一次制作。
            </p>
            <CreditShop active={open} />
            <h3 className="credit-invitation-heading">
              邀请好友，获得更多制作次数
            </h3>
            <p>
              每位好友首次用专属邀请码登录，你获得 5
              次额外制作。重复登录不重复奖励。奖励不受 24 小时基础上限限制。
            </p>
            <p>
              已邀请 {quota.invited}/{quota.invitationLimit} 人 · 已成功登录{' '}
              {quota.activated} 人
            </p>
          </>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            setCopied(false);
            try {
              const response = await fetch('/api/invitations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label }),
              });
              const value = await response.json();
              if (!response.ok)
                throw new Error(value.error || '生成邀请码失败');
              setInvitation(value);
              setLabel('');
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="friend-name">好友称呼</label>
          <input
            id="friend-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder="例如：小明"
            required
          />
          <button
            className="button primary"
            disabled={
              busy ||
              !label.trim() ||
              !quota ||
              quota.invited >= quota.invitationLimit
            }
          >
            {busy ? '正在生成…' : '生成专属邀请码'}
          </button>
        </form>
        {invitation && (
          <section className="quota-invitation" aria-label="新邀请码">
            <label htmlFor="new-invite-code">
              邀请码（仅本次显示，请复制保存）
            </label>
            <input
              id="new-invite-code"
              readOnly
              value={invitation.code}
              onFocus={(e) => e.target.select()}
            />
            <p>
              有效期至 {new Date(invitation.expiresAt).toLocaleString('zh-CN')}
              。将这个码发给一位好友，好友在工作台登录页输入即可。
            </p>
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `邀请你体验 OpenGame：${window.location.origin}\n你的专属访问码：${invitation.code}\n请妥善保管，用它登录工作台。`,
                  );
                  setCopied(true);
                } catch {
                  setError('复制失败，请选中邀请码手动复制。');
                }
              }}
            >
              {copied ? '已复制邀请内容' : '复制邀请码与访问地址'}
            </button>
          </section>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
            <button className="button" onClick={() => void refresh()}>
              刷新额度
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
