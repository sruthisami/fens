import { channelStatus, recordOf } from '../integrations/record.js';
import type { ReadOnlyGraph } from '../graph/db.js';
import { compareTask } from '../tools/graphTools.js';
import { healthScore, type HealthBreakdown } from './health.js';
export interface ReleaseIssue {
  key: string;
  id: string;
  rule_id: string;
  severity: string;
  help: string;
  component: string | null;
  screens: string[];
}
export interface ReleaseFinding {
  key: string;
  id: string;
  title: string;
  severity: string;
  github_issue_url: string | null;
  linear_issue_url: string | null;
  figma_comment_url: string | null;
  channel_status: {
    github: string;
    linear: string;
    figma: string;
  };
}
export interface ReleaseTask {
  id: string;
  name: string;
  forced: number;
  shortest: number | null;
}
export interface Release {
  graph: string;
  screens: string[];
  orphans: string[];
  deadEnds: string[];
  issues: Map<string, ReleaseIssue>;
  findings: Map<string, ReleaseFinding>;
  tasks: Map<string, ReleaseTask>;
  issuesBySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  extraClicks: number;
  health: {
    score: number;
    breakdown: HealthBreakdown[];
  };
}
const SEVERITY_KEYS = ['critical', 'serious', 'moderate', 'minor'] as const;
export async function collectRelease(g: ReadOnlyGraph, graph: string): Promise<Release> {
  const screens = (
    await g.read<{
      id: string;
    }>('MATCH (s:Screen) RETURN s.id AS id ORDER BY id')
  ).map((r) => r.id);
  const orphans = (
    await g.read<{
      id: string;
    }>('MATCH (s:Screen) WHERE NOT ()-[:NAVIGATES_TO]->(s) RETURN s.id AS id ORDER BY id')
  ).map((r) => r.id);
  const deadEnds = (
    await g.read<{
      id: string;
    }>('MATCH (s:Screen) WHERE NOT (s)-[:NAVIGATES_TO]->() RETURN s.id AS id ORDER BY id')
  ).map((r) => r.id);
  const issueRows = await g.read<{
    key: string;
    id: string;
    rule_id: string;
    severity: string;
    help: string;
    component: string | null;
    screens: string[];
    lenses: string[];
  }>(`MATCH (i:Issue)
     OPTIONAL MATCH (i)-[:FOUND_ON]->(s:Screen)
     OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
     OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
     RETURN i.key AS key, i.id AS id, i.rule_id AS rule_id, i.severity AS severity, i.help AS help,
            d.name AS component, collect(DISTINCT s.id) AS screens, collect(DISTINCT gl.lens) AS lenses`);
  const issues = new Map<string, ReleaseIssue>();
  const uxKeys = new Set(
    issueRows.filter((r) => r.lenses.length === 0 || r.lenses.includes('UX')).map((r) => r.key),
  );
  for (const r of issueRows) {
    if (!r.key) continue;
    issues.set(r.key, {
      key: r.key,
      id: r.id,
      rule_id: r.rule_id,
      severity: r.severity,
      help: r.help,
      screens: (r.screens ?? []).filter(Boolean).sort(),
      component: r.component ?? null,
    });
  }
  const findingRows = await g.read<{
    key: string;
    id: string;
    title: string;
    severity: string;
    p: Record<string, unknown>;
  }>(`MATCH (f:Finding) WHERE f.stale IS NULL OR f.stale = false
     RETURN f.key AS key, f.id AS id, f.title AS title, f.severity AS severity, properties(f) AS p`);
  const findings = new Map<string, ReleaseFinding>();
  for (const { p, ...r } of findingRows) {
    const rec = recordOf(p);
    findings.set(r.key, {
      ...r,
      github_issue_url: rec.github?.url ?? null,
      linear_issue_url: rec.linear?.url ?? null,
      figma_comment_url: rec.figma?.url ?? null,
      channel_status: channelStatus(rec),
    });
  }
  const comparison = await compareTask.run(g, {} as never, { graph });
  const taskRows = (
    comparison.result as {
      tasks: {
        id: string;
        name: string;
        forced_clicks: number;
        shortest: {
          length: number | null;
        };
      }[];
    }
  ).tasks;
  const tasks = new Map<string, ReleaseTask>();
  let extraClicks = 0;
  for (const t of taskRows) {
    const shortest = t.shortest.length;
    tasks.set(t.name, { id: t.id, name: t.name, forced: t.forced_clicks, shortest });
    if (shortest !== null) extraClicks += Math.max(0, t.forced_clicks - shortest);
  }
  const issuesBySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const uxIssuesBySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const i of issues.values()) {
    const k = SEVERITY_KEYS.find((s) => s === i.severity);
    if (!k) continue;
    issuesBySeverity[k] += 1;
    if (uxKeys.has(i.key)) uxIssuesBySeverity[k] += 1;
  }
  return {
    graph,
    screens,
    orphans,
    deadEnds,
    issues,
    findings,
    tasks,
    issuesBySeverity,
    extraClicks,
    health: healthScore({
      issuesBySeverity: uxIssuesBySeverity,
      orphans: orphans.length,
      deadEnds: deadEnds.length,
      extraClicks,
    }),
  };
}
