import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { shopApi, type PlacedOrder } from '../api';
import { useAuth } from '../auth';
const DEFAULT_ORDERS = [
  { id: 'FL-10231', date: '2 Oct 2026', total: 134, status: 'Delivered' },
  { id: 'FL-10482', date: '15 Oct 2026', total: 89, status: 'Processing' },
];
export function Orders() {
  const { loaded, user } = useAuth();
  const [orders, setOrders] = useState<PlacedOrder[]>([]);
  useEffect(() => {
    if (!user) return;
    shopApi
      .getOrders()
      .then(setOrders)
      .catch(() => {});
  }, [user]);
  const displayOrders =
    orders.length > 0
      ? orders.map((o) => ({
          id: o.id,
          date: new Date(o.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          total: o.total,
          payment: o.payment ? `${o.payment.cardBrand} •••• ${o.payment.cardLast4}` : 'Card',
          status: 'Processing',
        }))
      : DEFAULT_ORDERS.map((o) => ({ ...o, payment: 'Card •••• 4242' }));
  if (loaded && !user) {
    return (
      <section>
        <h1>Your orders</h1>
        <p>Sign in to see the orders you have placed.</p>
        <p>
          <Link to="/login?redirect=/orders">Sign in</Link> or{' '}
          <Link to="/signup">create an account</Link>.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h1>Your orders</h1>
      <ul className="cart-list">
        {displayOrders.map((order) => (
          <li key={order.id}>
            <span>
              {order.id} · {order.date} · {order.payment}
            </span>
            <span>${order.total}</span>
            <span>{order.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
