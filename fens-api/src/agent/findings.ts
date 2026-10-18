import type { ReadOnlyGraph } from '../graph/db.js';
import { recordOf, type ChannelRecord } from '../integrations/record.js';
import type { Evidence, FindingOrigin } from './types.js';
const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
export interface FindingRow {
  id: string;
  key: string;
  title: string;
  severity: string;
  category: string;
  explanation: string;
  recommendation: string;
  mode: string;
  origin: FindingOrigin;
  agent: 'ux' | 'seo';
  created_at: string;
  updated_at: string | null;
  github_issue_url: string | null;
  linear_issue_url: string | null;
  figma_comment_url: string | null;
  stale: boolean;
  closed_at: string | null;
  closed_in: string | null;
  channels: ChannelRecord;
  target: {
    type: string;
    id: string;
  } | null;
  evidence: Evidence[];
}
type Props = Record<string, unknown>;
function toRow(p: Props, label: string | null, targetId: string | null): FindingRow {
  let evidence: Evidence[] = [];
  try {
    evidence = JSON.parse(String(p.evidence ?? '[]')) as Evidence[];
  } catch {
    evidence = [];
  }
  const type =
    label === 'DesignSystemComponent'
      ? 'component'
      : label === 'Task'
        ? 'task'
        : label === 'Screen'
          ? 'screen'
          : null;
  return {
    id: String(p.id),
    key: String(p.key),
    title: String(p.title),
    severity: String(p.severity),
    category: String(p.category),
    explanation: String(p.explanation),
    recommendation: String(p.recommendation),
    mode: String(p.mode),
    origin: (p.origin as FindingOrigin) ?? (p.mode === 'rules' ? 'rules' : 'ai'),
    agent: p.agent === 'seo' ? 'seo' : 'ux',
    created_at: String(p.created_at),
    updated_at: (p.updated_at as string) ?? null,
    github_issue_url: (p.github_issue_url as string) ?? null,
    linear_issue_url: (p.linear_issue_url as string) ?? null,
    figma_comment_url: (p.figma_comment_url as string) ?? null,
    stale: p.stale === true,
    closed_at: (p.closed_at as string) ?? null,
    closed_in: (p.closed_in as string) ?? null,
    channels: recordOf(p),
    target: type && targetId ? { type, id: targetId } : null,
    evidence,
  };
}
const TARGET = `OPTIONAL MATCH (f)-[:ABOUT]->(t)
  RETURN properties(f) AS p, labels(t)[0] AS label, coalesce(t.id, t.name) AS target`;
export async function listFindings(g: ReadOnlyGraph): Promise<FindingRow[]> {
  const rows = await g.read<{
    p: Props;
    label: string | null;
    target: string | null;
  }>(`MATCH (f:Finding) ${TARGET}`);
  return rows
    .map((r) => toRow(r.p, r.label, r.target))
    .sort(
      (a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3) || a.title.localeCompare(b.title),
    );
}
export async function getFinding(g: ReadOnlyGraph, id: string) {
  const rows = await g.read<{
    p: Props;
    label: string | null;
    target: string | null;
  }>(`MATCH (f:Finding {id: $id}) ${TARGET}`, { id });
  const first = rows[0];
  if (!first) return null;
  const finding = toRow(first.p, first.label, first.target);
  const issues = await g.read<{
    id: string;
    rule_id: string;
    severity: string;
    help: string;
    help_url: string;
  }>(
    `MATCH (:Finding {id: $id})-[:BASED_ON]->(i:Issue)
     RETURN i.id AS id, i.rule_id AS rule_id, i.severity AS severity, i.help AS help, i.help_url AS help_url`,
    { id },
  );
  return { ...finding, issues };
}
