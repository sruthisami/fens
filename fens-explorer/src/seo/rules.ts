import { issueId, type IssueDef, type IssueOccurrence } from '../checks/index.js';
import type { GuidelineRef, Severity } from '../checks/types.js';
import type { ScreenRecord } from '../types.js';
import { G } from './guidelines.js';
import { isAllowed, type RobotsRule } from './robots.js';
import type { LighthouseResult, SitemapEntry } from './types.js';
export const JS_ONLY_THRESHOLD = 0.5;
export const JS_ONLY_MIN_TEXT = 300;
export interface RuleIssues {
  issues: IssueDef[];
  occurrences: IssueOccurrence[];
}
interface Occurrence {
  screen: string;
  selector?: string;
  html?: string;
  node_count?: number;
  details?: string[];
}
interface Def {
  source: IssueDef['source'];
  rule_id: string;
  severity: Severity;
  help: string;
  description: string;
  help_url: string;
  component?: string | null;
  guidelines: GuidelineRef[];
}
function add(out: RuleIssues, key: string, def: Def, occurrences: Occurrence[]): void {
  if (occurrences.length === 0 && !def.description) return;
  const id = issueId(key);
  out.issues.push({ id, key, component: null, ...def });
  for (const o of occurrences) {
    out.occurrences.push({
      issue: id,
      screen: o.screen,
      selector: o.selector ?? '',
      html: (o.html ?? '').slice(0, 300),
      node_count: o.node_count ?? 1,
      ...(o.details ? { details: o.details } : {}),
    });
  }
}
const DOCS = {
  js: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
  title: 'https://developers.google.com/search/docs/appearance/title-link',
  snippet: 'https://developers.google.com/search/docs/appearance/snippet',
};
const pct = (r: number) => `${Math.round(r * 100)}%`;
export function seoRuleIssues(
  screens: ScreenRecord[],
  sitemap: SitemapEntry[] | null,
  robots: RobotsRule[] = [],
): RuleIssues {
  const out: RuleIssues = { issues: [], occurrences: [] };
  const withSeo = screens.filter((s) => s.seo);
  const flow = (rule: string) => `flowlens/${rule}`;
  const jsOnly = withSeo.filter(
    (s) =>
      s.seo &&
      s.seo.raw_status === 200 &&
      s.seo.rendered_text_length >= JS_ONLY_MIN_TEXT &&
      isAllowed(s.id, robots) &&
      s.seo.js_only_ratio > JS_ONLY_THRESHOLD,
  );
  if (jsOnly.length)
    add(
      out,
      `flowlens|${flow('js-only-content')}`,
      {
        source: 'flowlens',
        rule_id: flow('js-only-content'),
        severity: 'moderate',
        help: 'Most of the page content exists only after JavaScript runs',
        description: `More than ${pct(JS_ONLY_THRESHOLD)} of the rendered text is missing from the raw HTML, so crawlers and answer engines that do not run JavaScript do not see it.`,
        help_url: DOCS.js,
        guidelines: [G.noJsContent],
      },
      jsOnly.map((s) => ({
        screen: s.id,
        selector: 'body',
        html: `${pct(s.seo?.js_only_ratio ?? 0)} of the rendered text is not in the raw HTML (raw status ${s.seo?.raw_status})`,
      })),
    );
  const overflowGroups = new Map<
    string,
    {
      component: string | null;
      screens: ScreenRecord[];
    }
  >();
  for (const s of withSeo) {
    const o = s.seo?.overflow;
    if (!s.seo?.mobile_overflow || !o) continue;
    const key = o.component
      ? `flowlens|${flow('mobile-overflow')}|${o.component}`
      : `flowlens|${flow('mobile-overflow')}|${s.id}|${o.selector}`;
    const group = overflowGroups.get(key) ?? { component: o.component, screens: [] };
    group.screens.push(s);
    overflowGroups.set(key, group);
  }
  for (const [key, group] of overflowGroups)
    add(
      out,
      key,
      {
        source: 'flowlens',
        rule_id: flow('mobile-overflow'),
        severity: 'serious',
        help: 'The page scrolls sideways on a 375px-wide phone screen',
        description:
          'At a 375x812 viewport the page is wider than the screen, so people have to scroll in two directions to read it.',
        help_url: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
        component: group.component,
        guidelines: [G.reflow],
      },
      group.screens.map((s) => ({
        screen: s.id,
        selector: s.seo?.overflow?.selector ?? '',
        html: s.seo?.overflow?.html ?? '',
        details: [`${s.seo?.overflow?.width ?? 0}px wide at a 375px viewport`],
      })),
    );
  const untitled = screens.filter((s) => !s.title.trim());
  if (untitled.length)
    add(
      out,
      `flowlens|${flow('title-missing')}`,
      {
        source: 'flowlens',
        rule_id: flow('title-missing'),
        severity: 'serious',
        help: 'The page has no title',
        description:
          'Search results and browser tabs show the title. A page without one cannot be told apart.',
        help_url: DOCS.title,
        guidelines: [G.pageTitle],
      },
      untitled.map((s) => ({ screen: s.id, selector: 'title' })),
    );
  const byTitle = new Map<string, ScreenRecord[]>();
  for (const s of screens) {
    const t = s.title.trim();
    if (t) byTitle.set(t, [...(byTitle.get(t) ?? []), s]);
  }
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue;
    add(
      out,
      `flowlens|${flow('title-duplicate')}|${title}`,
      {
        source: 'flowlens',
        rule_id: flow('title-duplicate'),
        severity: 'moderate',
        help: `${group.length} pages share the title "${title}"`,
        description:
          'Pages with the same title compete with each other in search results and are hard to tell apart.',
        help_url: DOCS.title,
        guidelines: [G.pageTitle],
      },
      group.map((s) => ({ screen: s.id, selector: 'title', html: `<title>${title}</title>` })),
    );
  }
  const noMeta = withSeo.filter((s) => !s.seo?.meta_description);
  if (noMeta.length)
    add(
      out,
      `flowlens|${flow('meta-description-missing')}`,
      {
        source: 'flowlens',
        rule_id: flow('meta-description-missing'),
        severity: 'moderate',
        help: 'The page has no meta description',
        description: 'Search engines show the meta description as the snippet under the title.',
        help_url: DOCS.snippet,
        guidelines: [G.metaDescription],
      },
      noMeta.map((s) => ({ screen: s.id, selector: 'meta[name="description"]' })),
    );
  const badH1 = withSeo.filter((s) => s.seo?.h1_count !== 1);
  if (badH1.length)
    add(
      out,
      `flowlens|${flow('h1-count')}`,
      {
        source: 'flowlens',
        rule_id: flow('h1-count'),
        severity: 'moderate',
        help: 'The page does not have exactly one h1 heading',
        description: 'One h1 tells people and search engines what the page is about.',
        help_url: '',
        guidelines: [G.oneH1],
      },
      badH1.map((s) => ({
        screen: s.id,
        selector: 'h1',
        html: `${s.seo?.h1_count ?? 0} h1 elements`,
      })),
    );
  const noProductLd = withSeo.filter(
    (s) => s.seo?.product_like && !s.seo.jsonld_types.includes('Product'),
  );
  if (noProductLd.length)
    add(
      out,
      `flowlens|${flow('jsonld-missing')}`,
      {
        source: 'flowlens',
        rule_id: flow('jsonld-missing'),
        severity: 'moderate',
        help: 'A product page has no Product structured data',
        description:
          'The page shows a price and a purchase button but no JSON-LD Product block, so engines cannot read the name, price and availability reliably.',
        help_url: 'https://schema.org/Product',
        guidelines: [G.structuredDataSeo, G.structuredDataAeo],
      },
      noProductLd.map((s) => ({
        screen: s.id,
        selector: 'script[type="application/ld+json"]',
        html: `JSON-LD types: ${s.seo?.jsonld_types.join(', ') || 'none'}`,
      })),
    );
  if (sitemap) sitemapGaps(out, screens, sitemap, robots);
  return out;
}
function sitemapGaps(
  out: RuleIssues,
  screens: ScreenRecord[],
  allEntries: SitemapEntry[],
  robots: RobotsRule[],
): void {
  const sitemap = allEntries.filter((e) => !e.path || isAllowed(e.path, robots));
  const screenOf = new Map<string, string>();
  for (const s of screens) for (const p of s.instance_paths) screenOf.set(p, s.id);
  const listed = new Set(allEntries.map((e) => e.path).filter((p): p is string => p !== null));
  const kinds = [
    {
      kind: 'redirect',
      help: 'The sitemap lists URLs that redirect',
      entries: sitemap.filter((e) => e.status >= 300 && e.status < 400),
    },
    {
      kind: 'error',
      help: 'The sitemap lists URLs that do not load',
      entries: sitemap.filter((e) => e.status === 0 || e.status >= 400),
    },
  ];
  for (const { kind, help, entries } of kinds) {
    if (entries.length === 0) continue;
    const lines = entries.map(
      (e) =>
        `${e.path ?? e.url} ${e.status || 'no response'}${e.location ? ` -> ${e.location}` : ''}`,
    );
    const perScreen = new Map<string, string[]>();
    entries.forEach((e, i) => {
      const screen =
        (e.path && screenOf.get(e.path)) ?? (e.location && screenOf.get(e.location)) ?? null;
      if (screen) perScreen.set(screen, [...(perScreen.get(screen) ?? []), lines[i] ?? '']);
    });
    add(
      out,
      `flowlens|flowlens/sitemap-gap|${kind}`,
      {
        source: 'flowlens',
        rule_id: 'flowlens/sitemap-gap',
        severity: 'moderate',
        help,
        description: `A plain request (no cookies) to these sitemap URLs does not return 200: ${lines.join('; ')}.`,
        help_url: 'https://www.sitemaps.org/protocol.html',
        guidelines: [G.sitemap],
      },
      [...perScreen].map(([screen, details]) => ({
        screen,
        selector: 'sitemap.xml',
        html: details.join('; '),
        node_count: details.length,
        details,
      })),
    );
  }
  const missing = screens.filter(
    (s) => isAllowed(s.id, robots) && !s.instance_paths.some((p) => listed.has(p)),
  );
  if (missing.length)
    add(
      out,
      'flowlens|flowlens/sitemap-gap|missing',
      {
        source: 'flowlens',
        rule_id: 'flowlens/sitemap-gap',
        severity: 'moderate',
        help: 'Crawled pages are missing from the sitemap',
        description: `The sitemap does not list: ${missing.map((s) => s.id).join(', ')}.`,
        help_url: 'https://www.sitemaps.org/protocol.html',
        guidelines: [G.sitemap],
      },
      missing.map((s) => ({
        screen: s.id,
        selector: 'sitemap.xml',
        details: [`${s.id} not listed`],
      })),
    );
}
export function lighthouseIssues(results: Map<string, LighthouseResult>): RuleIssues {
  const out: RuleIssues = { issues: [], occurrences: [] };
  const byAudit = new Map<
    string,
    {
      audit: LighthouseResult['failed'][number];
      screens: Occurrence[];
    }
  >();
  for (const [screen, r] of results) {
    for (const a of r.failed) {
      const entry = byAudit.get(a.id) ?? { audit: a, screens: [] };
      entry.screens.push({ screen, selector: '', html: a.displayValue || `score ${a.score}` });
      byAudit.set(a.id, entry);
    }
  }
  for (const [id, { audit, screens }] of [...byAudit].sort(([a], [b]) => a.localeCompare(b))) {
    const url = /\((https?:\/\/[^)\s]+)\)/.exec(audit.description)?.[1] ?? '';
    add(
      out,
      `lighthouse|${id}`,
      {
        source: 'lighthouse',
        rule_id: id,
        severity: audit.category === 'seo' ? 'moderate' : 'minor',
        help: audit.title,
        description: `${audit.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 500)} Sampled: Lighthouse audited ${results.size} screen${results.size === 1 ? '' : 's'}, one per page structure, so it is linked only to audited screens; other screens with the same structure likely have it too.`,
        help_url: url,
        guidelines: [
          { id: `lighthouse:${id}`, name: audit.title, source: 'Lighthouse', lens: 'SEO' },
        ],
      },
      screens,
    );
  }
  return out;
}
