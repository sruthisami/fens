import { useNavigate } from 'react-router-dom';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import { getProduct } from '../data/products';
import { CHECKOUT_START } from '../version';
export function CartPage() {
  const { items, total, removeItem } = useCart();
  const navigate = useNavigate();
  return (
    <section>
      <h1>Your cart</h1>
      {items.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          <ul className="cart-list">
            {items.map((item) => {
              const product = getProduct(item.productId);
              if (!product) return null;
              return (
                <li key={item.productId}>
                  <span>
                    {product.name} × {item.quantity}
                  </span>
                  <span>${product.price * item.quantity}</span>
                  <button
                    type="button"
                    data-component="RemoveButton"
                    onClick={() => void removeItem(item.productId)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="total">Subtotal: ${total} (shipping and tax are added at checkout)</p>
          <PrimaryButton onClick={() => navigate(CHECKOUT_START)}>Checkout</PrimaryButton>
        </>
      )}
    </section>
  );
}
