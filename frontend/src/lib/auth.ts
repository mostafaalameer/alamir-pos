export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const TOKEN_KEY = 'alamir_jwt_token';
const USER_KEY = 'alamir_session_user';
export const AUTH_EXPIRED_EVENT = 'alamir-auth-expired';

export type UserRole = 'ADMIN' | 'CASHIER';

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
}

export interface Session {
  token: string;
  user: SessionUser;
}

/** Reads the `exp` claim (seconds) from a JWT without verifying it (the server verifies). */
function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (!token || !rawUser) return null;
  if (tokenExpired(token)) {
    clearSession();
    return null;
  }
  try {
    return { token, user: JSON.parse(rawUser) as SessionUser };
  } catch {
    return null;
  }
}

/** Called when the API rejects the stored token (expired/invalid). */
export function handleUnauthorized(): void {
  clearSession();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

export async function login(username: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('تعذر الاتصال بالخادم السحابي. تأكد من تشغيل الخادم والاتصال بالإنترنت');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || `فشل تسجيل الدخول (${res.status})`);
  }

  const session: Session = { token: json.data.token, user: json.data.user };
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  return session;
}

/** Authenticated download (anchor links cannot send the Authorization header). */
export async function downloadReport(path: string, fallbackName: string): Promise<void> {
  const session = getSession();
  if (!session) {
    handleUnauthorized();
    throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  }
  if (!res.ok) {
    throw new Error(`تعذر تحميل التقرير (${res.status})`);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
