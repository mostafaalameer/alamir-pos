import React, { useState } from 'react';
import { login, Session } from '../lib/auth';

interface Props {
  onLoggedIn: (session: Session) => void;
  notice?: string;
}

const inputCls =
  'w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-sm text-white outline-none';

export function AdminLogin({ onLoggedIn, notice }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onLoggedIn(await login(username.trim(), password));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <h2 className="text-lg font-bold text-white text-center">تسجيل دخول الإدارة</h2>
      <p className="text-xs text-slate-400 text-center mt-1 mb-4">
        لوحة الإدارة مخصصة لمدير النظام (ADMIN) فقط
      </p>

      {notice && (
        <p className="text-xs text-amber-300 bg-amber-950/60 border border-amber-800 rounded-lg px-3 py-2 mb-3">
          {notice}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs text-slate-300 space-y-1">
          <span>اسم المستخدم</span>
          <input
            autoFocus
            autoComplete="username"
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="block text-xs text-slate-300 space-y-1">
          <span>كلمة المرور</span>
          <input
            type="password"
            autoComplete="current-password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-rose-300 bg-rose-950/60 border border-rose-800 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold py-2.5 rounded-lg text-sm"
        >
          {busy ? 'جاري الدخول...' : 'دخول'}
        </button>
      </form>
    </div>
  );
}

export default AdminLogin;

