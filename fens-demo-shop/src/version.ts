export type ShopVersion = 'v1' | 'v2';
const requested = import.meta.env.SHOP_VERSION ?? import.meta.env.VITE_SHOP_VERSION;
export const SHOP_VERSION: ShopVersion = requested === 'v2' ? 'v2' : 'v1';
export const isV2 = SHOP_VERSION === 'v2';
export const CHECKOUT_START = isV2 ? '/checkout/shipping' : '/checkout/account';
