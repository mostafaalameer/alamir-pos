import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Lock, Store, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../components/ProtectedRoute';

const fieldCls =
  'w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl py-3 pr-10 text-sm text-white outline-none';

export function LoginPage() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (session) {
    return <Navigate to={homeFor(session.user.role)} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('أدخل اسم المستخدم وكلمة المرور');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await signIn(username.trim(), password);
      toast.success(`مرحباً ${next.user.name}`);
      // Role-based redirect; a deep link is honoured only if the role may open it.
      const from = (location.state as { from?: string } | null)?.from;
      const allowed =
        from && (next.user.role === 'ADMIN' ? from.startsWith('/admin') || from === '/pos' : from === '/pos');
      navigate(allowed ? from : homeFor(next.user.role), { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تسجيل الدخول';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/40">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-900/50">
            <Store size={28} className="text-white" />
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-white">ماركت الأمير</h1>
          <p className="text-xs text-cyan-300">Alamir POS</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
          <h2 className="text-base font-bold text-white">تسجيل الدخول</h2>

          <label className="block text-xs text-slate-300 space-y-1">
            <span>اسم المستخدم</span>
            <span className="relative block">
              <User size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                autoComplete="username"
                className={`${fieldCls} pl-3`}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </span>
          </label>

          <label className="block text-xs text-slate-300 space-y-1">
            <span>كلمة المرور</span>
            <span className="relative block">
              <Lock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className={`${fieldCls} pl-10`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-xs text-rose-300 bg-rose-950/60 border border-rose-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold py-3 rounded-xl text-sm"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? 'جاري الدخول...' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;

