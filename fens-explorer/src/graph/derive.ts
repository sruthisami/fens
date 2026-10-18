import type { FalkorDB, Graph } from 'falkordb';
export const SHARED_THRESHOLD = 0.6;
const BATCH = 200;
interface EdgeRow {
  from: string;
  to: string;
  action: string;
  via: string;
}
const normaliseLabel = (label: string) => label.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
const edgeKey = (e: { from: string; to: string; action: string }) =>
  `${e.from}\u0000${e.to}\u0000${e.action}`;
export function sharedKeys(edges: EdgeRow[], screenCount: number): Set<string> {
  const group = (e: EdgeRow) => `${e.to}\u0000${e.via}\u0000${normaliseLabel(e.action)}`;
  const sources = new Map<string, Set<string>>();
  for (const e of edges) {
    const key = group(e);
    if (!sources.has(key)) sources.set(key, new Set());
    sources.get(key)?.add(e.from);
  }
  const min = Math.ceil(screenCount * SHARED_THRESHOLD);
  return new Set(edges.filter((e) => (sources.get(group(e))?.size ?? 0) >= min).map(edgeKey));
}
async function batched(graph: Graph, cypher: string, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await graph.query(cypher, { params: { rows: rows.slice(i, i + BATCH) } as never });
  }
}
export interface DeriveResult {
  edges: number;
  shared: number;
  flows: number;
  promoted: string[];
  removedFlows: number;
  hrefs: number;
  unreachableByLinks: string[];
}
export function promotedFlows(edges: EdgeRow[], shared: Set<string>, start: string) {
  const inboundFlow = new Set(edges.filter((e) => !shared.has(edgeKey(e))).map((e) => e.to));
  const sharedInbound = new Map<string, EdgeRow[]>();
  for (const e of edges) {
    if (!shared.has(edgeKey(e))) continue;
    sharedInbound.set(e.to, [...(sharedInbound.get(e.to) ?? []), e]);
  }
  const promoted: (EdgeRow & {
    promoted: boolean;
  })[] = [];
  for (const [to, inbound] of [...sharedInbound.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (to === start || inboundFlow.has(to)) continue;
    const pick = inbound.find((e) => e.from === start) ?? inbound[0];
    if (pick)
      promoted.push({ from: start, to, action: pick.action, via: pick.via, promoted: true });
  }
  return promoted;
}
export function linkDepths(
  edges: {
    from: string;
    to: string;
  }[],
  start: string,
): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const depth = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as string;
    for (const next of out.get(at) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(at) ?? 0) + 1);
      queue.push(next);
    }
  }
  return depth;
}
export async function derive(db: FalkorDB, name: string): Promise<DeriveResult> {
  const graph = db.selectGraph(name);
  const screens =
    (
      await graph.roQuery<{
        n: number;
      }>('MATCH (s:Screen) RETURN count(s) AS n')
    ).data?.[0]?.n ?? 0;
  const edges =
    (
      await graph.roQuery<EdgeRow>(`MATCH (a:Screen)-[e:NAVIGATES_TO]->(b:Screen)
         RETURN a.id AS from, b.id AS to, e.action AS action, e.via AS via`)
    ).data ?? [];
  const shared = sharedKeys(edges, screens);
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (:Screen {id: r.from})-[e:NAVIGATES_TO {action: r.action}]->(:Screen {id: r.to})
     SET e.shared = r.shared`,
    edges.map((e) => ({ ...e, shared: shared.has(edgeKey(e)) })),
  );
  const start =
    (
      await graph.roQuery<{
        id: string;
      }>(
        "MATCH (s:Screen) WHERE s.discovered_via = 'start' RETURN s.id AS id ORDER BY s.depth LIMIT 1",
      )
    ).data?.[0]?.id ?? '/';
  const promoted = promotedFlows(edges, shared, start);
  const flows = [
    ...edges.filter((e) => !shared.has(edgeKey(e))).map((e) => ({ ...e, promoted: false })),
    ...promoted,
  ];
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (a:Screen {id: r.from})
     MATCH (b:Screen {id: r.to})
     MERGE (a)-[f:FLOWS_TO {action: r.action}]->(b)
     SET f.via = r.via, f.promoted = r.promoted`,
    flows,
  );
  const wanted = new Set(flows.map(edgeKey));
  const existing =
    (
      await graph.roQuery<{
        from: string;
        to: string;
        action: string;
      }>(
        `MATCH (a:Screen)-[f:FLOWS_TO]->(b:Screen) RETURN a.id AS from, b.id AS to, f.action AS action`,
      )
    ).data ?? [];
  const stale = existing.filter((f) => !wanted.has(edgeKey(f)));
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (:Screen {id: r.from})-[f:FLOWS_TO {action: r.action}]->(:Screen {id: r.to})
     DELETE f`,
    stale,
  );
  const hrefs = edges.filter((e) => e.via === 'link');
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (a:Screen {id: r.from})
     MATCH (b:Screen {id: r.to})
     MERGE (a)-[h:HREF_TO {action: r.action}]->(b)`,
    hrefs,
  );
  const wantedHrefs = new Set(hrefs.map(edgeKey));
  const existingHrefs =
    (
      await graph.roQuery<{
        from: string;
        to: string;
        action: string;
      }>(
        `MATCH (a:Screen)-[h:HREF_TO]->(b:Screen) RETURN a.id AS from, b.id AS to, h.action AS action`,
      )
    ).data ?? [];
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (:Screen {id: r.from})-[h:HREF_TO {action: r.action}]->(:Screen {id: r.to})
     DELETE h`,
    existingHrefs.filter((h) => !wantedHrefs.has(edgeKey(h))),
  );
  const depths = linkDepths(hrefs, start);
  const ids =
    (
      await graph.roQuery<{
        id: string;
      }>('MATCH (s:Screen) RETURN s.id AS id ORDER BY id')
    ).data ?? [];
  await batched(
    graph,
    `UNWIND $rows AS r MATCH (s:Screen {id: r.id}) SET s.link_depth = r.depth`,
    ids.map(({ id }) => ({ id, depth: depths.get(id) ?? null })),
  );
  return {
    hrefs: hrefs.length,
    unreachableByLinks: ids.map((r) => r.id).filter((id) => !depths.has(id)),
    edges: edges.length,
    shared: shared.size,
    flows: flows.length,
    promoted: promoted.map((p) => p.to),
    removedFlows: stale.length,
  };
}
