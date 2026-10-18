import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { listProposals } from '../agent/proposals.js';
import { CHANGE_TYPES } from '../agent/proposals.js';
import { decide, listDecisions, listPlaybooks, type DecideEvent } from '../decider/decide.js';
import { createDecisionIssue, decisionIssuePreview, assertIssuable } from '../decider/github.js';
import { simulate } from '../decider/simulate.js';
import { debateFor, writeDebate } from '../decider/debate.js';
import { createLinearIssue, decisionLinearPreview } from '../integrations/linear.js';
import { openGraph } from '../graph/db.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { GRAPH_NAME } from './graphs.js';
const ID = /^[a-f0-9]{16}$/;
const running = new Set<string>();
function graphName(req: Request): string {
  const name = String(req.params.graph ?? '');
  if (name.length > 64 || !GRAPH_NAME.test(name) || name.startsWith('sim-'))
    throw badRequest('Invalid graph name');
  return name;
}
async function decision(req: Request) {
  const name = graphName(req);
  const id = String(req.params.id ?? '');
  if (!ID.test(id)) throw badRequest('Invalid decision id: expected 16 hex characters');
  const d = (await listDecisions(await openGraph(name))).find((x) => x.id === id);
  if (!d) throw notFound(`Unknown decision: ${id}`);
  return { name, d };
}
export function assigneeOf(req: Request): string | undefined {
  const body = z
    .object({
      assignee: z
        .string()
        .regex(/^[A-Za-z0-9-]{1,39}$/)
        .optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) throw badRequest('assignee must be a GitHub login');
  return body.data.assignee;
}
export function decideRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: '4kb' }));
  router.post('/graphs/:graph/decide', async (req, res) => {
    const name = graphName(req);
    const body = z
      .object({ mode: z.enum(['rules', 'llm']).default('rules') })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest('Body must be { "mode"?: "rules" | "llm" }');
    await openGraph(name);
    if (running.has(name)) throw new HttpError(409, `An arbitration of ${name} is already running`);
    running.add(name);
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
    const emit = (e: DecideEvent) => {
      if (open) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await decide(name, body.data.mode, emit);
    } finally {
      running.delete(name);
      res.end();
    }
  });
  router.get('/graphs/:graph/decisions', async (req, res) => {
    const g = await openGraph(graphName(req));
    res.json({ decisions: await listDecisions(g), playbooks: await listPlaybooks(g) });
  });
  router.get('/graphs/:graph/decisions/:id/issue-preview', async (req, res) => {
    const { name, d } = await decision(req);
    assertIssuable(d);
    res.json(await decisionIssuePreview(await openGraph(name), d));
  });
  router.post('/graphs/:graph/decisions/:id/github-issue', async (req, res) => {
    const { name, d } = await decision(req);
    res
      .status(201)
      .json(await createDecisionIssue(name, await openGraph(name), d, assigneeOf(req)));
  });
  router.get('/graphs/:graph/decisions/:id/debate', async (req, res) => {
    const { name, d } = await decision(req);
    const mode = req.query.mode ?? 'rules';
    if (mode !== 'rules' && mode !== 'llm') throw badRequest('mode must be rules or llm');
    const debate = await debateFor(await openGraph(name), d);
    res.json(mode === 'llm' ? await writeDebate(debate) : debate);
  });
  router.get('/graphs/:graph/decisions/:id/linear-preview', async (req, res) => {
    const { name, d } = await decision(req);
    res.json(await decisionLinearPreview(name, await openGraph(name), d));
  });
  router.post('/graphs/:graph/decisions/:id/linear-issue', async (req, res) => {
    const { name, d } = await decision(req);
    const preview = await decisionLinearPreview(name, await openGraph(name), d);
    const created = await createLinearIssue(
      name,
      { label: 'Decision', id: d.id, linear_issue_url: d.linear_issue_url },
      preview,
    );
    res.status(201).json(created);
  });
  router.post('/graphs/:graph/simulate', async (req, res) => {
    const name = graphName(req);
    const body = z
      .union([
        z.object({ proposal_id: z.string().regex(ID) }),
        z.object({
          change: z.object({
            type: z.enum(CHANGE_TYPES),
            params: z.record(z.string(), z.unknown()),
          }),
        }),
      ])
      .safeParse(req.body ?? {});
    if (!body.success)
      throw badRequest('Body must be { "proposal_id" } or { "change": { "type", "params" } }');
    let change;
    if ('proposal_id' in body.data) {
      const id = body.data.proposal_id;
      const p = (await listProposals(await openGraph(name))).find((x) => x.id === id);
      if (!p) throw notFound(`Unknown proposal: ${id}`);
      change = p.change;
    } else change = body.data.change;
    res.json(await simulate(name, change));
  });
  return router;
}
