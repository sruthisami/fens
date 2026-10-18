import { randomUUID } from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import {
  DELIVERY_DAYS,
  priceBreakdown,
  SHIPPING_METHODS,
  validateAddress,
  type Address,
  type CheckoutDetails,
  type DeliveryDay,
  type ShippingMethod,
} from '../src/data/checkout.js';
import { PRODUCTS, getProduct } from '../src/data/products.js';
import { FAQ_ANSWERS } from './faq.js';
import { cartCount, registeredUsers, sessionOf, type Order, type Session } from './session.js';
const MAX_QUANTITY = 10;
let nextOrderNumber = 10001;
function cartView(session: Session) {
  const items = [...session.cart.entries()].flatMap(([productId, quantity]) => {
    const p = getProduct(productId);
    return p
      ? [{ productId, name: p.name, price: p.price, quantity, lineTotal: p.price * quantity }]
      : [];
  });
  return {
    items,
    count: cartCount(session),
    total: items.reduce((sum, i) => sum + i.lineTotal, 0),
    lastOrderId: session.lastOrderId,
  };
}
function parsePayment(raw: unknown): {
  cardLast4: string;
  cardBrand: string;
} | null {
  const p = raw as
    | {
        cardLast4?: unknown;
        cardBrand?: unknown;
      }
    | undefined;
  if (typeof p?.cardLast4 !== 'string' || !/^\d{4}$/.test(p.cardLast4)) return null;
  if (typeof p.cardBrand !== 'string' || p.cardBrand.length === 0 || p.cardBrand.length > 30)
    return null;
  return { cardLast4: p.cardLast4, cardBrand: p.cardBrand };
}
function parseCheckout(raw: unknown): CheckoutDetails | string {
  const c = raw as
    | {
        shippingMethod?: unknown;
        deliveryDay?: unknown;
        address?: unknown;
      }
    | undefined;
  if (typeof c?.shippingMethod !== 'string' || !(c.shippingMethod in SHIPPING_METHODS)) {
    return 'Choose a shipping method';
  }
  if (typeof c.deliveryDay !== 'string' || !(c.deliveryDay in DELIVERY_DAYS)) {
    return 'Choose a delivery day';
  }
  const a = c.address as Record<string, unknown> | undefined;
  const strings = ['name', 'street', 'city', 'zip'].map((k) => a?.[k]);
  if (!strings.every((v) => typeof v === 'string' && v.length <= 100)) {
    return 'The delivery address is incomplete';
  }
  const address: Address = {
    name: String(a?.name),
    street: String(a?.street),
    city: String(a?.city),
    zip: String(a?.zip),
  };
  const problem = validateAddress(address);
  if (problem) return problem;
  return {
    shippingMethod: c.shippingMethod as ShippingMethod,
    deliveryDay: c.deliveryDay as DeliveryDay,
    address,
  };
}
function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}
function requireJson(req: Request, res: Response): boolean {
  if (!req.is('application/json')) {
    fail(res, 415, 'Content-Type must be application/json');
    return false;
  }
  return true;
}
export function api(): Router {
  const router = Router();
  router.use(express.json({ limit: '10kb' }));
  router.get('/products', (_req, res) => {
    res.json(PRODUCTS);
  });
  router.get('/products/:id', (req, res) => {
    const product = getProduct(req.params.id);
    if (!product) return fail(res, 404, 'Product not found');
    res.json(product);
  });
  router.get('/faq', (_req, res) => {
    res.json({ answers: Object.entries(FAQ_ANSWERS).map(([id, answer]) => ({ id, answer })) });
  });
  router.get('/cart', (_req, res) => {
    res.json(cartView(sessionOf(res)));
  });
  router.post('/cart/items', (req, res) => {
    if (!requireJson(req, res)) return;
    const session = sessionOf(res);
    const body = (req.body ?? {}) as {
      productId?: unknown;
      quantity?: unknown;
      replace?: unknown;
    };
    const product = typeof body.productId === 'string' ? getProduct(body.productId) : undefined;
    if (!product) return fail(res, 400, 'productId must be a known product id');
    const quantity = body.quantity === undefined ? 1 : body.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return fail(res, 400, `quantity must be an integer from 1 to ${MAX_QUANTITY}`);
    }
    if (body.replace === true) session.cart.clear();
    const next = Math.min((session.cart.get(product.id) ?? 0) + quantity, MAX_QUANTITY);
    session.cart.set(product.id, next);
    res.json(cartView(session));
  });
  router.delete('/cart/items/:id', (req, res) => {
    const session = sessionOf(res);
    session.cart.delete(req.params.id);
    res.json(cartView(session));
  });
  router.post('/orders', (req, res) => {
    if (!requireJson(req, res)) return;
    const session = sessionOf(res);
    const view = cartView(session);
    if (view.count === 0) return fail(res, 400, 'Cart is empty');
    const body = (req.body ?? {}) as {
      payment?: unknown;
      checkout?: unknown;
    };
    const payment = parsePayment(body.payment);
    if (!payment)
      return fail(res, 400, 'Payment details are required (card last 4 digits and brand)');
    const checkout = parseCheckout(body.checkout);
    if (typeof checkout === 'string') return fail(res, 400, checkout);
    const breakdown = priceBreakdown(view.total, checkout.shippingMethod);
    const order: Order = {
      id: `FL-${nextOrderNumber++}`,
      items: view.items.map(({ productId, name, price, quantity }) => ({
        productId,
        name,
        price,
        quantity,
      })),
      shippingMethod: SHIPPING_METHODS[checkout.shippingMethod].label,
      deliveryDay: DELIVERY_DAYS[checkout.deliveryDay],
      address: checkout.address,
      breakdown,
      total: breakdown.total,
      payment,
      createdAt: new Date().toISOString(),
    };
    session.orders.push(order);
    session.lastOrderId = order.id;
    session.cart.clear();
    res.status(201).json(order);
  });
  router.get('/orders', (_req, res) => {
    res.json(sessionOf(res).orders);
  });
  router.get('/orders/:id', (req, res) => {
    const order = sessionOf(res).orders.find((o) => o.id === req.params.id);
    if (!order) return fail(res, 404, 'Order not found');
    res.json(order);
  });
  router.get('/auth/me', (_req, res) => {
    res.json({ user: sessionOf(res).user });
  });
  router.post('/auth/login', (req, res) => {
    if (!requireJson(req, res)) return;
    const { email, password } = (req.body ?? {}) as {
      email?: unknown;
      password?: unknown;
    };
    const emailStr = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const passwordStr = typeof password === 'string' ? password : '';
    if (!emailStr || !passwordStr) {
      return fail(res, 400, 'Email and password are required');
    }
    const user = registeredUsers.get(emailStr);
    if (!user || user.password !== passwordStr) {
      return fail(res, 401, 'Invalid email or password');
    }
    const session = sessionOf(res);
    session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
    };
    res.json({ user: session.user });
  });
  router.post('/auth/signup', (req, res) => {
    if (!requireJson(req, res)) return;
    const { name, email, password } = (req.body ?? {}) as {
      name?: unknown;
      email?: unknown;
      password?: unknown;
    };
    const emailStr = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const nameStr = typeof name === 'string' ? name.trim() : '';
    const passwordStr = typeof password === 'string' ? password : '';
    if (!emailStr || !emailStr.includes('@')) {
      return fail(res, 400, 'A valid email address is required');
    }
    if (!passwordStr || passwordStr.length < 6) {
      return fail(res, 400, 'Password must be at least 6 characters');
    }
    if (registeredUsers.has(emailStr)) {
      return fail(res, 400, 'An account with this email already exists');
    }
    const newUser = {
      id: randomUUID(),
      email: emailStr,
      name: nameStr || emailStr.split('@')[0] || 'User',
      password: passwordStr,
    };
    registeredUsers.set(emailStr, newUser);
    const session = sessionOf(res);
    session.user = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
    };
    res.status(201).json({ user: session.user });
  });
  router.post('/auth/logout', (_req, res) => {
    const session = sessionOf(res);
    session.user = null;
    res.json({ ok: true });
  });
  router.use((_req, res) => fail(res, 404, 'Not found'));
  return router;
}
