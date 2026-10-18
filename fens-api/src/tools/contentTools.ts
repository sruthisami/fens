import { z } from 'zod';
import { menuCategories, neighbours } from '../content/similarity.js';
import type { ReadOnlyGraph } from '../graph/db.js';
import { notFound } from '../http/errors.js';
import { defineTool, edgeSet, REL } from './types.js';
const screenArg = z
  .string()
  .regex(/^\//, 'screen ids start with "/"')
  .max(512)
  .describe('Screen id, e.g. "/accessories"');
export const similarScreens = defineTool({
  name: 'similar_screens',
  title: 'Screens with similar content',
  description:
    'The k screens whose content (title plus visible text) is closest to one screen: Gemini embeddings and the FalkorDB vector index when the graph has them (npm run embed), otherwise word overlap. method says which was used.',
  input: { screen: screenArg, k: z.coerce.number().int().min(1).max(20).default(5) },
  async run(g, { screen, k }) {
    const found = await g.read<{
      n: number;
    }>('MATCH (s:Screen {id: $id}) RETURN count(s) AS n', {
      id: screen,
    });
    if (!found[0]?.n) throw notFound(`Unknown screen: ${screen}`);
    const r = await neighbours(g, screen, k);
    return {
      result: { screen, k, ...r },
      screens: [screen, ...r.neighbours.map((n) => n.id)],
      edges: [],
    };
  },
});
async function primaryCategories(g: ReadOnlyGraph, of: Map<string, string[]>) {
  const primary = new Map<string, string>();
  for (const [screen, cats] of of) {
    if (cats.length === 1) primary.set(screen, cats[0] as string);
    else {
      const near = (await neighbours(g, screen, 50)).neighbours;
      const best = [...cats].sort(
        (a, b) =>
          (near.find((n) => n.id === b)?.similarity ?? 0) -
            (near.find((n) => n.id === a)?.similarity ?? 0) || a.localeCompare(b),
      )[0];
      if (best) primary.set(screen, best);
    }
  }
  return primary;
}
export const IA_NEIGHBOURS = 4;
export const iaMismatch = defineTool({
  name: 'ia_mismatch',
  title: 'Information architecture mismatches',
  description:
    'For each screen in a menu category (a page in the shared menu with flow edges to 2+ screens, and the screens it lists), compares its category with the categories of its 4 nearest content neighbours (similar_screens). Flags screens whose neighbours mostly (more than half) belong to a different category: content filed in the wrong place.',
  input: {},
  async run(g) {
    const { categories, of } = await menuCategories(g);
    const primary = await primaryCategories(g, of);
    const screens: {
      id: string;
      category: string;
      neighbours: {
        id: string;
        category: string | null;
        similarity: number;
      }[];
      other: number;
      flagged: boolean;
    }[] = [];
    let method: 'embedding' | 'lexical' = 'lexical';
    for (const [id, category] of [...primary].sort(([a], [b]) => a.localeCompare(b))) {
      const near = await neighbours(g, id, 20);
      method = near.method;
      const withCategory = near.neighbours
        .filter((n) => primary.has(n.id))
        .slice(0, IA_NEIGHBOURS)
        .map((n) => ({ ...n, category: primary.get(n.id) ?? null }));
      const other = withCategory.filter((n) => n.category !== category).length;
      screens.push({
        id,
        category,
        neighbours: withCategory,
        other,
        flagged: other * 2 > withCategory.length,
      });
    }
    const flagged = screens.filter((s) => s.flagged);
    return {
      result: { method, categories, flagged: flagged.map((s) => s.id), screens },
      screens: flagged.flatMap((s) => [s.id, ...s.neighbours.map((n) => n.id)]),
      edges: [],
    };
  },
});
export const STABLE_RUNS = 10;
export const STABLE_SHARE = 0.7;
export const stableCommunities = defineTool({
  name: 'stable_communities',
  title: 'Stable screen communities',
  description:
    'Label propagation is unstable on small graphs, so it runs 10 times and groups screens that land in the same community in at least 70% of the runs. Groups are lettered A, B, C by size. Screens that never settle stay in a group of their own.',
  input: { edge_set: edgeSet.default('flow') },
  async run(g, { edge_set }) {
    const ids = (
      await g.read<{
        id: string;
      }>('MATCH (s:Screen) RETURN s.id AS id ORDER BY id')
    ).map((r) => r.id);
    const together = new Map<string, number>();
    const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
    for (let run = 0; run < STABLE_RUNS; run++) {
      const rows = await g.read<{
        id: string;
        c: number;
      }>(`CALL algo.labelPropagation({nodeLabels: ['Screen'], relationshipTypes: ['${REL[edge_set]}'], maxIterations: 20})
         YIELD node, communityId RETURN node.id AS id, communityId AS c`);
      const byC = new Map<number, string[]>();
      for (const r of rows) byC.set(r.c, [...(byC.get(r.c) ?? []), r.id]);
      for (const members of byC.values())
        for (let i = 0; i < members.length; i++)
          for (let j = i + 1; j < members.length; j++) {
            const key = pair(members[i] as string, members[j] as string);
            together.set(key, (together.get(key) ?? 0) + 1);
          }
    }
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x) as string));
    for (const [key, n] of together)
      if (n / STABLE_RUNS >= STABLE_SHARE) {
        const [a, b] = key.split('\u0000') as [string, string];
        parent.set(find(a), find(b));
      }
    const groups = new Map<string, string[]>();
    for (const id of ids) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
    const sorted = [...groups.values()]
      .sort((a, b) => b.length - a.length || (a[0] ?? '').localeCompare(b[0] ?? ''))
      .map((screens, i) => ({
        label: i < 26 ? String.fromCharCode(65 + i) : `Z${i}`,
        size: screens.length,
        screens: screens.sort(),
      }));
    return {
      result: {
        edge_set,
        runs: STABLE_RUNS,
        threshold: STABLE_SHARE,
        count: sorted.length,
        groups: sorted,
      },
      screens: ids,
      edges: [],
    };
  },
});
