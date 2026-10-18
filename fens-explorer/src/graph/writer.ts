import type { FalkorDB, Graph } from 'falkordb';
import { CONFLICTS } from '../seo/index.js';
import type { CrawlResult, ScreenNode } from '../types.js';
const BATCH = 200;
async function batched<T>(graph: Graph, cypher: string, rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await graph.query(cypher, { params: { rows: rows.slice(i, i + BATCH) } as never });
  }
}
async function ensureIndexes(graph: Graph): Promise<void> {
  const indexes: [string, string][] = [
    ['Screen', 'id'],
    ['Component', 'id'],
    ['DesignSystemComponent', 'name'],
    ['Issue', 'id'],
    ['Guideline', 'id'],
  ];
  for (const [label, prop] of indexes) {
    await graph.createNodeRangeIndex(label, prop).catch(() => {});
  }
}
export async function deleteGraph(db: FalkorDB, name: string): Promise<boolean> {
  if (!(await db.list()).includes(name)) return false;
  await db.selectGraph(name).delete();
  return true;
}
export async function writeCrawl(db: FalkorDB, name: string, result: CrawlResult): Promise<void> {
  const graph = db.selectGraph(name);
  await ensureIndexes(graph);
  const screens: ScreenNode[] = result.screens.map((s) => ({
    id: s.id,
    path: s.path,
    url: s.url,
    title: s.title,
    fingerprint: s.fingerprint,
    screenshot: s.screenshot,
    discovered_via: s.discovered_via,
    depth: s.depth,
    instances: s.instances,
    crawled_at: s.crawled_at,
    state_required: s.state_required,
  }));
  await batched(
    graph,
    `UNWIND $rows AS r
     MERGE (s:Screen {id: r.id})
     SET s.raw_status = r.raw_status, s.raw_text_length = r.raw_text_length,
         s.rendered_text_length = r.rendered_text_length, s.js_only_ratio = r.js_only_ratio,
         s.meta_description = r.meta_description, s.h1_count = r.h1_count, s.canonical = r.canonical,
         s.jsonld_types = r.jsonld_types, s.has_table = r.has_table,
         s.mobile_overflow = r.mobile_overflow, s.lcp_ms = r.lcp_ms, s.cls = r.cls,
         s.in_sitemap = r.in_sitemap, s.robots_disallowed = r.robots_disallowed, s.text = r.text`,
    result.screens.map((s) => ({
      id: s.id,
      raw_status: s.seo?.raw_status ?? null,
      raw_text_length: s.seo?.raw_text_length ?? null,
      rendered_text_length: s.seo?.rendered_text_length ?? null,
      js_only_ratio: s.seo?.js_only_ratio ?? null,
      meta_description: s.seo?.meta_description ?? null,
      h1_count: s.seo?.h1_count ?? null,
      canonical: s.seo?.canonical ?? null,
      jsonld_types: s.seo ? s.seo.jsonld_types : null,
      has_table: s.seo?.has_table ?? null,
      mobile_overflow: s.seo?.mobile_overflow ?? null,
      lcp_ms: s.lighthouse?.lcp_ms ?? null,
      cls: s.lighthouse?.cls ?? null,
      in_sitemap: s.in_sitemap ?? null,
      robots_disallowed: s.robots_disallowed ?? null,
      text: s.seo?.text ?? null,
    })),
  );
  await batched(
    graph,
    `UNWIND $rows AS r
     MERGE (s:Screen {id: r.id})
     SET s.path = r.path, s.url = r.url, s.title = r.title, s.fingerprint = r.fingerprint,
         s.screenshot = r.screenshot, s.discovered_via = r.discovered_via, s.depth = r.depth,
         s.instances = r.instances, s.crawled_at = r.crawled_at,
         s.state_required = r.state_required`,
    screens,
  );
  const names = [...new Set(result.components.map((c) => c.name))].map((n) => ({ name: n }));
  await batched(graph, `UNWIND $rows AS r MERGE (:DesignSystemComponent {name: r.name})`, names);
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (s:Screen {id: r.screen})
     MATCH (d:DesignSystemComponent {name: r.name})
     MERGE (c:Component {id: r.id})
     SET c.name = r.name, c.selector = r.selector, c.text = r.text
     MERGE (s)-[:CONTAINS]->(c)
     MERGE (c)-[:INSTANCE_OF]->(d)`,
    result.components,
  );
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (a:Screen {id: r.from})
     MATCH (b:Screen {id: r.to})
     MERGE (a)-[n:NAVIGATES_TO {action: r.action}]->(b)
     SET n.via = r.via, n.selector = r.selector, n.redirects_to = r.redirects_to`,
    result.edges.map((e) => ({ ...e, redirects_to: e.redirects_to ?? null })),
  );
  await writeIssues(graph, result);
}
export async function writeConflicts(db: FalkorDB, name: string): Promise<number> {
  const graph = db.selectGraph(name);
  await ensureIndexes(graph);
  await batched(
    graph,
    `UNWIND $rows AS r
     MERGE (a:Guideline {id: r.from.id})
     SET a.name = r.from.name, a.lens = r.from.lens, a.source = r.from.source
     MERGE (b:Guideline {id: r.to.id})
     SET b.name = r.to.name, b.lens = r.to.lens, b.source = r.to.source
     MERGE (a)-[c:CONFLICTS_WITH]->(b)
     SET c.reason = r.reason`,
    CONFLICTS.map((c) => ({
      from: { ...c.from, lens: c.from.lens ?? 'UX' },
      to: { ...c.to, lens: c.to.lens ?? 'UX' },
      reason: c.reason,
    })),
  );
  return CONFLICTS.length;
}
async function writeIssues(graph: Graph, result: CrawlResult): Promise<void> {
  const now = new Date().toISOString();
  await batched(
    graph,
    `UNWIND $rows AS r
     MERGE (i:Issue {id: r.id})
     ON CREATE SET i.first_seen = r.first_seen, i.status = 'open'
     SET i.key = r.key, i.source = r.source, i.rule_id = r.rule_id, i.severity = r.severity,
         i.help = r.help, i.description = r.description, i.help_url = r.help_url`,
    result.issues.map(({ id, key, source, rule_id, severity, help, description, help_url }) => ({
      id,
      key,
      source,
      rule_id,
      severity,
      help,
      description,
      help_url,
      first_seen: now,
    })),
  );
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (i:Issue {id: r.issue})
     MERGE (g:Guideline {id: r.id})
     SET g.name = r.name, g.lens = coalesce(r.lens, 'UX'), g.source = r.source
     MERGE (i)-[:VIOLATES]->(g)`,
    result.issues.flatMap((i) => i.guidelines.map((g) => ({ issue: i.id, lens: null, ...g }))),
  );
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (i:Issue {id: r.issue})
     MERGE (d:DesignSystemComponent {name: r.component})
     MERGE (i)-[:IN_COMPONENT]->(d)`,
    result.issues
      .filter((i) => i.component !== null)
      .map((i) => ({ issue: i.id, component: i.component })),
  );
  await batched(
    graph,
    `UNWIND $rows AS r
     MATCH (i:Issue {id: r.issue})
     MATCH (s:Screen {id: r.screen})
     MERGE (i)-[f:FOUND_ON]->(s)
     SET f.selector = r.selector, f.html = r.html, f.node_count = r.node_count,
         f.details = r.details, f.bbox_x = r.bbox_x, f.bbox_y = r.bbox_y, f.bbox_w = r.bbox_w,
         f.bbox_h = r.bbox_h`,
    result.occurrences.map(({ bbox, ...o }) => ({
      ...o,
      details: o.details ?? null,
      bbox_x: bbox?.x ?? null,
      bbox_y: bbox?.y ?? null,
      bbox_w: bbox?.w ?? null,
      bbox_h: bbox?.h ?? null,
    })),
  );
}
export async function graphCounts(
  db: FalkorDB,
  name: string,
): Promise<{
  screens: number;
  edges: number;
  components: number;
  designSystem: number;
  issues: number;
  foundOn: number;
}> {
  const graph = db.selectGraph(name);
  const one = async (q: string) => {
    const r = await graph.roQuery<{
      n: number;
    }>(q);
    return r.data?.[0]?.n ?? 0;
  };
  return {
    screens: await one('MATCH (s:Screen) RETURN count(s) AS n'),
    edges: await one('MATCH ()-[e:NAVIGATES_TO]->() RETURN count(e) AS n'),
    components: await one('MATCH (c:Component) RETURN count(c) AS n'),
    designSystem: await one('MATCH (d:DesignSystemComponent) RETURN count(d) AS n'),
    issues: await one('MATCH (i:Issue) RETURN count(i) AS n'),
    foundOn: await one('MATCH (:Issue)-[f:FOUND_ON]->(:Screen) RETURN count(f) AS n'),
  };
}
