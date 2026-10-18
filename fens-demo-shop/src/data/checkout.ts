export const TAX_RATE = 0.08;
export const FREE_SHIPPING_OVER = 75;
export const SHIPPING_METHODS = {
  standard: { label: 'Standard (3-5 days)', price: 5 },
  express: { label: 'Express (1-2 days)', price: 12 },
} as const;
export type ShippingMethod = keyof typeof SHIPPING_METHODS;
export const DELIVERY_DAYS = { tue: 'Tuesday', thu: 'Thursday' } as const;
export type DeliveryDay = keyof typeof DELIVERY_DAYS;
export interface Address {
  name: string;
  street: string;
  city: string;
  zip: string;
}
export interface CheckoutDetails {
  shippingMethod: ShippingMethod;
  address: Address;
  deliveryDay: DeliveryDay;
}
export const DEFAULT_ADDRESS: Address = {
  name: 'Jordan Lee',
  street: '12 Market Street',
  city: 'Springfield',
  zip: '62704',
};
export const DEFAULT_CHECKOUT: CheckoutDetails = {
  shippingMethod: 'standard',
  address: DEFAULT_ADDRESS,
  deliveryDay: 'tue',
};
const cents = (n: number) => Math.round(n * 100) / 100;
export interface PriceBreakdown {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
}
export function priceBreakdown(subtotal: number, method: ShippingMethod): PriceBreakdown {
  const shipping =
    method === 'standard' && subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_METHODS[method].price;
  const tax = cents(subtotal * TAX_RATE);
  return { subtotal: cents(subtotal), shipping, tax, total: cents(subtotal + shipping + tax) };
}
export function validateAddress(a: Address): string | null {
  if (a.name.trim().length < 2) return 'Please enter the full name for delivery';
  if (a.street.trim().length < 3) return 'Please enter a street address';
  if (a.city.trim().length < 2) return 'Please enter a city';
  if (!/^\d{5}$/.test(a.zip.trim())) return 'Please enter a 5-digit ZIP code';
  return null;
}
export function validateExpiry(expiry: string, now = new Date()): string | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry.trim());
  if (!m) return 'Please enter a valid expiry date (MM/YY)';
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return 'Please enter a valid expiry month (01-12)';
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  if (endOfMonth < now) return 'This card has expired';
  return null;
}
export const DEMO_CARD = { number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123' };
export function cardBrand(number: string): string {
  if (/^4/.test(number)) return 'Visa';
  if (/^5[1-5]/.test(number)) return 'Mastercard';
  if (/^3[47]/.test(number)) return 'Amex';
  return 'Card';
}
