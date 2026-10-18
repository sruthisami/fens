import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { investigate, isRunning } from '../agent/investigate.js';
import { getFinding, listFindings } from '../agent/findings.js';
import { assertResolvedIn, issuePreview } from '../agent/github.js';
import { getPreferences } from '../memory/memory.js';
import { suppressedBy } from '../memory/suppress.js';
import { currentContext } from '../tenancy/context.js';
import type { FindingRow } from '../agent/findings.js';
import { listProposals } from '../agent/proposals.js';
import { readProblems } from '../problems/read.js';
import { AGENT_CHOICES, MODES, type AgentEvent } from '../agent/types.js';
import { openGraph } from '../graph/db.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { assertLinearFinding, findingLinearPreview } from '../integrations/linear.js';
import { figmaPreview, graphBboxLookup } from '../integrations/figma.js';
import {
  ORDER,
  resolveEverywhere,
  sendToChannels,
  syncLinks,
  verifyChannels,
  type ChannelDeps,
  type Results,
} from '../integrations/channels.js';
import { channelDeps, createBlocker, diffSummary } from '../integrations/channelDeps.js';
import type { Channel } from '../integrations/payload.js';
import { resolveText } from '../integrations/payload.js';
import { channelStatus } from '../integrations/record.js';
import type { ReadOnlyGraph } from '../graph/db.js';
import { assigneeOf } from './decide.js';
import { GRAPH_NAME } from './graphs.js';
const FINDING_ID = /^[a-f0-9]{16}$/;
function graphName(req: Request): string {
  const name = String(req.params.graph ?? '');
  if (name.length > 64 || !GRAPH_NAME.test(name)) throw badRequest('Invalid graph name');
  return name;
}
async function finding(req: Request) {
  const name = graphName(req);
  const id = String(req.params.id ?? '');
  if (!FINDING_ID.test(id)) throw badRequest('Invalid finding id: expected 16 hex characters');
  const g = await openGraph(name);
  const f = await getFinding(g, id);
  if (!f) throw notFound(`Unknown finding: ${id}`);
  return { name, g, f };
}
function sendDeps(f: FindingRow, deps: ChannelDeps): ChannelDeps {
  const out = { ...deps };
  for (const ch of ORDER) {
    const blocker = createBlocker(f, deps, ch);
    if (blocker) out[ch] = blocker;
  }
  return out;
}
async function sendOne(f: FindingRow, deps: ChannelDeps, ch: Channel) {
  const { results, sync } = await sendToChannels(f.channels, [ch], sendDeps(f, deps));
  const r = results[ch];
  if (r?.status === 'created') return { url: r.url, note: r.message ?? null, sync };
  if (r?.status === 'exists') throw new HttpError(409, `Already sent: ${r.url}`);
  throw new HttpError(r?.status === 'skipped' ? 400 : (r?.code ?? 502), r?.message ?? 'Not sent.');
}
function oneResult(
  out: {
    results: Results;
  },
  ch: Channel,
) {
  const r = out.results[ch];
  if (r?.status === 'closed') return { url: r.url, closed: true, message: r.message ?? null };
  if (r?.status === 'not sent') throw badRequest(`This finding has no ${ch} item to close.`);
  if (r?.status === 'already closed') throw new HttpError(409, `Already closed: ${r.url}`);
  throw new HttpError(
    r?.status === 'skipped' ? 400 : (r?.code ?? 502),
    r?.message ?? 'Not closed.',
  );
}
function resolvedInOf(req: Request, graph: string): string {
  const body = z
    .object({ resolved_in: z.string().max(64).regex(GRAPH_NAME, 'invalid graph name') })
    .safeParse(req.body ?? {});
  if (!body.success) throw badRequest('Body must be { "resolved_in": "<newer graph name>" }');
  if (body.data.resolved_in === graph) throw badRequest('resolved_in must be the newer release');
  return body.data.resolved_in;
}
async function resolve(
  graph: string,
  g: ReadOnlyGraph,
  f: FindingRow,
  resolvedIn: string,
  only: Channel[],
) {
  const text = { markdown: '', text: '' };
  const deps = channelDeps(graph, g, f);
  const out = await resolveEverywhere(
    f.channels,
    resolvedIn,
    text,
    deps,
    async () => {
      await assertResolvedIn(f, resolvedIn);
      Object.assign(text, resolveText(f, await diffSummary(graph, resolvedIn)));
    },
    only,
  );
  return { ...out, status: channelStatus(out.record) };
}
async function channelsPreview(graph: string, g: ReadOnlyGraph, f: FindingRow) {
  const deps = channelDeps(graph, g, f);
  const one = async <T>(ch: Channel, draft: () => Promise<T>) => {
    const blocker = createBlocker(f, deps, ch);
    const sent = f.channels[ch];
    try {
      return {
        available: !blocker,
        reason: blocker,
        sent: sent?.url ?? null,
        draft: await draft(),
      };
    } catch (err) {
      return {
        available: false,
        reason: blocker ?? (err as Error).message,
        sent: sent?.url ?? null,
        draft: null,
      };
    }
  };
  return {
    status: channelStatus(f.channels),
    note: 'Links to channels created in the same send are added right after, by updating the earlier items (Figma: a reply).',
    github: await one('github', () => deps.drafts.github(f.channels)),
    linear: await one('linear', () => findingLinearPreview(graph, g, f)),
    figma: await one('figma', () => deps.drafts.figma(f.channels)),
  };
}
export function agentRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '4kb' }));
  router.post('/graphs/:graph/investigate', async (req, res) => {
    const name = graphName(req);
    const body = z
      .object({
        mode: z.enum(MODES),
        agent: z.enum(AGENT_CHOICES).default('ux'),
        compare_with: z
          .string()
          .max(64)
          .regex(GRAPH_NAME, 'graph names are lowercase letters, digits, "-" and "_"')
          .optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success)
      throw badRequest(
        'Body must be { "mode": "llm" | "rules" | "replay", "agent"?: "ux" | "seo" | "both", "compare_with"?: graph name }',
      );
    await openGraph(name);
    const compareWith = body.data.compare_with;
    if (compareWith) {
      if (compareWith === name) throw badRequest('compare_with must be a different release');
      await openGraph(compareWith);
    }
    if (isRunning(name)) throw new HttpError(409, `An investigation of ${name} is already running`);
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    let open = true;
    req.on('close', () => {
      open = false;
    });
    const emit = (e: AgentEvent) => {
      if (open) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    await investigate(name, body.data.mode, body.data.agent, emit, compareWith);
    res.end();
  });
  router.get('/graphs/:graph/findings', async (req, res) => {
    const g = await openGraph(graphName(req));
    const ctx = currentContext();
    const prefs = ctx.system ? [] : await getPreferences(ctx).catch(() => []);
    res.json({
      findings: (await listFindings(g)).map((f) => {
        const p = suppressedBy(f, prefs);
        return {
          ...f,
          suppressed_by: p
            ? { fact_id: p.id, text: `${p.subject} ${p.predicate}: ${p.object}` }
            : null,
        };
      }),
    });
  });
  router.get('/graphs/:graph/problems', async (req, res) => {
    const g = await openGraph(graphName(req));
    res.json(await readProblems(g));
  });
  router.get('/graphs/:graph/proposals', async (req, res) => {
    const g = await openGraph(graphName(req));
    res.json({ proposals: await listProposals(g) });
  });
  router.get('/graphs/:graph/findings/:id', async (req, res) => {
    const { f } = await finding(req);
    res.json(f);
  });
  router.get('/graphs/:graph/findings/:id/channels', async (req, res) => {
    const { f } = await finding(req);
    res.json({ record: f.channels, status: channelStatus(f.channels) });
  });
  router.get('/graphs/:graph/findings/:id/channels/preview', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.json(await channelsPreview(name, g, f));
  });
  router.post('/graphs/:graph/findings/:id/channels/send', async (req, res) => {
    const { name, g, f } = await finding(req);
    const body = z
      .object({ channels: z.array(z.enum(ORDER)).min(1).max(3) })
      .safeParse(req.body ?? {});
    if (!body.success)
      throw badRequest(
        'Body must be { "channels": ["github" | "linear" | "figma", …], "assignee"? }',
      );
    const deps = sendDeps(f, channelDeps(name, g, f, assigneeOf(req)));
    const { results, sync, record } = await sendToChannels(f.channels, body.data.channels, deps);
    res.json({ results, sync, status: channelStatus(record) });
  });
  router.post('/graphs/:graph/findings/:id/channels/sync', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.json({ results: await syncLinks(f.channels, channelDeps(name, g, f)) });
  });
  router.get('/graphs/:graph/findings/:id/channels/verify', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.json({ channels: await verifyChannels(f.channels, channelDeps(name, g, f)) });
  });
  router.post('/graphs/:graph/findings/:id/channels/resolve', async (req, res) => {
    const { name, g, f } = await finding(req);
    const resolvedIn = resolvedInOf(req, name);
    res.json(await resolve(name, g, f, resolvedIn, ORDER));
  });
  router.get('/graphs/:graph/findings/:id/issue-preview', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.json(await issuePreview(name, g, f));
  });
  router.post('/graphs/:graph/findings/:id/github-issue', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.status(201).json(await sendOne(f, channelDeps(name, g, f, assigneeOf(req)), 'github'));
  });
  router.post('/graphs/:graph/findings/:id/github-close', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.json(oneResult(await resolve(name, g, f, resolvedInOf(req, name), ['github']), 'github'));
  });
  router.get('/graphs/:graph/findings/:id/linear-preview', async (req, res) => {
    const { name, g, f } = await finding(req);
    assertLinearFinding(f);
    res.json(await findingLinearPreview(name, g, f));
  });
  router.post('/graphs/:graph/findings/:id/linear-issue', async (req, res) => {
    const { name, g, f } = await finding(req);
    assertLinearFinding(f);
    res.status(201).json(await sendOne(f, channelDeps(name, g, f), 'linear'));
  });
  router.post('/graphs/:graph/findings/:id/linear-close', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.json(oneResult(await resolve(name, g, f, resolvedInOf(req, name), ['linear']), 'linear'));
  });
  router.get('/graphs/:graph/findings/:id/figma-preview', async (req, res) => {
    const { name, f } = await finding(req);
    res.json(await figmaPreview(name, f, graphBboxLookup(name, f.id)));
  });
  router.post('/graphs/:graph/findings/:id/figma-comment', async (req, res) => {
    const { name, g, f } = await finding(req);
    res.status(201).json(await sendOne(f, channelDeps(name, g, f), 'figma'));
  });
  return router;
}
