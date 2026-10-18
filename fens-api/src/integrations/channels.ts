import { HttpError } from '../http/errors.js';
import type { LinearPreview } from './linear.js';
import { scrub } from './linear.js';
import { linksBlock, linksCurrent, linksText, replaceLinksBlock, type Channel } from './payload.js';
import type { ChannelRecord } from './record.js';
export const ORDER: Channel[] = ['github', 'linear', 'figma'];
export interface GithubDraft {
  title: string;
  body: string;
  labels: string[];
}
export interface FigmaDraft {
  message: string;
  client_meta: {
    node_id: string;
    node_offset: {
      x: number;
      y: number;
    };
  } | null;
}
export interface GithubOps {
  create(d: GithubDraft): Promise<{
    url: string;
    number: number;
    note?: string;
  }>;
  get(number: number): Promise<{
    state: 'open' | 'closed';
    body: string;
  } | null>;
  updateBody(number: number, body: string): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  close(number: number): Promise<void>;
}
export interface LinearOps {
  create(d: LinearPreview): Promise<{
    url: string;
    identifier: string;
    note?: string;
  }>;
  get(identifier: string): Promise<{
    state: string;
    state_type: string;
    description: string;
  } | null>;
  updateDescription(identifier: string, description: string): Promise<void>;
  markDone(identifier: string, body: string): Promise<string>;
}
export interface FigmaOps {
  post(
    d: FigmaDraft & {
      comment_id?: string;
    },
  ): Promise<{
    id: string;
    url: string;
  }>;
  thread(id: string): Promise<{
    resolved: boolean;
    messages: string[];
  } | null>;
}
export interface Drafts {
  github(rec: ChannelRecord): Promise<GithubDraft>;
  linear(rec: ChannelRecord): Promise<LinearPreview>;
  figma(rec: ChannelRecord): Promise<FigmaDraft>;
}
export interface ChannelDeps {
  github: GithubOps | string;
  linear: LinearOps | string;
  figma: FigmaOps | string;
  drafts: Drafts;
  link: string;
  save(fields: Record<string, unknown>): Promise<void>;
  now?: () => string;
}
export type ResultStatus =
  | 'created'
  | 'exists'
  | 'skipped'
  | 'failed'
  | 'updated'
  | 'current'
  | 'replied'
  | 'missing'
  | 'closed'
  | 'already closed'
  | 'not sent';
export interface ChannelResult {
  status: ResultStatus;
  url?: string;
  message?: string;
  code?: number;
}
export type Results = Partial<Record<Channel, ChannelResult>>;
function failure(err: unknown): ChannelResult {
  const code = err instanceof HttpError ? err.status : 502;
  const message = scrub(err instanceof Error ? err.message : String(err)).slice(0, 300);
  return { status: 'failed', message, code };
}
const ops = <T>(o: T | string): T | null => (typeof o === 'string' ? null : o);
const reason = (o: unknown): string => (typeof o === 'string' ? o : '');
export async function sendToChannels(
  rec: ChannelRecord,
  selected: Channel[],
  deps: ChannelDeps,
): Promise<{
  results: Results;
  sync: Results;
  record: ChannelRecord;
}> {
  const now = deps.now ?? (() => new Date().toISOString());
  const results: Results = {};
  for (const ch of ORDER) {
    if (!selected.includes(ch)) continue;
    if (rec[ch]) {
      results[ch] = { status: 'exists', url: rec[ch]?.url, message: 'Already sent.' };
      continue;
    }
    if (typeof deps[ch] === 'string') {
      results[ch] = { status: 'skipped', message: reason(deps[ch]) };
      continue;
    }
    try {
      const at = now();
      if (ch === 'github') {
        const r = await (deps.github as GithubOps).create(await deps.drafts.github(rec));
        rec.github = { url: r.url, number: r.number, created_at: at, closed_at: null };
        await deps.save({
          github_issue_url: r.url,
          github_issue_number: r.number,
          github_created_at: at,
        });
        results.github = { status: 'created', url: r.url, ...(r.note ? { message: r.note } : {}) };
      } else if (ch === 'linear') {
        const r = await (deps.linear as LinearOps).create(await deps.drafts.linear(rec));
        rec.linear = { url: r.url, identifier: r.identifier, created_at: at, closed_at: null };
        await deps.save({
          linear_issue_url: r.url,
          linear_issue_identifier: r.identifier,
          linear_created_at: at,
        });
        results.linear = { status: 'created', url: r.url, ...(r.note ? { message: r.note } : {}) };
      } else {
        const r = await (deps.figma as FigmaOps).post(await deps.drafts.figma(rec));
        rec.figma = { id: r.id, url: r.url, created_at: at, closed_at: null };
        await deps.save({ figma_comment_id: r.id, figma_comment_url: r.url, figma_created_at: at });
        results.figma = { status: 'created', url: r.url };
      }
    } catch (err) {
      results[ch] = failure(err);
    }
  }
  const created = ORDER.some((ch) => results[ch]?.status === 'created');
  return { results, sync: created ? await syncLinks(rec, deps) : {}, record: rec };
}
export async function syncLinks(rec: ChannelRecord, deps: ChannelDeps): Promise<Results> {
  const out: Results = {};
  const gh = ops(deps.github);
  if (rec.github) {
    const n = rec.github.number;
    if (!gh || !n)
      out.github = { status: 'skipped', message: reason(deps.github) || 'No issue number.' };
    else
      try {
        const issue = await gh.get(n);
        if (!issue) out.github = { status: 'missing', url: rec.github.url };
        else if (linksCurrent(issue.body, rec, 'github', deps.link))
          out.github = { status: 'current', url: rec.github.url };
        else {
          await gh.updateBody(
            n,
            replaceLinksBlock(issue.body, linksBlock(rec, 'github', deps.link)),
          );
          out.github = { status: 'updated', url: rec.github.url };
        }
      } catch (err) {
        out.github = failure(err);
      }
  }
  const ln = ops(deps.linear);
  if (rec.linear) {
    const id = rec.linear.identifier;
    if (!ln || !id)
      out.linear = { status: 'skipped', message: reason(deps.linear) || 'No identifier.' };
    else
      try {
        const issue = await ln.get(id);
        if (!issue) out.linear = { status: 'missing', url: rec.linear.url };
        else if (linksCurrent(issue.description, rec, 'linear', deps.link))
          out.linear = { status: 'current', url: rec.linear.url };
        else {
          await ln.updateDescription(
            id,
            replaceLinksBlock(issue.description, linksBlock(rec, 'linear', deps.link)),
          );
          out.linear = { status: 'updated', url: rec.linear.url };
        }
      } catch (err) {
        out.linear = failure(err);
      }
  }
  const fg = ops(deps.figma);
  if (rec.figma) {
    const id = rec.figma.id;
    if (!fg || !id)
      out.figma = { status: 'skipped', message: reason(deps.figma) || 'No comment id.' };
    else
      try {
        const thread = await fg.thread(id);
        if (!thread) out.figma = { status: 'missing', url: rec.figma.url };
        else if (linksCurrent(thread.messages.join('\n'), rec, 'figma', deps.link))
          out.figma = { status: 'current', url: rec.figma.url };
        else {
          await fg.post({
            message: `FlowLens: links updated. ${linksText(rec, 'figma', deps.link)}`,
            client_meta: null,
            comment_id: id,
          });
          out.figma = { status: 'replied', url: rec.figma.url };
        }
      } catch (err) {
        out.figma = failure(err);
      }
  }
  return out;
}
export interface ResolveText {
  markdown: string;
  text: string;
}
export async function resolveEverywhere(
  rec: ChannelRecord,
  resolvedIn: string,
  text: ResolveText,
  deps: ChannelDeps,
  assertResolved: () => Promise<void>,
  only: Channel[] = ORDER,
): Promise<{
  results: Results;
  record: ChannelRecord;
}> {
  await assertResolved();
  const now = deps.now ?? (() => new Date().toISOString());
  const results: Results = {};
  for (const ch of ORDER) {
    if (!only.includes(ch)) continue;
    const item = rec[ch];
    if (!item) {
      results[ch] = { status: 'not sent' };
      continue;
    }
    if (item.closed_at) {
      results[ch] = { status: 'already closed', url: item.url };
      continue;
    }
    if (typeof deps[ch] === 'string') {
      results[ch] = { status: 'skipped', url: item.url, message: reason(deps[ch]) };
      continue;
    }
    try {
      let message: string | undefined;
      if (ch === 'github') {
        const n = rec.github?.number;
        if (!n) throw new HttpError(400, 'The stored GitHub URL has no issue number.');
        await (deps.github as GithubOps).comment(n, text.markdown);
        await (deps.github as GithubOps).close(n);
      } else if (ch === 'linear') {
        const id = rec.linear?.identifier;
        if (!id) throw new HttpError(400, 'The stored Linear URL does not name an issue.');
        message = `Moved to ${await (deps.linear as LinearOps).markDone(id, text.markdown)}.`;
      } else {
        const id = rec.figma?.id;
        if (!id)
          throw new HttpError(
            400,
            'No Figma comment id is stored, so there is nothing to reply to.',
          );
        await (deps.figma as FigmaOps).post({
          message: text.text,
          client_meta: null,
          comment_id: id,
        });
        message =
          'Reply posted. The Figma REST API cannot mark a comment resolved; resolve the thread in Figma.';
      }
      const at = now();
      item.closed_at = at;
      rec.closed_in = resolvedIn;
      await deps.save({ [`${ch}_closed_at`]: at, closed_in: resolvedIn });
      results[ch] = { status: 'closed', url: item.url, ...(message ? { message } : {}) };
    } catch (err) {
      results[ch] = failure(err);
    }
  }
  return { results, record: rec };
}
export interface ChannelCheck {
  linked: boolean;
  url?: string;
  checked: boolean;
  exists?: boolean;
  state?: string;
  closed?: boolean;
  links_current?: boolean;
  message?: string;
}
export async function verifyChannels(
  rec: ChannelRecord,
  deps: ChannelDeps,
): Promise<Record<Channel, ChannelCheck>> {
  const out = {} as Record<Channel, ChannelCheck>;
  const guard = async (ch: Channel, run: () => Promise<ChannelCheck>) => {
    const item = rec[ch];
    if (!item) return (out[ch] = { linked: false, checked: false });
    if (typeof deps[ch] === 'string')
      return (out[ch] = { linked: true, url: item.url, checked: false, message: reason(deps[ch]) });
    try {
      out[ch] = await run();
    } catch (err) {
      out[ch] = { linked: true, url: item.url, checked: false, message: failure(err).message };
    }
  };
  await guard('github', async () => {
    const url = rec.github?.url as string;
    const n = rec.github?.number;
    if (!n) return { linked: true, url, checked: false, message: 'No issue number.' };
    const issue = await (deps.github as GithubOps).get(n);
    if (!issue) return { linked: true, url, checked: true, exists: false };
    return {
      linked: true,
      url,
      checked: true,
      exists: true,
      state: issue.state,
      closed: issue.state === 'closed',
      links_current: linksCurrent(issue.body, rec, 'github', deps.link),
    };
  });
  await guard('linear', async () => {
    const url = rec.linear?.url as string;
    const id = rec.linear?.identifier;
    if (!id) return { linked: true, url, checked: false, message: 'No identifier.' };
    const issue = await (deps.linear as LinearOps).get(id);
    if (!issue) return { linked: true, url, checked: true, exists: false };
    return {
      linked: true,
      url,
      checked: true,
      exists: true,
      state: issue.state,
      closed: issue.state_type === 'completed' || issue.state_type === 'canceled',
      links_current: linksCurrent(issue.description, rec, 'linear', deps.link),
    };
  });
  await guard('figma', async () => {
    const url = rec.figma?.url as string;
    const id = rec.figma?.id;
    if (!id) return { linked: true, url, checked: false, message: 'No comment id.' };
    const thread = await (deps.figma as FigmaOps).thread(id);
    if (!thread) return { linked: true, url, checked: true, exists: false };
    return {
      linked: true,
      url,
      checked: true,
      exists: true,
      state: thread.resolved ? 'resolved' : 'open',
      closed: thread.resolved,
      links_current: linksCurrent(thread.messages.join('\n'), rec, 'figma', deps.link),
    };
  });
  return out;
}
