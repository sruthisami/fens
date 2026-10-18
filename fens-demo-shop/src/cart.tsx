import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { shopApi, type CartResponse, type OrderResponse, type PaymentInfo } from './api';
import {
  DEFAULT_CHECKOUT,
  priceBreakdown,
  type CheckoutDetails,
  type PriceBreakdown,
} from './data/checkout';
export interface CartItem {
  productId: string;
  quantity: number;
}
interface CartValue {
  loaded: boolean;
  items: CartItem[];
  count: number;
  total: number;
  pricing: PriceBreakdown;
  lastOrderId: string | null;
  payment: PaymentInfo | null;
  setPayment: (payment: PaymentInfo | null) => void;
  checkout: CheckoutDetails;
  setCheckout: (patch: Partial<CheckoutDetails>) => void;
  addItem: (productId: string) => Promise<void>;
  buyNow: (productId: string) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  placeOrder: (payment: PaymentInfo, onPlaced: (order: OrderResponse) => void) => Promise<void>;
  refresh: () => Promise<void>;
}
const EMPTY: CartResponse = { items: [], count: 0, total: 0, lastOrderId: null };
const CartContext = createContext<CartValue | null>(null);
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartResponse>(EMPTY);
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [checkout, setCheckoutState] = useState<CheckoutDetails>(DEFAULT_CHECKOUT);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    shopApi
      .getCart()
      .then(setCart)
      .catch((err: unknown) => console.error(err))
      .finally(() => setLoaded(true));
  }, []);
  const setCheckout = useCallback((patch: Partial<CheckoutDetails>) => {
    setCheckoutState((prev) => ({ ...prev, ...patch }));
  }, []);
  const addItem = useCallback(async (productId: string) => {
    setCart(await shopApi.addItem(productId));
  }, []);
  const buyNow = useCallback(async (productId: string) => {
    setCart(await shopApi.addItem(productId, true));
  }, []);
  const removeItem = useCallback(async (productId: string) => {
    setCart(await shopApi.removeItem(productId));
  }, []);
  const placeOrder = useCallback(
    async (paymentInfo: PaymentInfo, onPlaced: (order: OrderResponse) => void) => {
      const order = await shopApi.placeOrder(paymentInfo, checkout);
      setCart((prev) => ({ ...prev, lastOrderId: order.id }));
      onPlaced(order);
    },
    [checkout],
  );
  const refresh = useCallback(async () => {
    setCart(await shopApi.getCart());
  }, []);
  const value = useMemo<CartValue>(
    () => ({
      loaded,
      items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      count: cart.count,
      total: cart.total,
      pricing: priceBreakdown(cart.total, checkout.shippingMethod),
      lastOrderId: cart.lastOrderId,
      payment,
      setPayment,
      checkout,
      setCheckout,
      addItem,
      buyNow,
      removeItem,
      placeOrder,
      refresh,
    }),
    [
      cart,
      loaded,
      payment,
      checkout,
      setCheckout,
      addItem,
      buyNow,
      removeItem,
      placeOrder,
      refresh,
    ],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) {
    throw new Error('useCart must be used inside CartProvider');
  }
  return value;
}
