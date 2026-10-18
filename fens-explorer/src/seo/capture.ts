import { load } from 'cheerio';
import type { Page } from 'playwright';
import { settle } from '../crawl/page.js';
import type { SeoSnapshot } from './types.js';
export const MOBILE_VIEWPORT = { width: 375, height: 812 };
const RAW_TIMEOUT_MS = 10000;
export const TEXT_LIMIT = 2000;
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export function rawText(html: string): string {
  const $ = load(html);
  $('script, style, noscript, template').remove();
  return $('body').text();
}
export function jsOnlyRatio(raw: string, rendered: string): number {
  const available = new Map<string, number>();
  for (const w of words(raw)) available.set(w, (available.get(w) ?? 0) + 1);
  const shown = words(rendered);
  if (shown.length === 0) return 0;
  let missing = 0;
  for (const w of shown) {
    const n = available.get(w) ?? 0;
    if (n > 0) available.set(w, n - 1);
    else missing++;
  }
  return Math.round((missing / shown.length) * 1000) / 1000;
}
export function jsonLdTypes(blocks: string[]): string[] {
  const types = new Set<string>();
  const add = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const t = (node as Record<string, unknown>)['@type'];
    for (const v of Array.isArray(t) ? t : [t]) if (typeof v === 'string') types.add(v);
    const graph = (node as Record<string, unknown>)['@graph'];
    if (Array.isArray(graph)) graph.forEach(add);
  };
  for (const block of blocks) {
    try {
      const data: unknown = JSON.parse(block);
      (Array.isArray(data) ? data : [data]).forEach(add);
    } catch {}
  }
  return [...types].sort();
}
async function fetchRaw(url: string): Promise<{
  status: number;
  html: string;
}> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(RAW_TIMEOUT_MS),
      headers: { accept: 'text/html' },
    });
    return { status: res.status, html: res.status === 200 ? await res.text() : '' };
  } catch {
    return { status: 0, html: '' };
  }
}
function readRendered() {
  const strip = (root: Element, selectors: string) => {
    const clone = root.cloneNode(true) as Element;
    clone.querySelectorAll(selectors).forEach((el) => el.remove());
    return clone.textContent ?? '';
  };
  const body = document.body;
  const content = strip(body, 'script, style, noscript, template, header, footer, nav, a');
  const priceLike = /(?:[$€£]\s?\d)|(?:\d[\d.,]*\s?(?:USD|EUR|GBP)\b)/.test(content);
  const purchase = [
    ...document.querySelectorAll('button, [role="button"], input[type="submit"]'),
  ].some((el) =>
    /\b(add to (cart|bag|basket)|buy now)\b/i.test(
      (el.textContent || el.getAttribute('value') || '').trim(),
    ),
  );
  return {
    text: strip(body, 'script, style, noscript, template'),
    metaDescription:
      document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || null,
    h1Count: document.querySelectorAll('h1').length,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
    jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (s) => s.textContent ?? '',
    ),
    hasTable: document.querySelector('table th') !== null,
    productLike: priceLike && purchase,
  };
}
function readOverflow() {
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= vw) return null;
  const clips = (el: Element) => /(auto|scroll|hidden|clip)/.test(getComputedStyle(el).overflowX);
  let best: {
    el: Element;
    width: number;
  } | null = null;
  for (const el of document.body.querySelectorAll('*')) {
    const rect = el.getBoundingClientRect();
    if (rect.right <= vw + 1 || rect.width === 0) continue;
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent.getBoundingClientRect().right > vw + 1)
      continue;
    let inside = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
      if (clips(a)) inside = true;
    if (inside) continue;
    if (!best || rect.width > best.width) best = { el, width: Math.round(rect.width) };
  }
  if (!best) return { selector: 'html', html: '', component: null, width: 0 };
  const el = best.el;
  const name = el.getAttribute('data-component');
  const cls = [...el.classList].map((c) => `.${CSS.escape(c)}`).join('');
  return {
    selector: name ? `[data-component="${name}"]` : `${el.tagName.toLowerCase()}${cls}`,
    html: el.outerHTML.slice(0, 300),
    component: el.closest('[data-component]')?.getAttribute('data-component') ?? null,
    width: best.width,
  };
}
export async function captureSeo(page: Page, url: string): Promise<SeoSnapshot> {
  const raw = await fetchRaw(url);
  const rendered = await page.evaluate(readRendered);
  const rawBody = rawText(raw.html);
  const viewport = page.viewportSize();
  await page.setViewportSize(MOBILE_VIEWPORT);
  await settle(page);
  const overflow = await page.evaluate(readOverflow);
  if (viewport) await page.setViewportSize(viewport);
  return {
    raw_status: raw.status,
    raw_text_length: rawBody.replace(/\s+/g, ' ').trim().length,
    rendered_text_length: rendered.text.replace(/\s+/g, ' ').trim().length,
    text: rendered.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT),
    js_only_ratio: jsOnlyRatio(rawBody, rendered.text),
    meta_description: rendered.metaDescription,
    h1_count: rendered.h1Count,
    canonical: rendered.canonical,
    jsonld_types: jsonLdTypes(rendered.jsonld),
    has_table: rendered.hasTable,
    mobile_overflow: overflow !== null,
    overflow,
    product_like: rendered.productLike,
  };
}
