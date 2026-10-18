import { z } from 'zod';
import type { ReadOnlyGraph } from '../graph/db.js';
import { notFound } from '../http/errors.js';
import { jsOnlyPredicate } from '../lens/jsOnly.js';
import { defineTool, edgeId } from './types.js';
export const LENSES = ['UX', 'SEO', 'AEO'] as const;
async function startScreen(g: ReadOnlyGraph): Promise<string> {
  const rows = await g.read<{
    id: string;
  }>(
    "MATCH (s:Screen) WHERE s.discovered_via = 'start' RETURN s.id AS id ORDER BY s.depth LIMIT 1",
  );
  return rows[0]?.id ?? '/';
}
async function reachable(g: ReadOnlyGraph, start: string): Promise<Set<string>> {
  const rows = await g.read<{
    from: string;
    to: string;
  }>('MATCH (a:Screen)-[:NAVIGATES_TO]->(b:Screen) RETURN a.id AS from, b.id AS to');
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.from, [...(out.get(r.from) ?? []), r.to]);
  const seen = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++)
    for (const next of out.get(queue[i] as string) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  return seen;
}
export const crawlDepth = defineTool({
  name: 'crawl_depth',
  title: 'Link depth from the start screen',
  description:
    'How many link clicks (HREF_TO, plain <a href> links only, what a crawler without JavaScript follows) each screen is from the start screen, next to its click depth over every link and button. Shallow pages are easier for search engines to find; screens with no link depth cannot be reached by links at all.',
  input: {},
  async run(g) {
    const start = await startScreen(g);
    const rows = await g.read<{
      id: string;
      title: string;
      link_depth: number | null;
      click_depth: number | null;
    }>(`MATCH (s:Screen)
       RETURN s.id AS id, s.title AS title, s.link_depth AS link_depth, s.depth AS click_depth
       ORDER BY id`);
    const linked = rows.filter((r) => r.link_depth !== null);
    const max = linked.reduce((m, r) => Math.max(m, r.link_depth ?? 0), 0);
    const distribution = Array.from({ length: max + 1 }, (_, depth) => ({
      depth,
      count: linked.filter((r) => r.link_depth === depth).length,
    }));
    const deepest = linked.filter((r) => r.link_depth === max).map((r) => r.id);
    return {
      result: {
        start,
        max_link_depth: linked.length ? max : null,
        distribution,
        unreachable_by_links: rows.filter((r) => r.link_depth === null).length,
        screens: [...rows].sort(
          (a, b) =>
            (a.link_depth ?? Number.MAX_SAFE_INTEGER) - (b.link_depth ?? Number.MAX_SAFE_INTEGER) ||
            a.id.localeCompare(b.id),
        ),
      },
      screens: deepest,
      edges: [],
    };
  },
});
export const unreachableByLinks = defineTool({
  name: 'unreachable_by_links',
  title: 'Screens only reachable through JavaScript',
  description:
    'Screens a user can reach from the start screen by clicking (NAVIGATES_TO) but a crawler cannot reach by following links (no HREF_TO path, link_depth null): they are only behind buttons or scripts. Also lists screens that are not reachable at all from the start screen (orphans found through --seed), which have no link depth either. robots_disallowed marks screens the site does not want indexed anyway.',
  input: {},
  async run(g) {
    const start = await startScreen(g);
    const byClicks = await reachable(g, start);
    const rows = await g.read<{
      id: string;
      title: string;
      discovered_via: string | null;
      robots_disallowed: boolean;
      state_required: boolean;
    }>(`MATCH (s:Screen) WHERE s.link_depth IS NULL
       RETURN s.id AS id, s.title AS title, s.discovered_via AS discovered_via,
              s.robots_disallowed = true AS robots_disallowed,
              s.state_required = true AS state_required
       ORDER BY id`);
    const viaJs = rows.filter((r) => byClicks.has(r.id));
    const entries = await g.read<{
      from: string;
      to: string;
      action: string;
    }>(`MATCH (a:Screen)-[e:NAVIGATES_TO]->(b:Screen)
       WHERE b.link_depth IS NULL AND e.via = 'js'
       RETURN a.id AS from, b.id AS to, e.action AS action ORDER BY to, from`);
    const screens = viaJs.map((r) => ({
      ...r,
      reached_by: entries
        .filter((e) => e.to === r.id)
        .map((e) => ({ from: e.from, action: e.action })),
    }));
    return {
      result: {
        start,
        count: screens.length,
        screens,
        not_reachable_at_all: rows.filter((r) => !byClicks.has(r.id)),
      },
      screens: rows.map((r) => r.id),
      edges: [
        ...new Set(entries.filter((e) => byClicks.has(e.to)).map((e) => edgeId(e.from, e.to))),
      ],
    };
  },
});
export const jsOnlyContent = defineTool({
  name: 'js_only_content',
  title: 'Content that exists only after JavaScript',
  description:
    'Screens whose rendered text is mostly missing from the raw HTML a plain HTTP request returns (js_only_ratio = share of rendered words not in the raw HTML). Crawlers and answer engines that do not run JavaScript miss that content. raw_status shows when the raw request redirects (for example a page that needs a cart or a session). counted marks the indexable content pages (raw 200, at least 300 characters, allowed by robots.txt) that the js-only-content rule and the SEO score count.',
  input: {
    min_ratio: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe('Lowest js_only_ratio to include, 0 to 1 (default 0.5)'),
  },
  async run(g, { min_ratio }) {
    const rows = await g.read<{
      id: string;
      title: string;
      js_only_ratio: number;
      raw_status: number | null;
      raw_text_length: number | null;
      rendered_text_length: number | null;
      robots_disallowed: boolean;
      issue_key: string | null;
      counted: boolean;
    }>(
      `MATCH (s:Screen) WHERE s.js_only_ratio IS NOT NULL AND s.js_only_ratio >= $min
       OPTIONAL MATCH (i:Issue {rule_id: 'flowlens/js-only-content'})-[:FOUND_ON]->(s)
       RETURN s.id AS id, s.title AS title, s.js_only_ratio AS js_only_ratio,
              s.raw_status AS raw_status, s.raw_text_length AS raw_text_length,
              s.rendered_text_length AS rendered_text_length,
              s.robots_disallowed = true AS robots_disallowed, i.key AS issue_key,
              (${jsOnlyPredicate('s')}) AS counted
       ORDER BY js_only_ratio DESC, id`,
      { min: min_ratio },
    );
    return {
      result: { min_ratio, count: rows.length, screens: rows },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
export const mobileOverflowScreens = defineTool({
  name: 'mobile_overflow_screens',
  title: 'Screens wider than a phone',
  description:
    'Screens that scroll sideways at a 375x812 viewport (WCAG 1.4.10 Reflow), with the element that sticks out and its design system component when it has one.',
  input: {},
  async run(g) {
    const rows = await g.read<{
      id: string;
      title: string;
      selector: string | null;
      html: string | null;
      details: string[] | null;
      component: string | null;
      has_table: boolean;
      issue_key: string | null;
    }>(`MATCH (s:Screen) WHERE s.mobile_overflow = true
       OPTIONAL MATCH (i:Issue {rule_id: 'flowlens/mobile-overflow'})-[f:FOUND_ON]->(s)
       OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
       RETURN s.id AS id, s.title AS title, f.selector AS selector, f.html AS html,
              f.details AS details, d.name AS component, s.has_table = true AS has_table,
              i.key AS issue_key
       ORDER BY id`);
    return {
      result: {
        count: rows.length,
        screens: rows.map((r) => ({
          id: r.id,
          title: r.title,
          component: r.component,
          has_table: r.has_table,
          issue_key: r.issue_key,
          selector: r.selector,
          width: r.details?.[0] ?? null,
          html: r.html,
        })),
      },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
export const sitemapGaps = defineTool({
  name: 'sitemap_gaps',
  title: 'Sitemap gaps',
  description:
    'Where the sitemap and the crawl disagree: sitemap URLs that redirect or do not load for a plain request (no cookies), and crawled screens the sitemap does not list. Each gap names the URL, its status and where it redirects.',
  input: {},
  async run(g) {
    const issues = await g.read<{
      key: string;
      help: string;
      description: string;
      occurrences: {
        screen: string;
        details: string[] | null;
      }[];
    }>(`MATCH (i:Issue {rule_id: 'flowlens/sitemap-gap'})
       OPTIONAL MATCH (i)-[f:FOUND_ON]->(s:Screen)
       RETURN i.key AS key, i.help AS help, i.description AS description,
              collect({screen: s.id, details: f.details}) AS occurrences
       ORDER BY key`);
    const notListed = await g.read<{
      id: string;
    }>('MATCH (s:Screen) WHERE s.in_sitemap = false RETURN s.id AS id ORDER BY id');
    const gaps = issues.map((i) => ({
      kind: i.key.split('|').pop() ?? '',
      help: i.help,
      description: i.description,
      screens: i.occurrences
        .filter((o) => o.screen)
        .map((o) => ({ screen: o.screen, urls: o.details ?? [] }))
        .sort((a, b) => a.screen.localeCompare(b.screen)),
    }));
    const screens = [...new Set(gaps.flatMap((x) => x.screens.map((s) => s.screen)))].sort();
    return {
      result: {
        count: gaps.reduce((n, x) => n + x.screens.reduce((m, s) => m + s.urls.length, 0), 0),
        gaps,
        not_in_sitemap: notListed.map((r) => r.id),
      },
      screens,
      edges: [],
    };
  },
});
export const lensSummary = defineTool({
  name: 'lens_summary',
  title: 'Issues by lens',
  description:
    'Issue counts per lens (UX, SEO, AEO) and severity. An issue counts once in every lens of the guidelines it violates. Also lists the guideline conflicts in the graph (CONFLICTS_WITH: an SEO or AEO guideline that pulls against a UX one) with how many issues each side has.',
  input: {},
  async run(g) {
    const rows = await g.read<{
      lens: string;
      severity: string;
      n: number;
      screens: string[];
    }>(`MATCH (i:Issue)-[:VIOLATES]->(gl:Guideline)
       WITH DISTINCT i, gl.lens AS lens
       OPTIONAL MATCH (i)-[:FOUND_ON]->(s:Screen)
       RETURN lens, i.severity AS severity, count(DISTINCT i) AS n, collect(DISTINCT s.id) AS screens`);
    const lenses = LENSES.map((lens) => {
      const mine = rows.filter((r) => r.lens === lens);
      const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 } as Record<
        string,
        number
      >;
      for (const r of mine) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
      return {
        lens,
        total: mine.reduce((n, r) => n + r.n, 0),
        bySeverity,
        screens: new Set(mine.flatMap((r) => r.screens)).size,
      };
    });
    const conflicts = await g.read<{
      from: {
        id: string;
        name: string;
        lens: string;
      };
      to: {
        id: string;
        name: string;
        lens: string;
      };
      reason: string;
      from_issues: number;
      to_issues: number;
    }>(`MATCH (a:Guideline)-[c:CONFLICTS_WITH]->(b:Guideline)
       OPTIONAL MATCH (ia:Issue)-[:VIOLATES]->(a)
       WITH a, b, c, count(DISTINCT ia) AS from_issues
       OPTIONAL MATCH (ib:Issue)-[:VIOLATES]->(b)
       RETURN {id: a.id, name: a.name, lens: a.lens} AS from, {id: b.id, name: b.name, lens: b.lens} AS to,
              c.reason AS reason, from_issues, count(DISTINCT ib) AS to_issues
       ORDER BY from.id`);
    return { result: { lenses, conflicts }, screens: [], edges: [] };
  },
});
export const checkResults = defineTool({
  name: 'check_results',
  title: 'Page check results',
  description:
    'Every check result (Issue) still found on a screen: rule, source (axe, flowlens, lighthouse), severity, help text, lenses, component and the screens it is on. Optional lens filter. Use it to see check results no other tool covers, such as Lighthouse audits.',
  input: {
    lens: z.enum(LENSES).optional().describe('UX, SEO or AEO. Leave out for every lens.'),
  },
  async run(g, args) {
    const rows = await g.read<{
      id: string;
      key: string;
      rule_id: string;
      source: string;
      severity: string;
      help: string;
      help_url: string | null;
      lenses: string[];
      component: string | null;
      screens: string[];
    }>(
      `MATCH (i:Issue)-[:FOUND_ON]->(s:Screen)
       WITH i, collect(DISTINCT s.id) AS screens
       OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
       WITH i, screens, collect(DISTINCT gl.lens) AS lenses
       OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
       RETURN i.id AS id, i.key AS key, i.rule_id AS rule_id, i.source AS source,
              i.severity AS severity, i.help AS help, i.help_url AS help_url, lenses,
              d.name AS component, screens
       ORDER BY key`,
    );
    const issues = rows
      .map((r) => ({ ...r, lenses: [...r.lenses].sort(), screens: [...r.screens].sort() }))
      .filter((r) => !args.lens || r.lenses.includes(args.lens));
    return {
      result: { count: issues.length, issues },
      screens: [...new Set(issues.flatMap((i) => i.screens))].sort(),
      edges: [],
    };
  },
});
export const screenLinks = defineTool({
  name: 'screen_links',
  title: 'Links on one screen',
  description:
    'Every link and button that leaves one screen (NAVIGATES_TO): label, target, via (link or js), whether it is a shared header/footer link, and whether the target is a product page (it carries Product JSON-LD). link_count counts plain links. Use it to judge how many choices a page offers.',
  input: {
    screen: z
      .string()
      .regex(/^\//, 'screen ids are paths that start with "/"')
      .max(512)
      .optional()
      .describe('Screen id, e.g. "/". Leave out for the start screen.'),
  },
  async run(g, args) {
    const screen = args.screen ?? (await startScreen(g));
    const exists = await g.read<{
      n: number;
    }>('MATCH (s:Screen {id: $id}) RETURN count(s) AS n', {
      id: screen,
    });
    if ((exists[0]?.n ?? 0) === 0) throw notFound(`Unknown screen: ${screen}`);
    const rows = await g.read<{
      to: string;
      action: string;
      via: string;
      shared: boolean;
      product: boolean;
    }>(
      `MATCH (:Screen {id: $id})-[e:NAVIGATES_TO]->(t:Screen)
       RETURN t.id AS to, e.action AS action, e.via AS via, e.shared = true AS shared,
              'Product' IN coalesce(t.jsonld_types, []) AS product
       ORDER BY to, action`,
      { id: screen },
    );
    return {
      result: {
        screen,
        link_count: rows.filter((r) => r.via === 'link').length,
        links: rows,
      },
      screens: [screen, ...new Set(rows.map((r) => r.to))],
      edges: [...new Set(rows.map((r) => edgeId(screen, r.to)))],
    };
  },
});
