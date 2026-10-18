import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';
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
const GUARDS: Guard[] = ['none', 'cart-required', 'order-required', 'auth-required'];
function load(): {
  routes: RouteEntry[];
  notFound: PageMeta;
} {
  const raw = JSON.parse(readFileSync(join(ROOT, 'routes.json'), 'utf8')) as {
    routes?: unknown;
    notFound?: PageMeta;
  };
  if (!Array.isArray(raw.routes) || !raw.notFound) {
    throw new Error('routes.json must have "routes" and "notFound"');
  }
  const routes = raw.routes as RouteEntry[];
  const titles = new Set<string>();
  for (const r of routes) {
    if (!r.path?.startsWith('/') || !r.title || !r.description || !GUARDS.includes(r.guard)) {
      throw new Error(`Invalid routes.json entry: ${JSON.stringify(r)}`);
    }
    if (r.prerender !== undefined && (typeof r.prerender !== 'boolean' || r.guard !== 'none')) {
      throw new Error(`prerender must be a boolean on a guard "none" route: ${r.path}`);
    }
    if (titles.has(r.title)) throw new Error(`Duplicate title in routes.json: ${r.title}`);
    titles.add(r.title);
  }
  return { routes, notFound: raw.notFound };
}
const table = load();
const byPath = new Map(table.routes.map((r) => [r.path, r]));
export const ROUTES = table.routes;
export const NOT_FOUND = table.notFound;
export function findRoute(path: string): RouteEntry | undefined {
  return byPath.get(path);
}
