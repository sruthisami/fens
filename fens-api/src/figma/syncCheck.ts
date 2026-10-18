import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, openGraph } from '../graph/db.js';
import { runWithContext, tenantContext } from '../tenancy/context.js';
import { screensFor } from '../integrations/figma.js';
import {
  CLASSES,
  compareProto,
  type GraphEdge,
  type PrototypeGraph,
  type SyncResult,
} from './sync.js';
const PROTO = resolve('figma-prototype.json');
const MAP = resolve('figma-map.json');
const ROUTES = resolve('../fens-demo-shop/routes.json');
export const GRAPHS = ['demo-shop-v1', 'demo-shop-v2'];
export interface GraphSync {
  graph: string;
  result: SyncResult | null;
  warnings: string[];
  error?: string;
}
const mtime = async (p: string) => (await stat(p).catch(() => null))?.mtime ?? null;
export async function syncCheck(): Promise<GraphSync[]> {
  const proto = JSON.parse(await readFile(PROTO, 'utf8').catch(() => '{"graphs":{}}')) as {
    graphs: Record<string, PrototypeGraph>;
  };
  const map = JSON.parse(await readFile(MAP, 'utf8').catch(() => '{}')) as unknown;
  const mapTime = await mtime(MAP);
  const routesTime = await mtime(ROUTES);
  const out: GraphSync[] = [];
  for (const graph of GRAPHS) {
    const p = proto.graphs[graph];
    if (!p) {
      out.push({
        graph,
        result: null,
        warnings: [],
        error: `figma-prototype.json has no ${graph}; run scripts/figma-wire`,
      });
      continue;
    }
    const g = await openGraph(graph);
    const edges = await g.read<GraphEdge>(
      'MATCH (a:Screen)-[e:NAVIGATES_TO]->(b:Screen) RETURN a.id AS from, b.id AS to, e.action AS action',
    );
    const screens = (
      await g.read<{
        id: string;
      }>('MATCH (s:Screen) RETURN s.id AS id')
    ).map((r) => r.id);
    const crawled =
      (
        await g.read<{
          t: string | null;
        }>('MATCH (s:Screen) RETURN max(s.crawled_at) AS t')
      )[0]?.t ?? null;
    const exported = new Date(p.exported_at);
    const warnings: string[] = [];
    if (mapTime && mapTime > exported)
      warnings.push(
        `figma-map.json changed after the export (${mapTime.toISOString()} > ${p.exported_at})`,
      );
    if (routesTime && routesTime > exported)
      warnings.push(
        `the shop's routes.json changed after the export (${routesTime.toISOString()} > ${p.exported_at})`,
      );
    if (crawled && new Date(crawled) > exported)
      warnings.push(`${graph} was crawled after the export (${crawled} > ${p.exported_at})`);
    out.push({ graph, result: compareProto(edges, p, screens, screensFor(map, graph)), warnings });
  }
  return out;
}
export const failedClasses = (r: SyncResult | null) =>
  r ? CLASSES.filter((c) => r.classes[c].length > 0) : [...CLASSES];
async function main(): Promise<number> {
  let failed = false;
  for (const s of await syncCheck()) {
    console.log(`Figma prototype vs ${s.graph}`);
    if (!s.result) {
      console.log(`  FAIL  ${s.error}`);
      failed = true;
      continue;
    }
    const r = s.result;
    console.log(
      `  ${r.edges} graph edges, ${r.matched} matched, ${r.capture_gaps.length} capture gap(s)`,
    );
    for (const c of CLASSES) {
      const list = r.classes[c];
      console.log(
        `  ${list.length ? 'FAIL' : 'PASS'}  ${c.replace(/_/g, ' ')}${list.length ? `: ${list.length}` : ''}`,
      );
      for (const x of list) console.log(`        ${x}`);
      if (list.length) failed = true;
    }
    for (const g of r.capture_gaps)
      console.log(`  info  capture gap (no Link or Button layer in Figma): ${g}`);
    for (const w of s.warnings) console.log(`  WARN  ${w}; re-export with scripts/figma-wire`);
  }
  console.log(
    failed
      ? 'Figma prototype differs from the graph.'
      : 'Figma prototype matches the graph (apart from the capture gaps).',
  );
  return failed ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  runWithContext(tenantContext('fence-team', 'worker-sync-check'), main)
    .then(async (code) => {
      await closeDb();
      process.exit(code);
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      await closeDb().catch(() => {});
      process.exit(1);
    });
