import type { ProposalInput } from './proposals.js';
import type { FindingInput } from './types.js';
type Call = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
type Draft = Omit<ProposalInput, 'agent'>;
export const MAX_HOME_LINKS = 12;
export const MIN_PRODUCT_LINKS = 3;
const pageName = (title: string, id: string) => title.split(' - ').pop()?.trim() || id;
export async function uxProposals(call: Call): Promise<{
  findings: FindingInput[];
  proposals: Draft[];
}> {
  const findings: FindingInput[] = [];
  const proposals: Draft[] = [];
  const overflow = (await call('mobile_overflow_screens')) as {
    result: {
      screens: {
        id: string;
        component: string | null;
        has_table: boolean;
        issue_key: string | null;
        width: string | null;
      }[];
    };
  };
  for (const s of overflow.result.screens.filter((x) => x.has_table)) {
    proposals.push({
      title: `Replace the wide table on ${s.id} with cards`,
      change: {
        type: 'table_to_cards',
        params: { screen: s.id, ...(s.component ? { component: s.component } : {}) },
      },
      rationale: `${s.id} scrolls sideways on a 375px phone (${s.width ?? 'wider than the screen'}) because of a data table${s.component ? ` (${s.component})` : ''} (WCAG 1.4.10 Reflow). Cards stack on a phone, so the page no longer scrolls in two directions. Search and answer engines lose the table structure they extract (the AEO guideline "Extractable data tables" conflicts with Reflow).`,
      issue_keys: s.issue_key ? [s.issue_key] : [],
      expected: { ux: 'improves', seo: 'worsens' },
    });
  }
  const home = (await call('screen_links')) as {
    result: {
      screen: string;
      link_count: number;
      links: {
        to: string;
        via: string;
        shared: boolean;
        product: boolean;
      }[];
    };
  };
  const { screen, link_count: count } = home.result;
  if (count > MAX_HOME_LINKS) {
    findings.push({
      title: `${screen} offers ${count} links at once, more than ${MAX_HOME_LINKS}`,
      severity: 'low',
      category: 'structure',
      explanation: `${screen} has ${count} plain links (screen_links), so people face many choices at once and the main paths compete with every product link.`,
      evidence: [{ tool: 'screen_links', args: { screen }, screens: [screen], path: [] }],
      recommendation: `Keep the links people need most on ${screen} and move the rest one level down, without hiding pages from crawlers.`,
      target: { type: 'screen', id: screen },
      rule_id: 'choice-overload',
    });
    const products = [
      ...new Set(home.result.links.filter((l) => l.via === 'link' && l.product).map((l) => l.to)),
    ];
    const rank = (await call('pagerank', { edge_set: 'flow', top: 50 })) as {
      result: {
        ranking: {
          id: string;
          score: number;
        }[];
      };
    };
    const score = new Map(rank.result.ranking.map((r) => [r.id, r.score]));
    const lowestFirst = [...products].sort(
      (a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0) || b.localeCompare(a),
    );
    const removable = Math.max(0, products.length - MIN_PRODUCT_LINKS);
    const remove = lowestFirst.slice(0, Math.min(removable, count - MAX_HOME_LINKS));
    if (remove.length)
      proposals.push({
        title: `Trim ${screen} from ${count} links: drop the ${remove.length} lowest-ranked product links`,
        change: { type: 'remove_links', params: { from: screen, to: remove } },
        rationale: `${screen} offers ${count} plain links, more than ${MAX_HOME_LINKS}, so people face many choices at once. The product links with the lowest PageRank on the flow graph are ${remove.join(', ')}. Removing them leaves ${count - remove.length} links. Those products then move one click deeper for crawlers (the SEO guideline "Shallow click depth" conflicts with "Limit the choices on a page").`,
        issue_keys: [],
        expected: { ux: 'improves', seo: 'worsens' },
      });
  }
  return { findings, proposals };
}
export async function seoRules(call: Call): Promise<{
  findings: FindingInput[];
  proposals: Draft[];
}> {
  const findings: FindingInput[] = [];
  const proposals: Draft[] = [];
  const js = (await call('js_only_content')) as {
    result: {
      screens: {
        id: string;
        title: string;
        js_only_ratio: number;
        raw_status: number | null;
        issue_key: string | null;
      }[];
    };
  };
  for (const s of js.result.screens.filter((x) => x.issue_key)) {
    const pct = Math.round(s.js_only_ratio * 100);
    findings.push({
      title: `${s.id}: ${pct}% of the content exists only after JavaScript`,
      severity: 'medium',
      category: 'aeo',
      explanation: `A plain request to ${s.id} (${s.title}) returns ${s.raw_status} with almost none of the text a visitor sees: ${pct}% of the rendered words are not in the raw HTML. Crawlers and answer engines that do not run JavaScript cannot read or quote it.`,
      evidence: [{ tool: 'js_only_content', args: {}, screens: [s.id], path: [] }],
      recommendation: `Render the content of ${s.id} into the HTML (server-side or prerendered), and keep any interaction on top of it.`,
      target: { type: 'screen', id: s.id },
      rule_id: 'flowlens/js-only-content',
    });
    proposals.push({
      title: `Put the answers on ${s.id} in the HTML`,
      change: { type: 'content_in_html', params: { screen: s.id } },
      rationale: `${pct}% of the text on ${s.id} is fetched and inserted by JavaScript (js_only_content). With the answers in the HTML as details/summary, engines read them and people keep the collapsed accordion (the AEO guideline "Key content and answers available without JavaScript" conflicts with "Progressive disclosure" only when the answers are missing from the HTML).`,
      issue_keys: s.issue_key ? [s.issue_key] : [],
      expected: { ux: 'neutral', seo: 'improves' },
    });
  }
  const unreachable = (await call('unreachable_by_links')) as {
    result: {
      start: string;
      screens: {
        id: string;
        title: string;
        robots_disallowed: boolean;
        state_required: boolean;
        reached_by: {
          from: string;
          action: string;
        }[];
      }[];
      not_reachable_at_all: {
        id: string;
        title: string;
      }[];
    };
  };
  const start = unreachable.result.start;
  for (const s of unreachable.result.not_reachable_at_all) {
    findings.push({
      title: `${s.id} cannot be reached by links at all`,
      severity: 'medium',
      category: 'seo',
      explanation: `No link or button path leads from ${start} to ${s.id} (${s.title}); the crawler only found it as a seed. Search engines that follow links never discover it, and people cannot find it either.`,
      evidence: [{ tool: 'unreachable_by_links', args: {}, screens: [s.id], path: [] }],
      recommendation: `Link to ${s.id} with a plain <a href> from ${start} or the shared header.`,
      target: { type: 'screen', id: s.id },
    });
    proposals.push({
      title: `Link to ${s.id} from ${start}`,
      change: {
        type: 'add_link',
        params: { from: start, to: s.id, label: pageName(s.title, s.id), via: 'link' },
      },
      rationale: `${s.id} is an orphan: nothing links to it (unreachable_by_links, not reachable at all). A plain link from ${start} puts it one click from the start for people and crawlers.`,
      issue_keys: [],
      expected: { ux: 'improves', seo: 'improves' },
    });
  }
  for (const s of unreachable.result.screens) {
    if (s.robots_disallowed || s.state_required) continue;
    const via = s.reached_by[0];
    if (!via) continue;
    findings.push({
      title: `${s.id} is only reachable through a button`,
      severity: 'low',
      category: 'seo',
      explanation: `People reach ${s.id} through "${via.action}" on ${via.from}, a JavaScript click, but no plain link leads there, so crawlers that follow links never find it.`,
      evidence: [{ tool: 'unreachable_by_links', args: {}, screens: [via.from, s.id], path: [] }],
      recommendation: `Make "${via.action}" on ${via.from} a real link (<a href="${s.id}">).`,
      target: { type: 'screen', id: s.id },
    });
    proposals.push({
      title: `Make "${via.action}" on ${via.from} a link to ${s.id}`,
      change: {
        type: 'add_link',
        params: { from: via.from, to: s.id, label: via.action, via: 'link' },
      },
      rationale: `${s.id} is reachable by clicking "${via.action}" on ${via.from} but has no link depth. A plain link makes it crawlable without changing what people click.`,
      issue_keys: [],
      expected: { ux: 'neutral', seo: 'improves' },
    });
  }
  const gaps = (await call('sitemap_gaps')) as {
    result: {
      gaps: {
        kind: string;
        help: string;
        screens: {
          screen: string;
          urls: string[];
        }[];
      }[];
    };
  };
  for (const gap of gaps.result.gaps) {
    const screens = gap.screens.map((s) => s.screen);
    if (!screens.length) continue;
    findings.push({
      title: gap.help,
      severity: 'low',
      category: 'seo',
      explanation: `${gap.help}: ${gap.screens.flatMap((s) => s.urls).join('; ')}.`,
      evidence: [{ tool: 'sitemap_gaps', args: {}, screens, path: [] }],
      recommendation:
        'List only URLs that load with status 200 and that robots.txt allows, and every such page.',
      target: { type: 'screen', id: screens[0] as string },
      rule_id: `flowlens/sitemap-gap|${gap.kind}`,
    });
  }
  return { findings, proposals };
}
