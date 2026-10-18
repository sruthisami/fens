import { LinearErrorType } from '@linear/sdk';
import { Octokit } from 'octokit';
import { githubError, issuePreview } from '../agent/github.js';
import type { FindingRow } from '../agent/findings.js';
import { env } from '../config/env.js';
import { openFindingWriter, openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { assignAfterCreate, confirmedAssignee } from '../history/assign.js';
import { badRequest, HttpError } from '../http/errors.js';
import { collectRelease } from '../releases/collect.js';
import { diffOf } from '../tools/releaseTools.js';
import type { ChannelDeps, FigmaOps, GithubOps, LinearOps } from './channels.js';
import { figmaCommentUrl, figmaPreview, graphBboxLookup } from './figma.js';
import {
  findingLinearPreview,
  linearClient,
  linearHttpError,
  markDone,
  sendLinearIssue,
} from './linear.js';
import { dashboardLink, type DiffSummary } from './payload.js';
const FIGMA_API = 'https://api.figma.com/v1';
function githubOps(g: ReadOnlyGraph, f: FindingRow, assignee?: string): GithubOps | string {
  if (!env.GITHUB_REPO || !env.GITHUB_TOKEN)
    return 'GitHub is not set up: add GITHUB_REPO and GITHUB_TOKEN to fens-api/.env.';
  const [owner, repo] = env.GITHUB_REPO.split('/') as [string, string];
  const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  const call = async <T>(action: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      throw githubError(err, action);
    }
  };
  return {
    async create(d) {
      const login = await confirmedAssignee(g, { finding_id: f.id }, assignee);
      const { data } = await call('creating the issue', () =>
        octokit.rest.issues.create({ owner, repo, title: d.title, body: d.body, labels: d.labels }),
      );
      const assigned = await assignAfterCreate(octokit, owner, repo, data.number, login);
      return {
        url: data.html_url,
        number: data.number,
        ...(assigned.assigned ? { note: `Assigned @${login}.` } : {}),
        ...(assigned.assign_note ? { note: assigned.assign_note } : {}),
      };
    },
    async get(number) {
      try {
        const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: number });
        return { state: data.state === 'closed' ? 'closed' : 'open', body: data.body ?? '' };
      } catch (err) {
        if (
          (
            err as {
              status?: number;
            }
          ).status === 404 ||
          (
            err as {
              status?: number;
            }
          ).status === 410
        )
          return null;
        throw githubError(err, 'reading the issue');
      }
    },
    async updateBody(number, body) {
      await call('updating the issue body', () =>
        octokit.rest.issues.update({ owner, repo, issue_number: number, body }),
      );
    },
    async comment(number, body) {
      await call('commenting on the issue', () =>
        octokit.rest.issues.createComment({ owner, repo, issue_number: number, body }),
      );
    },
    async close(number) {
      await call('closing the issue', () =>
        octokit.rest.issues.update({ owner, repo, issue_number: number, state: 'closed' }),
      );
    },
  };
}
function linearOps(f: FindingRow): LinearOps | string {
  if (!env.LINEAR_API_KEY || !env.LINEAR_TEAM_ID)
    return 'Linear is not set up: add LINEAR_API_KEY and LINEAR_TEAM_ID to fens-api/.env.';
  const teamId = env.LINEAR_TEAM_ID;
  const client = linearClient();
  const call = async <T>(action: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      throw linearHttpError(err, action);
    }
  };
  const createAllowed = f.category === 'content';
  return {
    async create(d) {
      if (!createAllowed)
        throw badRequest(
          `Linear is for non-code work: content findings only (this one is ${f.category}).`,
        );
      const r = await call('creating the issue', () => sendLinearIssue(client, teamId, d));
      return {
        url: r.url,
        identifier: r.identifier,
        ...(r.missing_labels.length
          ? { note: `Labels missing: ${r.missing_labels.join(', ')}. Run npm run linear:setup.` }
          : {}),
      };
    },
    async get(identifier) {
      try {
        const issue = await client.issue(identifier);
        const state = await issue.state;
        return {
          state: state?.name ?? 'unknown',
          state_type: state?.type ?? 'unknown',
          description: issue.description ?? '',
        };
      } catch (err) {
        const e = err as {
          type?: string;
          message?: string;
        };
        if (e.type === LinearErrorType.InvalidInput && /not found/i.test(e.message ?? ''))
          return null;
        throw linearHttpError(err, `reading ${identifier}`);
      }
    },
    async updateDescription(identifier, description) {
      await call(`updating ${identifier}`, async () => {
        const issue = await client.issue(identifier);
        await client.updateIssue(issue.id, { description });
      });
    },
    markDone: (identifier, body) =>
      call(`marking ${identifier} done`, () => markDone(client, identifier, body)),
  };
}
function figmaOps(): FigmaOps | string {
  if (!env.FIGMA_TOKEN || !env.FIGMA_FILE_KEY)
    return 'Figma is not set up: add FIGMA_TOKEN and FIGMA_FILE_KEY to fens-api/.env.';
  const fileKey = env.FIGMA_FILE_KEY;
  const headers = { 'X-Figma-Token': env.FIGMA_TOKEN, 'Content-Type': 'application/json' };
  const request = async (action: string, path: string, init?: RequestInit) => {
    const res = await fetch(`${FIGMA_API}/files/${fileKey}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    if (!res) throw new HttpError(502, `Figma did not answer while ${action}.`);
    if (res.status === 403 || res.status === 404)
      throw badRequest(
        `Figma refused ${action} (${res.status}): check FIGMA_TOKEN (file_comments:read and write) and FIGMA_FILE_KEY.`,
      );
    if (res.status === 429) throw new HttpError(429, `Figma rate limit reached while ${action}.`);
    if (!res.ok) throw new HttpError(502, `Figma returned ${res.status} while ${action}.`);
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  };
  return {
    async post(d) {
      const body = {
        message: d.message,
        ...(d.comment_id ? { comment_id: d.comment_id } : {}),
        ...(d.client_meta && !d.comment_id ? { client_meta: d.client_meta } : {}),
      };
      const c = await request(d.comment_id ? 'replying' : 'posting the comment', '/comments', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const id = typeof c.id === 'string' ? c.id : String(c.id ?? '');
      if (!id) throw new HttpError(502, 'Figma did not return the comment.');
      return { id, url: figmaCommentUrl(fileKey, d.client_meta?.node_id ?? null, id) };
    },
    async thread(id) {
      const data = await request('reading the comments', '/comments');
      const all = (Array.isArray(data.comments) ? data.comments : []) as {
        id: string;
        parent_id?: string;
        resolved_at?: string | null;
        message?: string;
      }[];
      const root = all.find((c) => c.id === id);
      if (!root) return null;
      const replies = all.filter((c) => c.parent_id === id);
      return {
        resolved: !!root.resolved_at,
        messages: [root, ...replies].map((c) => c.message ?? ''),
      };
    },
  };
}
export function channelDeps(
  graph: string,
  g: ReadOnlyGraph,
  f: FindingRow,
  assignee?: string,
): ChannelDeps {
  const linear = linearOps(f);
  return {
    github: githubOps(g, f, assignee),
    linear,
    figma: figmaOps(),
    link: dashboardLink(graph, f.id),
    drafts: {
      github: (rec) => issuePreview(graph, g, f, rec),
      linear: (rec) => findingLinearPreview(graph, g, f, rec),
      async figma(rec) {
        const p = await figmaPreview(graph, f, graphBboxLookup(graph, f.id), rec);
        if (p.dry_run) throw badRequest(`Figma comment not posted: ${p.reasons.join('; ')}.`);
        return { message: p.request.body.message, client_meta: p.request.body.client_meta };
      },
    },
    async save(fields) {
      const keys = Object.keys(fields).filter((k) => /^[a-z_]+$/.test(k));
      if (keys.length === 0) return;
      const w = await openFindingWriter(graph);
      await w.write(
        `MATCH (f:Finding {id: $id}) SET ${keys.map((k) => `f.${k} = $${k}`).join(', ')}`,
        { id: f.id, ...fields },
      );
    },
  };
}
export function createBlocker(f: FindingRow, deps: ChannelDeps, ch: 'github' | 'linear' | 'figma') {
  if (typeof deps[ch] === 'string') return deps[ch] as string;
  if (ch === 'linear' && f.category !== 'content')
    return `Linear is for non-code work: content findings and needs_human decisions only (this finding is ${f.category}).`;
  return null;
}
export async function diffSummary(from: string, to: string): Promise<DiffSummary> {
  const d = diffOf(
    await collectRelease(await openGraph(from), from),
    await collectRelease(await openGraph(to), to),
  );
  return {
    from,
    to,
    health: { from: d.health.from.score, to: d.health.to.score, delta: d.health.delta },
    issues_fixed: d.issues.fixed.length,
    issues_new: d.issues.new.length,
    findings_resolved: d.findings.resolved.length,
    findings_new: d.findings.new.length,
  };
}
