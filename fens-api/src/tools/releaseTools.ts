import { z } from 'zod';
import { openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { collectRelease, type Release } from '../releases/collect.js';
import { badRequest } from '../http/errors.js';
import { defineTool } from './types.js';
export const GRAPH_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const delta = (from: number, to: number) => ({ from, to, delta: to - from });
export function diffOf(from: Release, to: Release) {
  const fixed = [...from.issues.values()]
    .filter((i) => !to.issues.has(i.key))
    .map((i) => ({
      key: i.key,
      rule_id: i.rule_id,
      severity: i.severity,
      help: i.help,
      component: i.component,
      screens: i.screens,
    }));
  const newIssues = [...to.issues.values()]
    .filter((i) => !from.issues.has(i.key))
    .map((i) => ({
      key: i.key,
      rule_id: i.rule_id,
      severity: i.severity,
      help: i.help,
      component: i.component,
      screens: i.screens,
    }));
  const unchanged = [...to.issues.values()]
    .filter((i) => from.issues.has(i.key))
    .map((i) => ({
      key: i.key,
      rule_id: i.rule_id,
      severity_from: from.issues.get(i.key)?.severity ?? null,
      severity_to: i.severity,
      help: i.help,
      component: i.component,
    }));
  const resolved = [...from.findings.values()]
    .filter((f) => !to.findings.has(f.key))
    .map((f) => ({
      id: f.id,
      key: f.key,
      title: f.title,
      severity: f.severity,
      github_issue_url: f.github_issue_url,
      linear_issue_url: f.linear_issue_url,
      figma_comment_url: f.figma_comment_url,
      channel_status: f.channel_status,
    }));
  const newFindings = [...to.findings.values()]
    .filter((f) => !from.findings.has(f.key))
    .map((f) => ({ key: f.key, title: f.title, severity: f.severity }));
  const persisting = [...to.findings.values()]
    .filter((f) => from.findings.has(f.key))
    .map((f) => ({
      key: f.key,
      title: f.title,
      severity_from: from.findings.get(f.key)?.severity ?? null,
      severity_to: f.severity,
    }));
  const fromScreens = new Set(from.screens);
  const toScreens = new Set(to.screens);
  const added = to.screens.filter((s) => !fromScreens.has(s));
  const removed = from.screens.filter((s) => !toScreens.has(s));
  const taskNames = [...new Set([...from.tasks.keys(), ...to.tasks.keys()])].sort();
  const tasks = taskNames.map((name) => ({
    name,
    forced: { from: from.tasks.get(name)?.forced ?? null, to: to.tasks.get(name)?.forced ?? null },
    shortest: {
      from: from.tasks.get(name)?.shortest ?? null,
      to: to.tasks.get(name)?.shortest ?? null,
    },
  }));
  const sumForced = (r: Release) => [...r.tasks.values()].reduce((n, t) => n + t.forced, 0);
  const sumShortest = (r: Release) =>
    [...r.tasks.values()].reduce((n, t) => n + (t.shortest ?? 0), 0);
  const changed = new Set<string>([
    ...added,
    ...removed,
    ...fixed.flatMap((i) => i.screens),
    ...newIssues.flatMap((i) => i.screens),
    ...from.orphans.filter((s) => !to.orphans.includes(s)),
    ...to.orphans.filter((s) => !from.orphans.includes(s)),
    ...from.deadEnds.filter((s) => !to.deadEnds.includes(s)),
    ...to.deadEnds.filter((s) => !from.deadEnds.includes(s)),
  ]);
  const healthDelta = delta(from.health.score, to.health.score);
  return {
    from: from.graph,
    to: to.graph,
    health: {
      from: from.health,
      to: to.health,
      delta: healthDelta.delta,
      note: 'Illustrative health score: see releases/health.ts for the weights.',
    },
    metrics: {
      orphans: delta(from.orphans.length, to.orphans.length),
      deadEnds: delta(from.deadEnds.length, to.deadEnds.length),
      forcedClicks: delta(sumForced(from), sumForced(to)),
      shortestPath: delta(sumShortest(from), sumShortest(to)),
      issuesBySeverity: { from: from.issuesBySeverity, to: to.issuesBySeverity },
      extraClicks: delta(from.extraClicks, to.extraClicks),
    },
    issues: { fixed, new: newIssues, unchanged },
    findings: { resolved, new: newFindings, persisting },
    screens: { added, removed },
    tasks,
    changed_screens: [...changed].sort(),
  };
}
export const diffReleases = defineTool({
  name: 'diff_releases',
  title: 'Compare two releases',
  description:
    'Compares an older release (from_graph) with the newer one (the graph this tool runs on, given as "graph"). Lists issues fixed, new and unchanged (matched by issue key); findings resolved, new and persisting (matched by finding key); screens added and removed; task clicks and shortest paths; orphan, dead-end and issue counts; and an illustrative health score for each release. Use it to tell whether a change helped or hurt the app.',
  input: {
    from_graph: z
      .string()
      .max(64)
      .regex(GRAPH_NAME, 'graph names are lowercase letters, digits, "-" and "_"')
      .describe('The older release, e.g. "demo-shop-v1"'),
  },
  async run(g: ReadOnlyGraph, { from_graph }, { graph }) {
    if (from_graph === graph)
      throw badRequest('from_graph and the graph must be different releases');
    const older = await openGraph(from_graph);
    const from = await collectRelease(older, from_graph);
    const to = await collectRelease(g, graph);
    const out = diffOf(from, to);
    return {
      result: out,
      screens: out.changed_screens,
      edges: [] as string[],
    };
  },
});
