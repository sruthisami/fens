import { Octokit } from 'octokit';
import { env } from '../config/env.js';
import { openFindingWriter } from '../graph/db.js';
import { badRequest, HttpError } from '../http/errors.js';
import type { ReadOnlyGraph } from '../graph/db.js';
import { assignAfterCreate, confirmedAssignee, suggestionText } from '../history/assign.js';
import type { DecisionRecord } from './decide.js';
export interface IssuePreview {
  title: string;
  body: string;
  labels: string[];
}
export function assertIssuable(d: DecisionRecord): void {
  if (d.outcome !== 'approved' && d.outcome !== 'reconciled')
    throw badRequest(
      `Only approved or reconciled decisions become GitHub issues; this one is ${d.outcome}${d.outcome === 'needs_human' ? ' (marked for a person)' : ''}.`,
    );
}
export async function decisionIssuePreview(
  g: ReadOnlyGraph,
  d: DecisionRecord,
): Promise<IssuePreview> {
  const sim =
    d.simulations.find((s) => s.playbook === (d.playbook?.id ?? null)) ?? d.simulations[0];
  const change = sim?.change ?? { type: d.change_type, params: {} };
  const parts = (sim?.parts ?? []).map(
    (p) =>
      `| ${p.lens.toUpperCase()} | ${p.label} | ${p.before} | ${p.after} | ${p.delta > 0 ? '+' : ''}${p.delta} |`,
  );
  const body = [
    `**Outcome:** ${d.outcome}${d.playbook ? ` with the playbook "${d.playbook.name}"` : ''}${d.precedent ? ' · follows a precedent' : ''}`,
    '',
    `**Proposal (${d.agent} agent):** ${d.proposal_title}`,
    '',
    '## Change to make',
    `\`${change.type}\` ${JSON.stringify(change.params)}`,
    '',
    '## Simulated lens scores (copy of the graph)',
    '| Lens | Before | After |',
    '| --- | --- | --- |',
    `| UX | ${d.ux_before} | ${d.ux_after} |`,
    `| SEO | ${d.seo_before} | ${d.seo_after} |`,
    '',
    ...(parts.length
      ? [
          '| Lens | Part (penalty points) | Before | After | Gain |',
          '| --- | --- | --- | --- | --- |',
          ...parts,
          '',
        ]
      : []),
    '## Rationale',
    d.rationale,
    '',
    `Affected screens: ${d.screens.map((s) => `\`${s}\``).join(', ') || 'none'}`,
    '',
    await suggestionText(g, { decision_id: d.id }),
    '',
    `_Decided by FlowLens (${d.mode} mode, decision \`${d.id}\`)._`,
  ].join('\n');
  const labels = ['flowlens', 'decision', `outcome:${d.outcome}`, `change:${change.type}`];
  return {
    title: `[FlowLens] ${d.outcome === 'reconciled' ? 'Reconciled' : 'Approved'}: ${d.proposal_title}`,
    body,
    labels,
  };
}
export async function createDecisionIssue(
  graph: string,
  g: ReadOnlyGraph,
  d: DecisionRecord,
  assignee?: string,
): Promise<{
  url: string;
  assigned: boolean;
  assign_note?: string;
}> {
  assertIssuable(d);
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN)
    throw badRequest(
      'GITHUB_REPO and GITHUB_TOKEN must be set in fens-api/.env to create issues. The preview works without them.',
    );
  if (d.github_issue_url)
    throw new HttpError(409, `An issue already exists for this decision: ${d.github_issue_url}`);
  const [owner, repo] = env.GITHUB_REPO.split('/') as [string, string];
  const login = await confirmedAssignee(g, { decision_id: d.id }, assignee);
  const preview = await decisionIssuePreview(g, d);
  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  let url: string;
  let issueNumber: number;
  try {
    const { data } = await octokit.rest.issues.create({
      owner,
      repo,
      title: preview.title,
      body: preview.body,
      labels: preview.labels,
    });
    url = data.html_url;
    issueNumber = data.number;
  } catch (err) {
    const status = (
      err as {
        status?: number;
      }
    ).status;
    throw new HttpError(
      status === 404 || status === 403 || status === 401 ? 400 : 502,
      `GitHub returned an error${status ? ` (${status})` : ''} while creating the issue.`,
    );
  }
  const w = await openFindingWriter(graph);
  await w.write('MATCH (d:Decision {id: $id}) SET d.github_issue_url = $url', { id: d.id, url });
  return { url, ...(await assignAfterCreate(octokit, owner, repo, issueNumber, login)) };
}
