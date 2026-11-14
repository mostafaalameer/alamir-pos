import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../lib/auth';

export const homeFor = (role: UserRole) => (role === 'ADMIN' ? '/admin' : '/pos');

/**
 * Client-side route guard (UX only). The API enforces the same roles server-side.
 * - No session            -> /login
 * - Role not in `allow`   -> that role's home route
 */
export function ProtectedRoute({ allow }: { allow: UserRole[] }) {
  const { session } = useAuth();
  const location = useLocation();
  const denied = Boolean(session && !allow.includes(session.user.role));

  useEffect(() => {
    if (denied) toast.error('ليس لديك صلاحية للوصول إلى هذه الصفحة');
  }, [denied]);

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (denied) {
    return <Navigate to={homeFor(session.user.role)} replace />;
  }
  return <Outlet />;
}

