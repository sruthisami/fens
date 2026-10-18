import { App } from './App';
import { AuthProvider } from './auth';
import { CartProvider } from './cart';
import { SHOP_VERSION } from './version';
export function Shell() {
  return (
    <AuthProvider>
      <CartProvider>
        <div className={`shop shop-${SHOP_VERSION}`}>
          <App />
        </div>
      </CartProvider>
    </AuthProvider>
  );
}
