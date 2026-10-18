import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { shopApi, type OrderDetail } from '../api';
import { useCart } from '../cart';
export function CheckoutConfirmation() {
  const { lastOrderId, refresh } = useCart();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!lastOrderId) return;
    shopApi
      .getOrder(lastOrderId)
      .then(setOrder)
      .catch(() => setError('We could not load the order details.'));
  }, [lastOrderId]);
  const money = (n: number) => `$${n.toFixed(2)}`;
  return (
    <section>
      <h1>Order placed</h1>
      {!order && !error && <p>Loading your order…</p>}
      {error && <p role="alert">{error}</p>}
      {order && (
        <>
          <p>
            Thanks for your order. Your order number is <strong>{order.id}</strong>. A confirmation
            will be sent to you.
          </p>
          <div className="review-grid">
            <div>
              <h2>Delivery</h2>
              <p>
                {order.address.name}
                <br />
                {order.address.street}
                <br />
                {order.address.city} {order.address.zip}
              </p>
              <p>
                {order.shippingMethod}, {order.deliveryDay} delivery
              </p>
            </div>
            <div>
              <h2>Payment</h2>
              <p>
                {order.payment.cardBrand} ending in {order.payment.cardLast4}
              </p>
            </div>
          </div>
          <ul className="cart-list">
            {order.items.map((item) => (
              <li key={item.productId}>
                <span>
                  {item.name} × {item.quantity}
                </span>
                <span>{money(item.price * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <table className="totals">
            <tbody>
              <tr>
                <th scope="row">Subtotal</th>
                <td>{money(order.breakdown.subtotal)}</td>
              </tr>
              <tr>
                <th scope="row">Shipping</th>
                <td>{order.breakdown.shipping === 0 ? 'Free' : money(order.breakdown.shipping)}</td>
              </tr>
              <tr>
                <th scope="row">Tax</th>
                <td>{money(order.breakdown.tax)}</td>
              </tr>
              <tr>
                <th scope="row">Total</th>
                <td>
                  <strong>{money(order.breakdown.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <p>
        <Link to="/">Continue shopping</Link>
      </p>
    </section>
  );
}
