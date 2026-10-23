'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { LoginButtons, useAuth } from './auth-context';
import { QuotaMenu } from './quota-menu';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Gamepad2, LogOut, ArrowRight } from 'lucide-react';

const OpenGamePrivy = dynamic(() => import('./privy-provider'), {
  ssr: false,
  loading: () => <p className="invite-page">正在连接登录服务…</p>,
});

interface Session {
  mode: 'local' | 'invite';
  auth?: { provider: 'invite' | 'privy'; appId: string | null };
  user: { id: string; label: string; linked?: boolean } | null;
}
const SessionContext = createContext<Session>({ mode: 'local', user: null });
export const useSession = () => useContext(SessionContext);

export function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session>();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('暂时无法连接工作台，请稍后重试。');
      setSession(await response.json());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const check = () => {
      void refresh();
    };
    window.addEventListener('opengame-session-expired', check);
    return () => {
      window.removeEventListener('opengame-session-expired', check);
    };
  }, []);
  if (pathname === '/marketplace') return <>{children}</>;
  const content =
    session && (session.mode === 'local' || session.user) ? (
      <SessionContext value={session}>{children}</SessionContext>
    ) : (
      <main className="invite-page">
        <section className="invite-card">
          <div className="brand">
            <span className="brandmark">
              <Gamepad2 size={24} />
            </span>
            OpenGame
          </div>
          <Link href="/marketplace">浏览作品广场 →</Link>
          <span className="eyebrow">从一个想法开始</span>
          <h1>
            让你的想法，
            <br />
            成为可玩的游戏。
          </h1>
          <p>
            描述玩法，在线试玩，在对话中不断打磨。
            <br />
            {session?.auth?.provider === 'privy'
              ? '用邮箱或 Google 登录，开始你的创作。'
              : '使用邀请人发给你的专属访问码进入工作台。'}
          </p>
          {session?.auth?.provider === 'privy' && <LoginButtons />}
          {session ? (
            <details
              open={session.auth?.provider !== 'privy'}
              className="legacy-login"
            >
              <summary>
                {session.auth?.provider === 'privy'
                  ? '已有访问码？先恢复原账号'
                  : '使用内测访问码'}
              </summary>
              {session.auth?.provider === 'privy' && (
                <p>
                  先用访问码进入，再绑定邮箱或
                  Google，保留已有作品和额度。绑定后访问码失效。
                </p>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    const response = await fetch('/api/session', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ code }),
                    });
                    const result = await response.json();
                    if (!response.ok)
                      throw new Error(result.error || '登录未完成');
                    setCode('');
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label htmlFor="invite-code">内测访问码</label>
                <input
                  id="invite-code"
                  type="password"
                  autoComplete="current-password"
                  value={code}
                  maxLength={200}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="粘贴你的专属访问码"
                  required
                />
                <button
                  className="button primary"
                  disabled={busy || !code.trim()}
                >
                  {busy ? '正在进入…' : '进入创作工作台'}
                  <ArrowRight size={17} />
                </button>
              </form>
            </details>
          ) : (
            <p>正在连接工作台…</p>
          )}
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          {!session && error && (
            <button className="button" onClick={() => void refresh()}>
              重新连接
            </button>
          )}
          <small>
            {session?.auth?.provider === 'privy'
              ? '首次验证将创建账号，无需设置密码。'
              : '每人一个访问码，请妥善保管。作品介绍公开可见，试玩与创作需受邀登录。'}
          </small>
        </section>
      </main>
    );
  return session?.auth?.provider === 'privy' && session.auth.appId ? (
    <OpenGamePrivy appId={session.auth.appId} onAuthenticated={refresh}>
      {content}
    </OpenGamePrivy>
  ) : (
    content
  );
}
export function AccountMenu() {
  const { mode, user, auth: config } = useSession();
  const auth = useAuth();
  const [error, setError] = useState('');
  if (mode === 'local')
    return (
      <>
        <span className="local-badge">本地工作台</span>
        <span className="avatar">你</span>
      </>
    );
  return (
    <div className="account-menu">
      <QuotaMenu />
      <span>{user?.label}</span>
      {config?.provider === 'privy' && !user?.linked && (
        <details className="account-link">
          <summary>绑定邮箱 / Google</summary>
          <LoginButtons userId={user?.id} />
        </details>
      )}
      <button
        className="icon-button"
        disabled={auth.busy}
        aria-label="退出登录"
        title={error || '退出登录'}
        onClick={async () => {
          try {
            const r = await fetch('/api/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: '{}',
            });
            if (!r.ok && r.status !== 401)
              throw new Error('退出未完成，请重试');
            for (const key of Object.keys(localStorage))
              if (
                key.startsWith(`opengame-draft-${user?.id}-`) ||
                key.startsWith(`opengame-canvas-${user?.id}-`)
              )
                localStorage.removeItem(key);
            if (config?.provider === 'privy') await auth.logout();
            window.location.assign('/');
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <LogOut size={16} />
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
