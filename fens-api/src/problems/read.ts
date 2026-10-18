import { listFindings } from '../agent/findings.js';
import { listProposals } from '../agent/proposals.js';
import { listDecisions } from '../decider/decide.js';
import type { ReadOnlyGraph } from '../graph/db.js';
import { buildProblems, type ProblemIssue } from './build.js';

export async function readProblems(g: ReadOnlyGraph) {
  const [findings, proposals, decisions, issues, basedOn] = await Promise.all([
    listFindings(g),
    listProposals(g),
    listDecisions(g),
    g.read<ProblemIssue>(
      `MATCH (i:Issue)-[:FOUND_ON]->(s:Screen)
       WITH i, collect(DISTINCT s.id) AS screens
       OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
       WITH i, screens, collect(DISTINCT gl.lens) AS lenses
       OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
       RETURN i.id AS id, i.key AS key, i.rule_id AS rule_id, i.source AS source,
              i.severity AS severity, i.help AS help, lenses, d.name AS component, screens`,
    ),
    g.read<{ f: string; issues: string[] }>(
      `MATCH (f:Finding)-[:BASED_ON]->(i:Issue) RETURN f.id AS f, collect(DISTINCT i.id) AS issues`,
    ),
  ]);
  const issuesOf = new Map(basedOn.map((r) => [r.f, r.issues]));
  return buildProblems({
    findings: findings.map((f) => ({
      ...f,
      issue_ids: issuesOf.get(f.id) ?? [],
      sent: Boolean(f.github_issue_url || f.linear_issue_url || f.figma_comment_url),
    })),
    issues: issues.map((i) => ({ ...i, screens: [...i.screens].sort() })),
    proposals,
    decisions,
  });
}
