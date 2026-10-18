import type { Request, RequestHandler, Response } from 'express';
import { VERSION } from './config.js';
import { NOT_FOUND, ROUTES, findRoute, type PageMeta } from './routeTable.js';
import { cartCount, sessionOf } from './session.js';
export type HtmlLoader = (url: string) => Promise<string>;
export type PageRenderer = (path: string) => Promise<string>;
const EMPTY_ROOT = '<div id="root"></div>';
export function injectBody(html: string, body: string): string {
  if (!html.includes(EMPTY_ROOT)) throw new Error('index.html has no empty <div id="root"></div>');
  return html.replace(EMPTY_ROOT, () => `<div id="root">${body}</div>`);
}
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function origin(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}
export function injectMeta(html: string, meta: PageMeta): string {
  const head = `<title>${escapeHtml(meta.title)}</title>\n    <meta name="description" content="${escapeHtml(meta.description)}" />`;
  return html.replace(/<title>[^<]*<\/title>/, head);
}
export const DISALLOW = [
  '/cart',
  '/checkout/',
  '/login',
  '/forgot-password',
  '/reset-sent',
  '/orders',
];
const disallowed = (path: string) => DISALLOW.some((prefix) => path.startsWith(prefix));
export function robots(): RequestHandler {
  return (req, res) => {
    const rules = DISALLOW.map((p) => `Disallow: ${p}`).join('\n');
    res
      .type('text/plain')
      .send(`User-agent: *\n${rules}\nAllow: /\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
  };
}
export function sitemap(): RequestHandler {
  return (req, res) => {
    const base = origin(req);
    const urls = ROUTES.filter((r) => !disallowed(r.path))
      .map((r) => `  <url><loc>${escapeHtml(base + r.path)}</loc></url>`)
      .join('\n');
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
  };
}
export function pages(loadHtml: HtmlLoader, render: PageRenderer): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    try {
      if (/\.[a-z0-9]+$/i.test(req.path)) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      if (req.path.length > 1 && req.path.endsWith('/')) {
        res.redirect(301, req.path.replace(/\/+$/, '') || '/');
        return;
      }
      const route = findRoute(req.path);
      if (!route) return send(res, 404, NOT_FOUND, await loadHtml(req.originalUrl));
      if (VERSION === 'v2' && route.v2RedirectTo) {
        res.redirect(302, route.v2RedirectTo);
        return;
      }
      const session = sessionOf(res);
      if (route.guard === 'cart-required') {
        if (cartCount(session) === 0) {
          res.redirect(302, '/cart');
          return;
        }
      }
      if (route.guard === 'order-required' && !session.lastOrderId) {
        res.redirect(302, '/');
        return;
      }
      if (route.guard === 'auth-required' && !session.user) {
        res.redirect(302, `/login?redirect=${encodeURIComponent(req.path)}`);
        return;
      }
      let html = await loadHtml(req.originalUrl);
      if (route.prerender) html = injectBody(html, await render(req.path));
      send(res, 200, route, html);
    } catch (err) {
      next(err);
    }
  };
}
function send(res: Response, status: number, meta: PageMeta, html: string): void {
  res.status(status).set('Cache-Control', 'no-store').type('html').send(injectMeta(html, meta));
}
