import type { CheckoutDetails } from './data/checkout';
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface PaymentInfo {
  cardLast4: string;
  cardBrand: string;
}
export interface PlacedOrder {
  id: string;
  items: {
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }[];
  total: number;
  payment?: PaymentInfo;
  createdAt: string;
}
export interface CartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
}
export interface CartResponse {
  items: CartLine[];
  count: number;
  total: number;
  lastOrderId: string | null;
}
export interface OrderResponse {
  id: string;
  total: number;
  payment: PaymentInfo;
  breakdown: {
    subtotal: number;
    shipping: number;
    tax: number;
    total: number;
  };
}
export interface OrderDetail extends OrderResponse {
  items: {
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }[];
  shippingMethod: string;
  deliveryDay: string;
  address: {
    name: string;
    street: string;
    city: string;
    zip: string;
  };
  createdAt: string;
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(detail?.error ?? `${method} ${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}
export const shopApi = {
  getCart: () => request<CartResponse>('/api/cart'),
  addItem: (productId: string, replace = false) =>
    request<CartResponse>('/api/cart/items', 'POST', { productId, replace }),
  removeItem: (productId: string) =>
    request<CartResponse>(`/api/cart/items/${encodeURIComponent(productId)}`, 'DELETE'),
  placeOrder: (payment: PaymentInfo, checkout: CheckoutDetails) =>
    request<OrderResponse>('/api/orders', 'POST', { payment, checkout }),
  getOrder: (id: string) => request<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`),
  getOrders: () => request<PlacedOrder[]>('/api/orders'),
  getMe: () =>
    request<{
      user: User | null;
    }>('/api/auth/me'),
  getFaqAnswers: () =>
    request<{
      answers: {
        id: string;
        answer: string;
      }[];
    }>('/api/faq'),
  login: (email: string, password?: string) =>
    request<{
      user: User;
    }>('/api/auth/login', 'POST', { email, password }),
  signup: (name: string, email: string, password?: string) =>
    request<{
      user: User;
    }>('/api/auth/signup', 'POST', { name, email, password }),
  logout: () =>
    request<{
      ok: boolean;
    }>('/api/auth/logout', 'POST', {}),
};
