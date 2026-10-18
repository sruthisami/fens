import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
export interface OrderLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}
export interface Order {
  id: string;
  items: OrderLine[];
  shippingMethod: string;
  deliveryDay: string;
  address: {
    name: string;
    street: string;
    city: string;
    zip: string;
  };
  breakdown: {
    subtotal: number;
    shipping: number;
    tax: number;
    total: number;
  };
  total: number;
  payment: {
    cardLast4: string;
    cardBrand: string;
  };
  createdAt: string;
}
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface RegisteredUser extends User {
  password: string;
}
export const registeredUsers = new Map<string, RegisteredUser>([
  [
    'demo@fence.com',
    {
      id: 'u-demo',
      email: 'demo@fence.com',
      name: 'Demo User',
      password: 'password123',
    },
  ],
  [
    'alex@fence.com',
    {
      id: 'u-alex',
      email: 'alex@fence.com',
      name: 'Alex Smith',
      password: 'password123',
    },
  ],
  [
    'crawler@flowlens.local',
    {
      id: 'u-crawler',
      email: 'crawler@flowlens.local',
      name: 'FlowLens Crawler',
      password: 'password123',
    },
  ],
]);
export interface Session {
  id: string;
  user: User | null;
  cart: Map<string, number>;
  orders: Order[];
  lastOrderId: string | null;
}
const COOKIE = 'shop_sid';
const store = new Map<string, Session>();
function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
export function sessions(): RequestHandler {
  return (req, res, next) => {
    const sid = readCookie(req.headers.cookie, COOKIE);
    let session = sid ? store.get(sid) : undefined;
    if (!session) {
      session = { id: randomUUID(), user: null, cart: new Map(), orders: [], lastOrderId: null };
      store.set(session.id, session);
      res.append('Set-Cookie', `${COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Lax`);
    }
    res.locals.session = session;
    next();
  };
}
export function sessionOf(res: Response): Session {
  return res.locals.session as Session;
}
export function cartCount(session: Session): number {
  let n = 0;
  for (const qty of session.cart.values()) n += qty;
  return n;
}
