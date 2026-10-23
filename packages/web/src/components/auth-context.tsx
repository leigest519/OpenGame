'use client';
import { createContext, useContext } from 'react';
export const AuthContext = createContext({
  ready: false,
  busy: false,
  error: '',
  begin: (_method: 'email' | 'google', _userId?: string) => {},
  logout: async () => {},
});
export const useAuth = () => useContext(AuthContext);

export function LoginButtons({ userId }: { userId?: string }) {
  const auth = useAuth();
  return (
    <div className="auth-buttons">
      {userId && <p>绑定后继续使用当前作品与额度，原访问码将失效。</p>}
      <button
        type="button"
        className="button primary"
        disabled={!auth.ready || auth.busy}
        onClick={() => auth.begin('email', userId)}
      >
        {auth.busy
          ? '正在验证…'
          : userId
            ? '绑定邮箱'
            : '邮箱验证码登录 / 注册'}
      </button>
      <button
        type="button"
        className="button"
        disabled={!auth.ready || auth.busy}
        onClick={() => auth.begin('google', userId)}
      >
        {userId ? '绑定 Google' : '使用 Google 继续'}
      </button>
      {!auth.ready && <small>正在连接登录服务…</small>}
      {auth.error && (
        <p role="alert" className="error-box">
          {auth.error}
        </p>
      )}
    </div>
  );
}
