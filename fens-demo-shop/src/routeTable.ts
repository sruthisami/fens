import table from '../routes.json';
export type Guard = 'none' | 'cart-required' | 'order-required' | 'auth-required';
export interface PageMeta {
  title: string;
  description: string;
}
export interface RouteEntry extends PageMeta {
  path: string;
  guard: Guard;
  v2RedirectTo?: string;
  prerender?: boolean;
}
export const ROUTES = table.routes as RouteEntry[];
export const NOT_FOUND: PageMeta = table.notFound;
export function metaFor(path: string): PageMeta {
  return ROUTES.find((r) => r.path === path) ?? NOT_FOUND;
}
