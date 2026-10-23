'use client';
import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthContext } from './auth-context';

type Intent = { action: 'login' | 'link'; userId?: string; at: number };
const intentKey = 'opengame-auth-intent';
function readIntent(): Intent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(intentKey) || 'null');
    if (
      value &&
      ['login', 'link'].includes(value.action) &&
      typeof value.at === 'number' &&
      Date.now() - value.at < 600000
    )
      return value;
  } catch {
    /* No authentication is resumed without a valid explicit intent. */
  }
  return null;
}
export default function OpenGamePrivy({
  appId,
  onAuthenticated,
  children,
}: {
  appId: string;
  onAuthenticated: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'google'],
        appearance: {
          theme: 'light',
          accentColor: '#9175ff',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
      }}
    >
      <Bridge onAuthenticated={onAuthenticated}>{children}</Bridge>
    </PrivyProvider>
  );
}
function Bridge({
  onAuthenticated,
  children,
}: {
  onAuthenticated: () => Promise<void>;
  children: ReactNode;
}) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const [intent, setIntent] = useState<Intent | null>(readIntent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const refresh = useRef(onAuthenticated);
  refresh.current = onAuthenticated;
  function clearIntent() {
    sessionStorage.removeItem(intentKey);
    setIntent(null);
  }
  const { login } = useLogin({
    onError: () => {
      clearIntent();
      setBusy(false);
      setError('登录未完成，请重试。');
    },
  });
  useEffect(() => {
    if (!ready || !authenticated || !intent || running.current) return;
    running.current = true;
    setBusy(true);
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('身份验证已过期，请重新登录。');
        const response = await fetch('/api/session/privy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            action: intent.action,
            ...(intent.userId ? { userId: intent.userId } : {}),
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || '暂时无法登录，请重试。');
        clearIntent();
        await refresh.current();
      } catch (e) {
        clearIntent();
        setError(e instanceof Error ? e.message : '登录未完成，请重试。');
      } finally {
        running.current = false;
        setBusy(false);
      }
    })();
  }, [ready, authenticated, intent, getAccessToken]);
  return (
    <AuthContext
      value={{
        ready,
        busy,
        error,
        begin: async (method, userId) => {
          setError('');
          setBusy(true);
          clearIntent();
          try {
            if (authenticated) await logout();
            const next: Intent = {
              action: userId ? 'link' : 'login',
              userId,
              at: Date.now(),
            };
            // OAuth may redirect away; store intent only, never credentials or tokens.
            sessionStorage.setItem(intentKey, JSON.stringify(next));
            setIntent(next);
            login({ loginMethods: [method] });
          } catch {
            clearIntent();
            setError('暂时无法开始登录，请重试。');
          } finally {
            setBusy(false);
          }
        },
        logout: async () => {
          clearIntent();
          await logout();
        },
      }}
    >
      {children}
    </AuthContext>
  );
}
