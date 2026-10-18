import { z } from 'zod';
import type { ReadOnlyGraph } from '../graph/db.js';
import { notFound } from '../http/errors.js';
import { defineTool, edgeId, edgeSet, REL, screenId, topN } from './types.js';
async function requireScreen(g: ReadOnlyGraph, id: string): Promise<void> {
  const rows = await g.read<{
    n: number;
  }>('MATCH (s:Screen {id: $id}) RETURN count(s) AS n', {
    id,
  });
  if ((rows[0]?.n ?? 0) === 0) throw notFound(`Unknown screen: ${id}`);
}
async function screenCount(g: ReadOnlyGraph): Promise<number> {
  return (
    (
      await g.read<{
        n: number;
      }>('MATCH (s:Screen) RETURN count(s) AS n')
    )[0]?.n ?? 0
  );
}
export const shortestPath = defineTool({
  name: 'shortest_path',
  title: 'Shortest path between two screens',
  description:
    'Fewest clicks from one screen to another. Returns each step with the link or button label clicked and the total number of steps. Use edge_set "all" for what a user can really click (including header and footer links), or "flow" to ignore shared header/footer links.',
  input: { from: screenId, to: screenId, edge_set: edgeSet.default('all') },
  async run(g, { from, to, edge_set }) {
    await requireScreen(g, from);
    await requireScreen(g, to);
    if (from === to) {
      return { result: { found: true, length: 0, steps: [] }, screens: [from], edges: [] };
    }
    const rows = await g.read<{
      ids: string[];
      actions: string[];
      vias: string[];
    }>(
      `MATCH (a:Screen {id: $from}), (b:Screen {id: $to})
       WITH shortestPath((a)-[:${REL[edge_set]}*]->(b)) AS p
       WHERE p IS NOT NULL
       RETURN [n IN nodes(p) | n.id] AS ids,
              [r IN relationships(p) | r.action] AS actions,
              [r IN relationships(p) | r.via] AS vias`,
      { from, to },
    );
    const row = rows[0];
    if (!row)
      return { result: { found: false, length: null, steps: [] }, screens: [from, to], edges: [] };
    const steps = row.actions.map((action, i) => ({
      from: row.ids[i] ?? '',
      to: row.ids[i + 1] ?? '',
      action,
      via: row.vias[i] ?? (edge_set === 'href' ? 'link' : ''),
    }));
    return {
      result: { found: true, length: steps.length, edge_set, steps },
      screens: row.ids,
      edges: steps.map((s) => edgeId(s.from, s.to)),
    };
  },
});
export const findOrphans = defineTool({
  name: 'find_orphans',
  title: 'Orphan screens',
  description:
    'Screens that no link or button leads to (no inbound NAVIGATES_TO edge). Users can only reach them by typing the URL; the crawler finds them through --seed.',
  input: {},
  async run(g) {
    const rows = await g.read<{
      id: string;
      title: string;
      discovered_via: string;
    }>(`MATCH (s:Screen) WHERE NOT ()-[:NAVIGATES_TO]->(s)
       RETURN s.id AS id, s.title AS title, s.discovered_via AS discovered_via ORDER BY id`);
    return {
      result: { count: rows.length, screens: rows },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
export const findDeadEnds = defineTool({
  name: 'find_dead_ends',
  title: 'Dead-end screens',
  description:
    'Screens with no way forward: no outbound link or button (no outbound NAVIGATES_TO edge). Users must use the browser back button.',
  input: {},
  async run(g) {
    const rows = await g.read<{
      id: string;
      title: string;
      in_degree: number;
    }>(`MATCH (s:Screen) WHERE NOT (s)-[:NAVIGATES_TO]->()
       OPTIONAL MATCH (x:Screen)-[i:NAVIGATES_TO]->(s)
       RETURN s.id AS id, s.title AS title, count(i) AS in_degree ORDER BY id`);
    return {
      result: { count: rows.length, screens: rows },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
const ranked = (
  rows: {
    id: string;
    title: string;
    score: number;
  }[],
) =>
  rows.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    title: r.title,
    score: Number(r.score.toFixed(6)),
  }));
export const betweenness = defineTool({
  name: 'betweenness',
  title: 'Betweenness centrality',
  description:
    'Screens that many shortest click paths pass through (FalkorDB algo.betweenness, directed). High scores mark bottlenecks: if they are slow or broken, many journeys suffer. Defaults to the flow graph (no shared header/footer links), where checkout steps and the cart stand out.',
  input: { edge_set: edgeSet.default('flow'), top: topN.default(10) },
  async run(g, { edge_set, top }) {
    const sampling = Math.max(1000, (await screenCount(g)) * 4);
    const rows = await g.read<{
      id: string;
      title: string;
      score: number;
    }>(`CALL algo.betweenness({nodeLabels: ['Screen'], relationshipTypes: ['${REL[edge_set]}'],
                              samplingSize: ${sampling}, samplingSeed: 1})
       YIELD node, score
       RETURN node.id AS id, node.title AS title, score
       ORDER BY score DESC, id
       LIMIT ${top}`);
    return {
      result: { edge_set, ranking: ranked(rows) },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
export const pagerank = defineTool({
  name: 'pagerank',
  title: 'PageRank',
  description:
    'Screens that collect the most link weight (FalkorDB algo.pageRank, directed). High scores mark the screens users are most likely to end up on. Defaults to the flow graph (no shared header/footer links).',
  input: { edge_set: edgeSet.default('flow'), top: topN.default(10) },
  async run(g, { edge_set, top }) {
    const rows = await g.read<{
      id: string;
      title: string;
      score: number;
    }>(`CALL algo.pageRank('Screen', '${REL[edge_set]}')
       YIELD node, score
       RETURN node.id AS id, node.title AS title, score
       ORDER BY score DESC, id
       LIMIT ${top}`);
    return {
      result: { edge_set, ranking: ranked(rows) },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
export const communities = defineTool({
  name: 'communities',
  title: 'Screen communities',
  description:
    'Groups of screens that link mostly to each other (FalkorDB algo.labelPropagation), e.g. a checkout funnel or a product area. Defaults to the flow graph; on the full graph shared header/footer links usually merge everything into one group. Group numbers can change between runs.',
  input: { edge_set: edgeSet.default('flow') },
  async run(g, { edge_set }) {
    const rows = await g.read<{
      community: number;
      id: string;
      path: string;
      title: string;
    }>(`CALL algo.labelPropagation({nodeLabels: ['Screen'], relationshipTypes: ['${REL[edge_set]}'], maxIterations: 20})
       YIELD node, communityId
       RETURN communityId AS community, node.id AS id, node.path AS path, node.title AS title
       ORDER BY community, id`);
    const groups = new Map<
      number,
      {
        id: string;
        path: string;
        title: string;
      }[]
    >();
    for (const r of rows) {
      groups.set(r.community, [
        ...(groups.get(r.community) ?? []),
        { id: r.id, path: r.path, title: r.title },
      ]);
    }
    const list = [...groups.values()]
      .sort((a, b) => b.length - a.length || (a[0]?.id ?? '').localeCompare(b[0]?.id ?? ''))
      .map((screens, i) => ({ community: i + 1, size: screens.length, screens }));
    return {
      result: { edge_set, count: list.length, communities: list },
      screens: rows.map((r) => r.id),
      edges: [],
    };
  },
});
export const componentFanout = defineTool({
  name: 'component_fanout',
  title: 'Where a component appears',
  description:
    'Every screen that contains a design system component (by data-component name, e.g. "SignInButton"), and the issues attached to that component. Shows how far one component fix reaches.',
  input: {
    component: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'component names are letters, digits, "-" or "_"')
      .describe('Design system component name, e.g. "SignInButton" or "FormField"'),
  },
  async run(g, { component }) {
    const exists = await g.read<{
      n: number;
    }>('MATCH (d:DesignSystemComponent {name: $name}) RETURN count(d) AS n', { name: component });
    if ((exists[0]?.n ?? 0) === 0) throw notFound(`Unknown component: ${component}`);
    const screens = await g.read<{
      id: string;
      title: string;
      instances: number;
    }>(
      `MATCH (:DesignSystemComponent {name: $name})<-[:INSTANCE_OF]-(c:Component)<-[:CONTAINS]-(s:Screen)
       RETURN s.id AS id, s.title AS title, count(c) AS instances ORDER BY id`,
      { name: component },
    );
    const issues = await g.read<{
      id: string;
      rule_id: string;
      severity: string;
      help: string;
      screen_count: number;
      screens: string[];
    }>(
      `MATCH (i:Issue)-[:IN_COMPONENT]->(:DesignSystemComponent {name: $name})
       OPTIONAL MATCH (i)-[:FOUND_ON]->(s:Screen)
       RETURN i.id AS id, i.rule_id AS rule_id, i.severity AS severity, i.help AS help,
              count(DISTINCT s) AS screen_count, collect(DISTINCT s.id) AS screens
       ORDER BY screen_count DESC, rule_id`,
      { name: component },
    );
    return {
      result: { component, screen_count: screens.length, screens, issues },
      screens: screens.map((s) => s.id),
      edges: [],
    };
  },
});
export const issuesByComponent = defineTool({
  name: 'issues_by_component',
  title: 'Issues by component',
  description:
    'Design system components ranked by how many issues they carry, then by how many screens those issues affect. The top rows are "fix once, fix everywhere" candidates.',
  input: {},
  async run(g) {
    const rows = await g.read<{
      component: string;
      issues: number;
      screens: number;
      screen_ids: string[];
      rules: string[];
    }>(`MATCH (i:Issue)-[:IN_COMPONENT]->(d:DesignSystemComponent)
       OPTIONAL MATCH (i)-[:FOUND_ON]->(s:Screen)
       RETURN d.name AS component, count(DISTINCT i) AS issues, count(DISTINCT s) AS screens,
              collect(DISTINCT s.id) AS screen_ids, collect(DISTINCT i.rule_id) AS rules
       ORDER BY issues DESC, screens DESC, component`);
    const ranking = rows.map((r, i) => ({
      rank: i + 1,
      component: r.component,
      issues: r.issues,
      screens: r.screens,
      rules: [...r.rules].sort(),
      screen_ids: [...r.screen_ids].sort(),
    }));
    return {
      result: { ranking },
      screens: [...new Set(rows.flatMap((r) => r.screen_ids))].sort(),
      edges: [],
    };
  },
});
interface TaskRow {
  id: string;
  name: string;
  clicks: number;
  start: string | null;
  end: string | null;
}
export const compareTask = defineTool({
  name: 'compare_task',
  title: 'Forced journey versus shortest path',
  description:
    'For each recorded task (e.g. "Buy a product"), compares the journey the app forces on users (replayed by the explorer, one click per step) with the shortest path over all links. Returns forced_clicks, the forced path, the shortest path and its length, and the detour (forced minus shortest). State-only clicks such as an "Add to cart" that stays on the page count in forced_clicks but create no graph edge, so they never appear in the shortest path.',
  input: {
    task: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'task ids are lowercase words joined by "-"')
      .optional()
      .describe('Task id, e.g. "buy-a-product". Leave out to compare every task.'),
  },
  async run(g, { task }, ctx) {
    const tasks = await g.read<TaskRow>(
      `MATCH (t:Task)
       ${task ? 'WHERE t.id = $task' : ''}
       OPTIONAL MATCH (t)-[:STARTS_AT]->(s:Screen)
       OPTIONAL MATCH (t)-[:ENDS_AT]->(e:Screen)
       RETURN t.id AS id, t.name AS name, t.clicks AS clicks, s.id AS start, e.id AS end
       ORDER BY id`,
      task ? { task } : undefined,
    );
    if (task && tasks.length === 0) throw notFound(`Unknown task: ${task}`);
    const screens = new Set<string>();
    const edges = new Set<string>();
    const results = [];
    for (const t of tasks) {
      if (!t.start || !t.end) continue;
      const visits = await g.read<{
        order: number;
        action: string;
        screen: string;
      }>(
        `MATCH (:Task {id: $id})-[v:VISITS]->(s:Screen)
         RETURN v.order AS order, v.action AS action, s.id AS screen ORDER BY order`,
        { id: t.id },
      );
      let at = t.start;
      const forced = visits.map((v) => {
        const step = {
          order: v.order,
          action: v.action,
          from: at,
          to: v.screen,
          moved: v.screen !== at,
        };
        at = v.screen;
        return step;
      });
      const shortest = await shortestPath.run(
        g,
        { from: t.start, to: t.end, edge_set: 'all' },
        ctx,
      );
      const shortestLength = (
        shortest.result as {
          length: number | null;
        }
      ).length;
      screens.add(t.start);
      for (const s of forced) {
        screens.add(s.to);
        if (s.moved) edges.add(edgeId(s.from, s.to));
      }
      shortest.screens.forEach((s) => screens.add(s));
      shortest.edges.forEach((e) => edges.add(e));
      results.push({
        id: t.id,
        name: t.name,
        start: t.start,
        end: t.end,
        forced_clicks: t.clicks,
        forced_path: forced,
        shortest: shortest.result,
        detour: shortestLength === null ? null : t.clicks - shortestLength,
      });
    }
    return { result: { tasks: results }, screens: [...screens], edges: [...edges] };
  },
});
