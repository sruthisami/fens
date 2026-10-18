import { LinearClient, LinearErrorType } from '@linear/sdk';
import { env } from '../config/env.js';
import type { FindingRow } from '../agent/findings.js';
import type { DecisionRecord } from '../decider/decide.js';
import { debateFor, debateMarkdown, isContested } from '../decider/debate.js';
import { openFindingWriter, type ReadOnlyGraph } from '../graph/db.js';
import { suggestionText } from '../history/assign.js';
import { badRequest, HttpError } from '../http/errors.js';
import { buildCommonPayload, dashboardLink, linksBlock } from './payload.js';
import { linearIdentifier, type ChannelRecord } from './record.js';
export type LinearApi = Pick<
  LinearClient,
  | 'viewer'
  | 'organization'
  | 'teams'
  | 'issueLabels'
  | 'createIssueLabel'
  | 'createIssue'
  | 'deleteIssue'
  | 'archiveIssue'
  | 'issue'
  | 'createComment'
  | 'updateIssue'
>;
export function linearClient(): LinearApi {
  if (!env.LINEAR_API_KEY) throw badRequest(NOT_SET);
  return new LinearClient({ apiKey: env.LINEAR_API_KEY });
}
export const LABELS = [
  { name: 'flowlens', color: '#5E6AD2', description: 'Created by FlowLens' },
  { name: 'ux', color: '#26B5CE', description: 'FlowLens UX lens' },
  { name: 'seo', color: '#4CB782', description: 'FlowLens SEO and AEO lens' },
  { name: 'content', color: '#F2994A', description: 'FlowLens content finding' },
] as const;
type LabelName = (typeof LABELS)[number]['name'];
export const PRIORITY: Record<string, number> = { high: 2, medium: 3, low: 4 };
const PRIORITY_NAME: Record<number, string> = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
export interface LinearPreview {
  configured: boolean;
  team_id: string | null;
  title: string;
  description: string;
  labels: string[];
  priority: number;
  priority_name: string;
  link: string;
}
const NOT_SET =
  'Linear is not set up: add LINEAR_API_KEY and LINEAR_TEAM_ID to fens-api/.env (npm run linear:check lists the team ids). The preview works without them.';
export function scrub(text: string): string {
  let out = text.replace(/lin_(api|oauth)_[A-Za-z0-9]+/g, '<LINEAR_API_KEY>');
  if (env.LINEAR_API_KEY) out = out.split(env.LINEAR_API_KEY).join('<LINEAR_API_KEY>');
  return out;
}
export function linearHttpError(err: unknown, action: string): HttpError {
  if (err instanceof HttpError) return err;
  const e = err as {
    type?: string;
    message?: string;
    retryAfter?: number;
  };
  const detail = scrub(String(e?.message ?? '')).slice(0, 160);
  switch (e?.type) {
    case LinearErrorType.AuthenticationError:
      return new HttpError(
        401,
        `Linear authentication failed while ${action}: LINEAR_API_KEY was rejected. Create a new personal API key in Linear (Settings, Security & access, Personal API keys) and run npm run linear:check.`,
      );
    case LinearErrorType.Forbidden:
    case LinearErrorType.FeatureNotAccessible:
    case LinearErrorType.UsageLimitExceeded:
      return new HttpError(
        403,
        `Linear refused ${action}: the key is missing a permission (${detail || e.type}). Give the key read and write access (issues, comments, labels) to the team.`,
      );
    case LinearErrorType.Ratelimited:
      return new HttpError(
        429,
        `Linear rate limit reached while ${action}${e.retryAfter ? `; try again in ${e.retryAfter} s` : '; try again in a minute'}.`,
      );
    case LinearErrorType.NetworkError:
      return new HttpError(502, `Linear could not be reached while ${action}.`);
  }
  if (/entity not found|team/i.test(detail))
    return new HttpError(
      404,
      `Linear team not found while ${action}: LINEAR_TEAM_ID is not a team this key can see. Run npm run linear:check to list the teams.`,
    );
  return new HttpError(
    502,
    `Linear returned an error while ${action}${detail ? `: ${detail}` : ''}.`,
  );
}
export function assertLinearFinding(f: FindingRow): void {
  if (f.category !== 'content')
    throw badRequest(
      `Linear issues are for non-code work: content findings only (this one is ${f.category}). Use GitHub for code changes.`,
    );
}
export function assertLinearDecision(d: Pick<DecisionRecord, 'outcome' | 'simulations'>): void {
  if (!isContested(d))
    throw badRequest(
      `Linear issues are for contested proposals (the proposal makes a lens worse) that need discussion; this one is ${d.outcome} and no lens gets worse.`,
    );
}
export function findingLabels(f: Pick<FindingRow, 'category' | 'agent'>): LabelName[] {
  const names = LABELS.map((l) => l.name) as string[];
  return ['flowlens', (names.includes(f.category) ? f.category : f.agent) as LabelName];
}
export const findingLink = dashboardLink;
export type StepActions = Record<string, string>;
async function pathActions(g: ReadOnlyGraph, f: FindingRow): Promise<StepActions> {
  const pairs = f.evidence.flatMap((e) =>
    e.path.slice(1).map((to, i) => ({ from: e.path[i] as string, to })),
  );
  if (pairs.length === 0) return {};
  const rows = await g.read<{
    from: string;
    to: string;
    action: string;
  }>(
    `UNWIND $pairs AS p
     MATCH (a:Screen {id: p.from})-[r:NAVIGATES_TO]->(b:Screen {id: p.to})
     RETURN p.from AS from, p.to AS to, collect(r.action)[0] AS action`,
    { pairs },
  );
  return Object.fromEntries(rows.map((r) => [`${r.from} -> ${r.to}`, r.action]));
}
const code = (s: string) => `\`${s}\``;
export function findingDescription(
  graph: string,
  f: FindingRow,
  actions: StepActions,
  suggestion: string,
  rec: ChannelRecord = f.channels,
): string {
  const common = buildCommonPayload(graph, f);
  const paths = f.evidence
    .filter((e) => e.path.length > 1)
    .map((e) => [
      `**${e.tool}** path:`,
      ...e.path.slice(1).map((to, i) => {
        const from = e.path[i] as string;
        const action = actions[`${from} -> ${to}`];
        return `${i + 1}. ${code(from)} → ${code(to)}${action ? ` via "${action}"` : ''}`;
      }),
    ]);
  return [
    `**${common.headline}**`,
    '',
    common.explanation,
    '',
    '## Evidence',
    ...(common.evidence.length ? common.evidence.map((l) => `- ${l}`) : ['- none recorded']),
    ...paths.flatMap((lines) => ['', ...lines]),
    '',
    '## Recommendation',
    common.recommendation,
    '',
    `${suggestion} Nobody is assigned automatically.`,
    '',
    `[Open this finding in FlowLens](${common.link})`,
    '',
    linksBlock(rec, 'linear', common.link),
    '',
    `_From FlowLens: finding ${code(f.id)}, graph ${code(graph)}._`,
  ].join('\n');
}
const configured = () => !!(env.LINEAR_API_KEY && env.LINEAR_TEAM_ID);
export async function findingLinearPreview(
  graph: string,
  g: ReadOnlyGraph,
  f: FindingRow,
  rec: ChannelRecord = f.channels,
): Promise<LinearPreview> {
  assertLinearFinding(f);
  const priority = PRIORITY[f.severity] ?? 3;
  return {
    configured: configured(),
    team_id: env.LINEAR_TEAM_ID ?? null,
    title: buildCommonPayload(graph, f).title,
    description: findingDescription(
      graph,
      f,
      await pathActions(g, f),
      await suggestionText(g, { finding_id: f.id }),
      rec,
    ),
    labels: findingLabels(f),
    priority,
    priority_name: PRIORITY_NAME[priority] ?? 'Medium',
    link: findingLink(graph, f.id),
  };
}
export async function decisionLinearPreview(
  graph: string,
  g: ReadOnlyGraph,
  d: DecisionRecord,
): Promise<LinearPreview> {
  assertLinearDecision(d);
  const link = `${env.ALLOWED_ORIGIN}/?graph=${encodeURIComponent(graph)}&decision=${d.id}`;
  const debate = await debateFor(g, d);
  const outcome =
    d.outcome === 'needs_human'
      ? 'The decider could not reconcile it: a person has to weigh it.'
      : d.outcome === 'reconciled'
        ? `The decider reconciled it with the playbook "${d.playbook?.name ?? ''}"; raised here to agree on the compromise.`
        : `The decider marked it ${d.outcome}; raised here because one lens gets worse.`;
  return {
    configured: configured(),
    team_id: env.LINEAR_TEAM_ID ?? null,
    title: `[FlowLens] ${d.outcome === 'needs_human' ? 'Needs a decision' : 'UX vs SEO'}: ${d.proposal_title}`,
    description: [
      `**UX vs SEO on a proposed change (${d.change_type}).** ${outcome}`,
      '',
      ...debateMarkdown(debate),
      `Decision: UX ${d.ux_before} to ${d.ux_after}, SEO ${d.seo_before} to ${d.seo_after} (scores are illustrative; simulated on a copy of the graph).`,
      '',
      `Screens: ${d.screens.map(code).join(', ') || 'none'}`,
      '',
      `${await suggestionText(g, { decision_id: d.id })} Nobody is assigned automatically.`,
      '',
      `[Open this debate in FlowLens](${link})`,
      '',
      `_From FlowLens: decision ${code(d.id)}, graph ${code(graph)}._`,
    ].join('\n'),
    labels: ['flowlens', 'ux', 'seo'],
    priority: d.outcome === 'needs_human' ? 2 : 3,
    priority_name: d.outcome === 'needs_human' ? 'High' : 'Medium',
    link,
  };
}
async function labelIds(client: LinearApi, teamId: string): Promise<Map<string, string>> {
  const res = await client.issueLabels({
    first: 250,
    filter: { or: [{ team: { id: { eq: teamId } } }, { team: { null: true } }] },
  });
  const ids = new Map<string, string>();
  for (const l of res.nodes) {
    const key = l.name.toLowerCase();
    if (!ids.has(key) || l.teamId === teamId) ids.set(key, l.id);
  }
  return ids;
}
export async function ensureLabels(
  client: LinearApi,
  teamId: string,
): Promise<{
  created: string[];
  existing: string[];
}> {
  const ids = await labelIds(client, teamId);
  const created: string[] = [];
  const existing: string[] = [];
  for (const l of LABELS) {
    if (ids.has(l.name)) {
      existing.push(l.name);
      continue;
    }
    const payload = await client.createIssueLabel({ ...l, teamId });
    if (!payload.success) throw new HttpError(502, `Linear did not create the label ${l.name}.`);
    created.push(l.name);
  }
  return { created, existing };
}
export interface CreatedLinearIssue {
  url: string;
  identifier: string;
  labels: string[];
  missing_labels: string[];
  note?: string;
}
export async function sendLinearIssue(
  client: LinearApi,
  teamId: string,
  preview: LinearPreview,
): Promise<Omit<CreatedLinearIssue, 'note'>> {
  const ids = await labelIds(client, teamId);
  const found = preview.labels.filter((n) => ids.has(n));
  const missing = preview.labels.filter((n) => !ids.has(n));
  const payload = await client.createIssue({
    teamId,
    title: preview.title,
    description: preview.description,
    priority: preview.priority,
    labelIds: found.map((n) => ids.get(n) as string),
  });
  const issue = await payload.issue;
  if (!issue?.url) throw new HttpError(502, 'Linear did not return the new issue.');
  return { url: issue.url, identifier: issue.identifier, labels: found, missing_labels: missing };
}
export async function createLinearIssue(
  graph: string,
  node: {
    label: 'Finding' | 'Decision';
    id: string;
    linear_issue_url: string | null;
  },
  preview: LinearPreview,
  client?: LinearApi,
): Promise<CreatedLinearIssue> {
  if (!env.LINEAR_API_KEY || !env.LINEAR_TEAM_ID) throw badRequest(NOT_SET);
  if (node.linear_issue_url)
    throw new HttpError(409, `A Linear issue already exists: ${node.linear_issue_url}`);
  let created: Omit<CreatedLinearIssue, 'note'>;
  try {
    created = await sendLinearIssue(client ?? linearClient(), env.LINEAR_TEAM_ID, preview);
  } catch (err) {
    throw linearHttpError(err, 'creating the issue');
  }
  const w = await openFindingWriter(graph);
  await w.write(`MATCH (n:${node.label} {id: $id}) SET n.linear_issue_url = $url`, {
    id: node.id,
    url: created.url,
  });
  const missing = created.missing_labels;
  return {
    ...created,
    ...(missing.length
      ? { note: `Labels missing in the team: ${missing.join(', ')}. Run npm run linear:setup.` }
      : {}),
  };
}
export const issueIdentifier = linearIdentifier;
export async function markDone(
  client: LinearApi,
  identifier: string,
  body: string,
): Promise<string> {
  const issue = await client.issue(identifier);
  const team = await issue.team;
  if (!team) throw new HttpError(502, `Linear did not return the team of ${identifier}.`);
  const states = await team.states({ filter: { type: { eq: 'completed' } } });
  const done = [...states.nodes].sort((a, b) => a.position - b.position)[0];
  if (!done)
    throw new HttpError(400, `The Linear team ${team.key} has no completed workflow state.`);
  await client.createComment({ issueId: issue.id, body });
  await client.updateIssue(issue.id, { stateId: done.id });
  return done.name;
}
export interface CheckReport {
  ok: boolean;
  lines: string[];
  team: {
    id: string;
    key: string;
    name: string;
  } | null;
}
export async function checkLinear(
  client: LinearApi,
  teamId: string | undefined,
): Promise<CheckReport> {
  const lines: string[] = ['LINEAR_API_KEY: set (not printed)'];
  const viewer = await client.viewer;
  lines.push(`User: ${viewer.name} <${viewer.email}>`);
  const org = await client.organization;
  lines.push(`Workspace: ${org.name} (linear.app/${org.urlKey})`);
  const teams = (await client.teams({ first: 100 })).nodes.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
  }));
  lines.push(`Teams this key can see (${teams.length}):`);
  for (const t of teams)
    lines.push(
      `  ${t.id}  ${t.key.padEnd(6)} ${t.name}${t.id === teamId ? '  <- LINEAR_TEAM_ID' : ''}`,
    );
  const team = teams.find((t) => t.id === teamId) ?? null;
  let ok = true;
  if (!teamId) {
    ok = false;
    lines.push(
      teams.length === 1
        ? `LINEAR_TEAM_ID is not set. Copy this into fens-api/.env: LINEAR_TEAM_ID=${teams[0]?.id}`
        : `LINEAR_TEAM_ID is not set. Copy one of the ids above into fens-api/.env.`,
    );
  } else if (team) {
    lines.push(`LINEAR_TEAM_ID matches team ${team.key} (${team.name}).`);
  } else {
    ok = false;
    lines.push(`LINEAR_TEAM_ID (${teamId}) does not match any team this key can see.`);
  }
  return { ok, lines, team };
}
export async function writeTest(client: LinearApi, teamId: string): Promise<string[]> {
  const payload = await client.createIssue({
    teamId,
    title: '[FlowLens] setup test',
    description:
      'Created by `npm run linear:check -- --write-test` in fens-api. Removed again at once.',
  });
  const issue = await payload.issue;
  if (!payload.success || !issue) throw new Error('Linear did not return the test issue.');
  const lines = [`Write test: created ${issue.identifier} (${issue.url}).`];
  try {
    const del = await client.deleteIssue(issue.id);
    if (!del.success) throw new Error('delete was not successful');
    lines.push(`Write test: deleted ${issue.identifier} (it stays in Linear's trash for 30 days).`);
  } catch {
    const arch = await client.archiveIssue(issue.id);
    if (!arch.success) throw new Error(`Could not delete or archive ${issue.identifier}.`);
    lines.push(`Write test: archived ${issue.identifier} (delete was refused).`);
  }
  lines.push('Write test: success.');
  return lines;
}
