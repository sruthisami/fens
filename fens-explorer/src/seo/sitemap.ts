import { XMLParser } from 'fast-xml-parser';
import { normalizePath } from '../crawl/normalize.js';
import type { SitemapEntry } from './types.js';
const TIMEOUT_MS = 10000;
export async function checkSitemap(origin: string): Promise<SitemapEntry[] | null> {
  const res = await fetch(`${origin}/sitemap.xml`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const doc = new XMLParser({ ignoreAttributes: true }).parse(await res.text()) as {
    urlset?: {
      url?:
        | {
            loc?: unknown;
          }
        | {
            loc?: unknown;
          }[];
    };
  };
  const urls = doc.urlset?.url;
  const locs = (Array.isArray(urls) ? urls : urls ? [urls] : [])
    .map((u) => (typeof u.loc === 'string' ? u.loc.trim() : ''))
    .filter(Boolean);
  const entries: SitemapEntry[] = [];
  for (const url of locs) {
    const path = normalizePath(url, origin);
    if (!path || !url.startsWith(origin)) {
      entries.push({ url, path: null, status: 0, location: null });
      continue;
    }
    const r = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    const location = r?.headers.get('location');
    entries.push({
      url,
      path,
      status: r?.status ?? 0,
      location: location ? normalizePath(new URL(location, url).href, origin) : null,
    });
  }
  return entries;
}
