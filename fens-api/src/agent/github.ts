import { env } from '../config/env.js';
import { openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { badRequest, HttpError } from '../http/errors.js';
import { suggestionText } from '../history/assign.js';
import { buildCommonPayload, linksBlock } from '../integrations/payload.js';
import type { ChannelRecord } from '../integrations/record.js';
import type { FindingRow } from './findings.js';
export interface IssuePreview {
  title: string;
  body: string;
  labels: string[];
}
const MAX_SCREEN_ROWS = 25;
async function pathSteps(g: ReadOnlyGraph, path: string[]): Promise<string[]> {
  const steps: string[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [from, to] = [path[i] as string, path[i + 1] as string];
    const rows = await g.read<{
      action: string;
    }>(
      `MATCH (:Screen {id: $from})-[e:NAVIGATES_TO]->(:Screen {id: $to}) RETURN e.action AS action ORDER BY action LIMIT 1`,
      { from, to },
    );
    steps.push(`${from} → "${rows[0]?.action ?? '?'}" → ${to}`);
  }
  return steps;
}
export async function issuePreview(
  graph: string,
  g: ReadOnlyGraph,
  f: FindingRow,
  rec: ChannelRecord = f.channels,
): Promise<IssuePreview> {
  const common = buildCommonPayload(graph, f);
  const selectors = await g.read<{
    screen: string;
    selector: string;
  }>(
    `MATCH (:Finding {id: $id})-[:BASED_ON]->(:Issue)-[o:FOUND_ON]->(s:Screen)
     RETURN s.id AS screen, o.selector AS selector ORDER BY screen`,
    { id: f.id },
  );
  const affected = new Map<string, string>();
  for (const e of f.evidence) for (const s of [...e.screens, ...e.path]) affected.set(s, '—');
  for (const r of selectors) affected.set(r.screen, `\`${r.selector}\``);
  const evidence: string[] = [];
  for (const e of f.evidence) {
    const args = Object.entries(e.args ?? {})
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ');
    evidence.push(`- **\`${e.tool}\`**${args ? ` (${args})` : ''}: ${e.screens.length} screen(s)`);
    if (e.path.length > 1)
      for (const step of await pathSteps(g, e.path)) evidence.push(`  - ${step}`);
  }
  const rows = [...affected.entries()];
  const table = [
    '| Screen | Selector |',
    '| --- | --- |',
    ...rows.slice(0, MAX_SCREEN_ROWS).map(([s, sel]) => `| \`${s}\` | ${sel} |`),
  ];
  if (rows.length > MAX_SCREEN_ROWS) table.push(`| … ${rows.length - MAX_SCREEN_ROWS} more | |`);
  const labels = ['flowlens', 'ux', `severity:${f.severity}`, `category:${f.category}`];
  const body = [
    `**${common.headline}**${f.target ? ` · Target: ${f.target.type} \`${f.target.id}\`` : ''}`,
    '',
    '## What we found',
    f.explanation,
    '',
    '## Evidence (from the FlowLens graph)',
    ...common.evidence.map((line) => `- ${line}`),
    '',
    '<details><summary>Evidence details</summary>',
    '',
    ...evidence,
    '',
    '</details>',
    '',
    '## Recommendation',
    f.recommendation,
    '',
    '## Affected screens',
    ...table,
    '',
    await suggestionText(g, { finding_id: f.id }),
    '',
    `Labels: ${labels.map((l) => `\`${l}\``).join(', ')}`,
    '',
    `[Open this finding in FlowLens](${common.link})`,
    '',
    linksBlock(rec, 'github', common.link),
    '',
    `_Opened by FlowLens (${f.mode} mode, finding \`${f.id}\`)._`,
  ].join('\n');
  return { title: common.title, body, labels };
}
export function githubError(err: unknown, action: string): HttpError {
  if (err instanceof HttpError) return err;
  const status = (
    err as {
      status?: number;
    }
  ).status;
  const reasons: Record<number, string> = {
    401: 'GitHub rejected GITHUB_TOKEN (401). Create a new token.',
    403: `GITHUB_TOKEN may not change issues in ${env.GITHUB_REPO} (403). Give it Issues: read and write.`,
    404: `GitHub cannot find ${env.GITHUB_REPO} or the issue with this token (404). Check the repository and that the token has Issues: read and write.`,
    410: `Issues are turned off in ${env.GITHUB_REPO} (410).`,
  };
  const reason = status ? reasons[status] : undefined;
  if (reason) return badRequest(reason);
  return new HttpError(
    502,
    `GitHub returned an error${status ? ` (${status})` : ''} while ${action}.`,
  );
}
export async function assertResolvedIn(f: FindingRow, resolvedIn: string): Promise<void> {
  const newer = await openGraph(resolvedIn);
  const stillThere = await newer.read<{
    n: number;
  }>(
    'MATCH (x:Finding {key: $key}) WHERE x.stale IS NULL OR x.stale = false RETURN count(x) AS n',
    { key: f.key },
  );
  if ((stillThere[0]?.n ?? 0) > 0) {
    throw new HttpError(
      409,
      `The finding is still present in ${resolvedIn}; it is not resolved there yet.`,
    );
  }
}
