import { collectRelease } from '../releases/collect.js';
import { basename } from 'node:path';
import type { ReadOnlyGraph } from './db.js';
interface RawEdge {
  source: string;
  target: string;
  action: string;
  via: string;
  shared: boolean | null;
}
export const LOCAL_ISSUE_SHARE = 0.5;
const screenshotUrl = (graph: string, stored: string | null) =>
  stored
    ? `/api/graphs/${encodeURIComponent(graph)}/screenshots/${encodeURIComponent(basename(stored))}`
    : null;
const one = async (g: ReadOnlyGraph, cypher: string) =>
  (
    await g.read<{
      n: number;
    }>(cypher)
  )[0]?.n ?? 0;
export async function hasScreens(g: ReadOnlyGraph): Promise<boolean> {
  return (await one(g, 'MATCH (s:Screen) RETURN count(s) AS n')) > 0;
}
export type Lens = 'UX' | 'SEO' | 'AEO';
const lensFilter = (lens: Lens | null) =>
  lens ? 'WHERE (i)-[:VIOLATES]->(:Guideline {lens: $lens})' : '';
export async function summary(g: ReadOnlyGraph, graph: string, lens: Lens | null = null) {
  return {
    graph,
    screens: await one(g, 'MATCH (s:Screen) RETURN count(s) AS n'),
    edges: await one(g, 'MATCH (:Screen)-[e:NAVIGATES_TO]->(:Screen) RETURN count(e) AS n'),
    components: await one(g, 'MATCH (c:Component) RETURN count(c) AS n'),
    orphans: await one(
      g,
      'MATCH (s:Screen) WHERE NOT ()-[:NAVIGATES_TO]->(s) RETURN count(s) AS n',
    ),
    deadEnds: await one(
      g,
      'MATCH (s:Screen) WHERE NOT (s)-[:NAVIGATES_TO]->() RETURN count(s) AS n',
    ),
    stateRequired: await one(
      g,
      'MATCH (s:Screen) WHERE s.state_required = true RETURN count(s) AS n',
    ),
    seeds: await one(g, "MATCH (s:Screen) WHERE s.discovered_via = 'seed' RETURN count(s) AS n"),
    unreachableByLinks: (await one(
      g,
      'MATCH (s:Screen) WHERE s.link_depth IS NOT NULL RETURN count(s) AS n',
    ))
      ? await one(g, 'MATCH (s:Screen) WHERE s.link_depth IS NULL RETURN count(s) AS n')
      : 0,
    lens,
    issues: await issueCounts(g, lens),
    health: (await collectRelease(g, graph)).health,
  };
}
interface NodeRow {
  id: string;
  path: string;
  title: string | null;
  depth: number | null;
  discovered_via: string | null;
  state_required: boolean | null;
  screenshot: string | null;
  out_degree: number;
  in_degree: number;
  issue_count: number;
  link_depth: number | null;
}
export async function cytoscapeGraph(g: ReadOnlyGraph, graph: string) {
  const rows = await g.read<NodeRow>(`MATCH (s:Screen)
     OPTIONAL MATCH (s)-[o:NAVIGATES_TO]->(:Screen)
     WITH s, count(o) AS out_degree
     OPTIONAL MATCH (:Screen)-[i:NAVIGATES_TO]->(s)
     WITH s, out_degree, count(i) AS in_degree
     OPTIONAL MATCH (iss:Issue)-[:FOUND_ON]->(s)
     RETURN s.id AS id, s.path AS path, s.title AS title, s.depth AS depth,
            s.discovered_via AS discovered_via, s.state_required AS state_required,
            s.screenshot AS screenshot, s.link_depth AS link_depth, out_degree, in_degree,
            count(DISTINCT iss) AS issue_count
     ORDER BY id`);
  const localRows = await g.read<{
    id: string;
    n: number;
  }>(`MATCH (s:Screen) WITH count(s) AS total
     MATCH (i:Issue)-[:FOUND_ON]->(x:Screen)
     WITH total, i, count(x) AS spread
     WHERE spread <= total * ${LOCAL_ISSUE_SHARE}
     MATCH (i)-[:FOUND_ON]->(s:Screen)
     RETURN s.id AS id, count(DISTINCT i) AS n`);
  const local = new Map(localRows.map((r) => [r.id, r.n]));
  const hasLinkDepth = rows.some((r) => r.link_depth !== null);
  const nodes = rows.map((r) => ({
    id: r.id,
    path: r.path ?? r.id,
    title: r.title ?? '',
    depth: r.depth,
    discovered_via: r.discovered_via,
    state_required: r.state_required === true,
    in_degree: r.in_degree,
    out_degree: r.out_degree,
    orphan: r.in_degree === 0,
    dead_end: r.out_degree === 0,
    issue_count: r.issue_count,
    local_issue_count: local.get(r.id) ?? 0,
    screenshot: screenshotUrl(graph, r.screenshot),
    link_depth: r.link_depth,
    unreachable_by_links: hasLinkDepth && r.link_depth === null,
  }));
  const raw = await g.read<RawEdge>(`MATCH (a:Screen)-[e:NAVIGATES_TO]->(b:Screen)
     RETURN a.id AS source, b.id AS target, e.action AS action, e.via AS via, e.shared AS shared`);
  const pairs = new Map<
    string,
    {
      id: string;
      source: string;
      target: string;
      actions: Set<string>;
      via: Set<string>;
      count: number;
      shared: boolean;
    }
  >();
  for (const e of raw) {
    const id = `${e.source} -> ${e.target}`;
    let pair = pairs.get(id);
    if (!pair) {
      pair = {
        id,
        source: e.source,
        target: e.target,
        actions: new Set(),
        via: new Set(),
        count: 0,
        shared: true,
      };
      pairs.set(id, pair);
    }
    pair.actions.add(e.action);
    pair.via.add(e.via);
    pair.count++;
    pair.shared &&= e.shared === true;
  }
  const edges = [...pairs.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ ...p, actions: [...p.actions].sort(), via: [...p.via].sort() }));
  return { graph, nodes, edges };
}
interface EdgeRow {
  other: string;
  action: string;
  via: string;
  selector: string | null;
  redirects_to: string | null;
}
interface ComponentRow {
  name: string;
  id: string;
  selector: string | null;
  text: string | null;
}
export async function screenDetail(g: ReadOnlyGraph, graph: string, id: string) {
  const found = await g.read<{
    p: Record<string, unknown>;
  }>('MATCH (s:Screen {id: $id}) RETURN properties(s) AS p', { id });
  const props = found[0]?.p;
  if (!props) return null;
  delete props.embedding;
  const edgeFields =
    'e.action AS action, e.via AS via, e.selector AS selector, e.redirects_to AS redirects_to';
  const incoming = await g.read<EdgeRow>(
    `MATCH (a:Screen)-[e:NAVIGATES_TO]->(:Screen {id: $id}) RETURN a.id AS other, ${edgeFields} ORDER BY other, action`,
    { id },
  );
  const outgoing = await g.read<EdgeRow>(
    `MATCH (:Screen {id: $id})-[e:NAVIGATES_TO]->(b:Screen) RETURN b.id AS other, ${edgeFields} ORDER BY other, action`,
    { id },
  );
  const instances = await g.read<ComponentRow>(
    `MATCH (:Screen {id: $id})-[:CONTAINS]->(c:Component)-[:INSTANCE_OF]->(d:DesignSystemComponent)
     RETURN d.name AS name, c.id AS id, c.selector AS selector, c.text AS text ORDER BY name, id`,
    { id },
  );
  const grouped = new Map<
    string,
    {
      name: string;
      count: number;
      instances: Omit<ComponentRow, 'name'>[];
    }
  >();
  for (const { name, ...rest } of instances) {
    const entry = grouped.get(name) ?? { name, count: 0, instances: [] };
    entry.count++;
    entry.instances.push(rest);
    grouped.set(name, entry);
  }
  const issues = await g.read<ScreenIssueRow>(
    `MATCH (i:Issue)-[f:FOUND_ON]->(:Screen {id: $id})
     OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
     OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
     RETURN i.id AS id, i.rule_id AS rule_id, i.source AS source, i.severity AS severity,
            i.help AS help, d.name AS component, f.selector AS selector, f.html AS html,
            f.node_count AS node_count, collect(DISTINCT gl.lens) AS lenses`,
    { id },
  );
  const toEdge = ({ other, ...rest }: EdgeRow, key: 'from' | 'to') => ({ [key]: other, ...rest });
  return {
    screen: {
      ...props,
      screenshot_url: screenshotUrl(graph, (props.screenshot as string) ?? null),
    },
    incoming: incoming.map((e) => toEdge(e, 'from')),
    outgoing: outgoing.map((e) => toEdge(e, 'to')),
    components: [...grouped.values()],
    issues: sortIssues(issues),
  };
}
export async function designSystemComponents(g: ReadOnlyGraph) {
  return g.read<{
    name: string;
    screens: number;
    instances: number;
  }>(`MATCH (d:DesignSystemComponent)
     OPTIONAL MATCH (d)<-[:INSTANCE_OF]-(c:Component)<-[:CONTAINS]-(s:Screen)
     RETURN d.name AS name, count(DISTINCT s) AS screens, count(DISTINCT c) AS instances
     ORDER BY screens DESC, name`);
}
export async function screensWithComponent(
  g: ReadOnlyGraph,
  name: string,
): Promise<string[] | null> {
  const exists = await g.read<{
    n: number;
  }>('MATCH (d:DesignSystemComponent {name: $name}) RETURN count(d) AS n', { name });
  if ((exists[0]?.n ?? 0) === 0) return null;
  const rows = await g.read<{
    id: string;
  }>(
    `MATCH (:DesignSystemComponent {name: $name})<-[:INSTANCE_OF]-(:Component)<-[:CONTAINS]-(s:Screen)
     RETURN DISTINCT s.id AS id ORDER BY id`,
    { name },
  );
  return rows.map((r) => r.id);
}
export const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;
const severityRank = (s: string) => {
  const i = SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);
  return i < 0 ? SEVERITIES.length : i;
};
interface ScreenIssueRow {
  id: string;
  rule_id: string;
  source: string;
  severity: string;
  help: string;
  component: string | null;
  selector: string | null;
  html: string | null;
  node_count: number | null;
  lenses: string[];
}
function sortIssues<
  T extends {
    severity: string;
    rule_id: string;
    screen_count?: number;
  },
>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      (b.screen_count ?? 0) - (a.screen_count ?? 0) ||
      a.rule_id.localeCompare(b.rule_id),
  );
}
async function issueCounts(g: ReadOnlyGraph, lens: Lens | null) {
  const rows = await g.read<{
    severity: string;
    source: string;
    n: number;
  }>(
    `MATCH (i:Issue) ${lensFilter(lens)} RETURN i.severity AS severity, i.source AS source, count(i) AS n`,
    lens ? { lens } : undefined,
  );
  const bySeverity: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const bySource: Record<string, number> = { axe: 0, flowlens: 0, lighthouse: 0 };
  let total = 0;
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r.n;
    bySource[r.source] = (bySource[r.source] ?? 0) + r.n;
    total += r.n;
  }
  const lensRows = await g.read<{
    lens: string;
    n: number;
  }>(`MATCH (i:Issue)-[:VIOLATES]->(gl:Guideline) WITH DISTINCT i, gl.lens AS lens
     RETURN lens, count(i) AS n`);
  const byLens: Record<string, number> = { UX: 0, SEO: 0, AEO: 0 };
  for (const r of lensRows) byLens[r.lens] = (byLens[r.lens] ?? 0) + r.n;
  return { total, bySeverity, bySource, byLens };
}
interface IssueListRow {
  id: string;
  rule_id: string;
  source: string;
  severity: string;
  help: string;
  guidelines: string[];
  lenses: string[];
  component: string | null;
  screen_count: number;
  instance_count: number;
}
export async function issueList(g: ReadOnlyGraph, lens: Lens | null = null) {
  const rows = await g.read<IssueListRow>(
    `MATCH (i:Issue) ${lensFilter(lens)}
     OPTIONAL MATCH (i)-[f:FOUND_ON]->(s:Screen)
     WITH i, count(DISTINCT s) AS screen_count, sum(f.node_count) AS instance_count
     OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
     WITH i, screen_count, instance_count, collect(DISTINCT gl.id) AS guidelines,
          collect(DISTINCT gl.lens) AS lenses
     OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
     RETURN i.id AS id, i.rule_id AS rule_id, i.source AS source, i.severity AS severity,
            i.help AS help, guidelines, lenses, d.name AS component, screen_count, instance_count`,
    lens ? { lens } : undefined,
  );
  return sortIssues(
    rows.map((r) => ({
      ...r,
      guidelines: [...r.guidelines].sort(),
      lenses: [...r.lenses].filter(Boolean).sort(),
    })),
  );
}
export async function issueDetail(g: ReadOnlyGraph, id: string) {
  const found = await g.read<{
    p: Record<string, unknown>;
  }>('MATCH (i:Issue {id: $id}) RETURN properties(i) AS p', { id });
  const issue = found[0]?.p;
  if (!issue) return null;
  const guidelines = await g.read<{
    id: string;
    name: string;
    lens: string;
    source: string;
  }>(
    `MATCH (:Issue {id: $id})-[:VIOLATES]->(gl:Guideline)
     RETURN gl.id AS id, gl.name AS name, gl.lens AS lens, gl.source AS source ORDER BY id`,
    { id },
  );
  const component = await g.read<{
    name: string;
  }>('MATCH (:Issue {id: $id})-[:IN_COMPONENT]->(d:DesignSystemComponent) RETURN d.name AS name', {
    id,
  });
  const screens = await g.read<{
    id: string;
    selector: string;
    html: string;
    node_count: number;
    details: string[] | null;
  }>(
    `MATCH (:Issue {id: $id})-[f:FOUND_ON]->(s:Screen)
     RETURN s.id AS id, f.selector AS selector, f.html AS html, f.node_count AS node_count,
            f.details AS details
     ORDER BY id`,
    { id },
  );
  return { issue, guidelines, component: component[0]?.name ?? null, screens };
}
