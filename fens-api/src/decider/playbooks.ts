import type { ReadOnlyGraph } from '../graph/db.js';
import { pagerank } from '../tools/graphTools.js';
import type { ChangeType } from '../agent/proposals.js';
import type { Change } from './simulate.js';
export interface Playbook {
  id: string;
  name: string;
  pattern: string;
  change_type: ChangeType;
  description: string;
}
export const TABLES = 'aeo:extractable-tables -> WCAG 1.4.10';
export const ANSWERS = 'aeo:content-without-js -> ux:progressive-disclosure';
export const DEPTH = 'seo:shallow-click-depth -> ux:limit-choices';
export const PLAYBOOKS: Playbook[] = [
  {
    id: 'pb-table-responsive',
    name: 'Responsive table',
    pattern: TABLES,
    change_type: 'table_responsive',
    description:
      'Keep the semantic table (engines extract it) and stack it as cards on phones with CSS (no horizontal scroll).',
  },
  {
    id: 'pb-content-details',
    name: 'Answers in the HTML with details/summary',
    pattern: ANSWERS,
    change_type: 'content_in_html',
    description:
      'Keep the accordion for people, with every answer in the HTML inside details/summary so engines read it without JavaScript.',
  },
  {
    id: 'pb-declutter-depth-cap',
    name: 'Declutter with a depth cap',
    pattern: DEPTH,
    change_type: 'remove_links',
    description:
      'Remove links from a busy page, but keep the top 2 products of each category linked and never remove a link a page cannot be reached without.',
  },
];
export const CHANGE_PATTERN: Record<ChangeType, string> = {
  table_to_cards: TABLES,
  table_responsive: TABLES,
  content_in_html: ANSWERS,
  remove_links: DEPTH,
  add_link: DEPTH,
};
export async function playbooksFor(g: ReadOnlyGraph, type: ChangeType): Promise<Playbook[]> {
  const pattern = CHANGE_PATTERN[type];
  const [from, to] = pattern.split(' -> ');
  const pair = await g.read<{
    n: number;
  }>(
    'MATCH (:Guideline {id: $from})-[c:CONFLICTS_WITH]->(:Guideline {id: $to}) RETURN count(c) AS n',
    { from, to },
  );
  if ((pair[0]?.n ?? 0) === 0) return [];
  return PLAYBOOKS.filter((p) => p.pattern === pattern);
}
async function depthCapped(g: ReadOnlyGraph, from: string, to: string[]): Promise<string[]> {
  const rows = await g.read<{
    c: string;
    products: string[];
  }>(
    `MATCH (c:Screen)-[e:NAVIGATES_TO]->(p:Screen)
     WHERE e.via = 'link' AND c.id <> $from AND 'Product' IN coalesce(p.jsonld_types, [])
     RETURN c.id AS c, collect(DISTINCT p.id) AS products`,
    { from },
  );
  const groups = rows.filter((r) => r.products.length >= 2);
  const ranking = (await pagerank.run(g, { edge_set: 'flow', top: 50 }, { graph: '' })).result as {
    ranking: {
      id: string;
      score: number;
    }[];
  };
  const score = new Map(ranking.ranking.map((r) => [r.id, r.score]));
  const top2 = (products: string[]) =>
    [...products]
      .sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || a.localeCompare(b))
      .slice(0, 2);
  return to.filter((t) => {
    const mine = groups.filter((gr) => gr.products.includes(t));
    if (mine.length === 0) return false;
    return !mine.some((gr) => top2(gr.products).includes(t));
  });
}
export async function playbookChange(
  g: ReadOnlyGraph,
  playbook: Playbook,
  change: Change,
): Promise<Change | null> {
  const p = change.params as {
    screen?: string;
    component?: string;
    from?: string;
    to?: string[];
  };
  let next: Change | null = null;
  if (playbook.id === 'pb-table-responsive' && p.screen)
    next = {
      type: 'table_responsive',
      params: { screen: p.screen, ...(p.component ? { component: p.component } : {}) },
    };
  if (playbook.id === 'pb-content-details' && p.screen)
    next = {
      type: 'content_in_html',
      params: { screen: p.screen, ...(p.component ? { component: p.component } : {}) },
    };
  if (
    playbook.id === 'pb-declutter-depth-cap' &&
    change.type === 'remove_links' &&
    p.from &&
    Array.isArray(p.to)
  ) {
    const keep = await depthCapped(g, p.from, p.to);
    next = keep.length ? { type: 'remove_links', params: { from: p.from, to: keep } } : null;
  }
  if (next && JSON.stringify(next) === JSON.stringify({ type: change.type, params: change.params }))
    return null;
  return next;
}
