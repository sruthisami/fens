import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import { getProduct } from '../data/products';
import { DELIVERY_DAYS, SHIPPING_METHODS } from '../data/checkout';
export function CheckoutReview() {
  const { items, pricing, payment, checkout, placeOrder } = useCart();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => `$${n.toFixed(2)}`;
  if (items.length === 0) {
    return (
      <section>
        <h1>Review order</h1>
        <p>Your cart is empty.</p>
      </section>
    );
  }
  return (
    <section>
      <h1>Review order</h1>
      <div className="review-grid">
        <div>
          <h2>Deliver to</h2>
          <p>
            {checkout.address.name}
            <br />
            {checkout.address.street}
            <br />
            {checkout.address.city} {checkout.address.zip}
          </p>
          <p>
            {SHIPPING_METHODS[checkout.shippingMethod].label}, {DELIVERY_DAYS[checkout.deliveryDay]}{' '}
            delivery
          </p>
        </div>
        <div>
          <h2>Payment</h2>
          {payment ? (
            <p>
              {payment.cardBrand} ending in {payment.cardLast4}
            </p>
          ) : (
            <p role="alert">
              Payment details are missing. <Link to="/checkout/billing">Enter them</Link> to place
              the order.
            </p>
          )}
        </div>
      </div>
      <ul className="cart-list">
        {items.map((item) => {
          const product = getProduct(item.productId);
          if (!product) return null;
          return (
            <li key={item.productId}>
              <span>
                {product.name} × {item.quantity}
              </span>
              <span>{money(product.price * item.quantity)}</span>
            </li>
          );
        })}
      </ul>
      <table className="totals">
        <tbody>
          <tr>
            <th scope="row">Subtotal</th>
            <td>{money(pricing.subtotal)}</td>
          </tr>
          <tr>
            <th scope="row">Shipping</th>
            <td>{pricing.shipping === 0 ? 'Free' : money(pricing.shipping)}</td>
          </tr>
          <tr>
            <th scope="row">Tax</th>
            <td>{money(pricing.tax)}</td>
          </tr>
          <tr>
            <th scope="row">Total</th>
            <td>
              <strong>{money(pricing.total)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      {error && (
        <p role="alert" style={{ color: 'red' }}>
          {error}
        </p>
      )}
      <PrimaryButton
        disabled={!payment}
        onClick={() => {
          if (!payment) return setError('Enter payment details before placing the order.');
          void placeOrder(payment, () => navigate('/checkout/confirmation'));
        }}
      >
        Place order
      </PrimaryButton>
    </section>
  );
}
