import { randomBytes } from 'node:crypto';
import { copyToSim, deleteSim, openGraph, openSimWriter, SIM_PREFIX } from '../graph/db.js';
import { currentContext } from '../tenancy/context.js';
import type { ChangeType } from '../agent/proposals.js';
import { lensScores, tableScreens, type LensScores } from './scores.js';
export interface Change {
  type: ChangeType;
  params: Record<string, unknown>;
}
export interface PartDelta {
  lens: 'ux' | 'seo';
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
}
export interface Simulation {
  change: Change;
  before: LensScores;
  after: LensScores;
  delta: {
    ux: number;
    seo: number;
  };
  parts: PartDelta[];
  link_depth: {
    id: string;
    before: number | null;
    after: number | null;
  }[];
}
type Writer = Awaited<ReturnType<typeof openSimWriter>>;
async function relinkDepths(sim: string, w: Writer): Promise<void> {
  const g = await openGraph(sim);
  const start =
    (
      await g.read<{
        id: string;
      }>(
        "MATCH (s:Screen) WHERE s.discovered_via = 'start' RETURN s.id AS id ORDER BY s.depth LIMIT 1",
      )
    )[0]?.id ?? '/';
  const edges = await g.read<{
    from: string;
    to: string;
  }>('MATCH (a:Screen)-[:HREF_TO]->(b:Screen) RETURN a.id AS from, b.id AS to');
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const depth = new Map([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++)
    for (const next of out.get(queue[i] as string) ?? [])
      if (!depth.has(next)) {
        depth.set(next, (depth.get(queue[i] as string) ?? 0) + 1);
        queue.push(next);
      }
  const ids = (
    await g.read<{
      id: string;
    }>('MATCH (s:Screen) RETURN s.id AS id')
  ).map((r) => r.id);
  await w.write('UNWIND $rows AS r MATCH (s:Screen {id: r.id}) SET s.link_depth = r.depth', {
    rows: ids.map((id) => ({ id, depth: depth.get(id) ?? null })),
  });
}
const dropIssue = (w: Writer, rule: string, screen: string) =>
  w.write('MATCH (i:Issue {rule_id: $rule})-[f:FOUND_ON]->(:Screen {id: $screen}) DELETE f', {
    rule,
    screen,
  });
export async function applyChange(sim: string, change: Change): Promise<void> {
  const w = await openSimWriter(sim);
  const p = change.params as {
    screen?: string;
    from?: string;
    to?: string | string[];
    label?: string;
  };
  switch (change.type) {
    case 'table_to_cards':
      await w.write(
        'MATCH (s:Screen {id: $screen}) SET s.has_table = false, s.mobile_overflow = false',
        { screen: p.screen },
      );
      await dropIssue(w, 'flowlens/mobile-overflow', String(p.screen));
      return;
    case 'table_responsive':
      await w.write('MATCH (s:Screen {id: $screen}) SET s.mobile_overflow = false', {
        screen: p.screen,
      });
      await dropIssue(w, 'flowlens/mobile-overflow', String(p.screen));
      return;
    case 'content_in_html':
      await w.write(
        'MATCH (s:Screen {id: $screen}) SET s.js_only_ratio = 0, s.raw_text_length = s.rendered_text_length',
        { screen: p.screen },
      );
      await dropIssue(w, 'flowlens/js-only-content', String(p.screen));
      return;
    case 'remove_links':
      await w.write(
        `MATCH (:Screen {id: $from})-[e:NAVIGATES_TO|HREF_TO|FLOWS_TO]->(b:Screen)
         WHERE b.id IN $to DELETE e`,
        { from: p.from, to: Array.isArray(p.to) ? p.to : [p.to] },
      );
      await relinkDepths(sim, w);
      return;
    case 'add_link':
      await w.write(
        `MATCH (a:Screen {id: $from}), (b:Screen {id: $to})
         MERGE (a)-[e:NAVIGATES_TO {action: $label}]->(b) SET e.via = 'link', e.shared = false
         MERGE (a)-[:HREF_TO {action: $label}]->(b)
         MERGE (a)-[f:FLOWS_TO {action: $label}]->(b) SET f.via = 'link', f.promoted = false`,
        { from: p.from, to: Array.isArray(p.to) ? p.to[0] : p.to, label: p.label ?? 'Link' },
      );
      await relinkDepths(sim, w);
      return;
  }
}
function deltas(before: LensScores, after: LensScores): PartDelta[] {
  const out: PartDelta[] = [];
  for (const lens of ['ux', 'seo'] as const)
    for (const b of before[lens].parts) {
      const a = after[lens].parts.find((x) => x.key === b.key);
      const delta = b.points - (a?.points ?? 0);
      if (delta !== 0 || b.count !== a?.count)
        out.push({
          lens,
          key: b.key,
          label: b.label,
          before: b.points,
          after: a?.points ?? 0,
          delta,
        });
    }
  return out;
}
export async function simulate(graph: string, change: Change): Promise<Simulation> {
  const original = await openGraph(graph);
  const before = await lensScores(original);
  const tables = await tableScreens(original);
  const depthsBefore = new Map(
    (
      await original.read<{
        id: string;
        d: number | null;
      }>('MATCH (s:Screen) RETURN s.id AS id, s.link_depth AS d')
    ).map((r) => [r.id, r.d ?? null]),
  );
  const sim = `${SIM_PREFIX}${currentContext().tenant.id}-${randomBytes(6).toString('hex')}`;
  try {
    await copyToSim(graph, sim);
    await applyChange(sim, change);
    const copy = await openGraph(sim);
    const after = await lensScores(copy, tables);
    const depthsAfter = await copy.read<{
      id: string;
      d: number | null;
    }>('MATCH (s:Screen) RETURN s.id AS id, s.link_depth AS d');
    return {
      change,
      before,
      after,
      delta: { ux: after.ux.score - before.ux.score, seo: after.seo.score - before.seo.score },
      parts: deltas(before, after),
      link_depth: depthsAfter
        .map((r) => ({ id: r.id, before: depthsBefore.get(r.id) ?? null, after: r.d ?? null }))
        .filter((r) => r.before !== r.after)
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  } finally {
    await deleteSim(sim).catch((err: unknown) =>
      console.error(`Could not delete ${sim}:`, err instanceof Error ? err.message : err),
    );
  }
}
