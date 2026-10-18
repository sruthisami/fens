import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { useCart } from '../cart';
import type { Guard as GuardType } from '../routeTable';
export function Guard({ guard, children }: { guard: GuardType; children: ReactNode }) {
  const { loaded: cartLoaded, count, lastOrderId } = useCart();
  const { loaded: authLoaded, user } = useAuth();
  const location = useLocation();
  if (guard === 'none') return children;
  if (!cartLoaded || !authLoaded) return null;
  const loginRedirect = `/login?redirect=${encodeURIComponent(location.pathname)}`;
  if (guard === 'cart-required' && count === 0) {
    return <Navigate to="/cart" replace />;
  }
  if (guard === 'order-required' && !lastOrderId) {
    return <Navigate to="/" replace />;
  }
  if (guard === 'auth-required' && !user) {
    return <Navigate to={loginRedirect} replace />;
  }
  return children;
}
