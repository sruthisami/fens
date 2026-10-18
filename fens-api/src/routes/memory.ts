import { Router, type Request } from 'express';
import { z } from 'zod';
import { badRequest } from '../http/errors.js';
import { rememberComparison, type ComparisonLike } from '../memory/findingFacts.js';
import {
  EPISODE_TYPES,
  getPreferences,
  playbookStats,
  procedures,
  recall,
  recallEpisodes,
  rememberFact,
} from '../memory/memory.js';
import { assertGraphAccess, currentContext } from '../tenancy/context.js';
import { findTool, runTool } from '../tools/index.js';
import { GRAPH_NAME } from './graphs.js';
const str = (v: unknown) => (typeof v === 'string' && v.length ? v : undefined);
function graphName(req: Request, key = 'graph'): string {
  const name = String(req.params[key] ?? '');
  if (name.length > 64 || !GRAPH_NAME.test(name)) throw badRequest('Invalid graph name');
  assertGraphAccess(name);
  return name;
}
export function memoryRouter(): Router {
  const router = Router();
  router.get('/memory/facts', async (req, res) => {
    res.json({
      facts: await recall(currentContext(), {
        subject: str(req.query.subject),
        keyword: str(req.query.keyword),
        include_history: req.query.include_history === 'true',
        limit: Number(req.query.limit) || 100,
      }),
    });
  });
  router.post('/memory/facts', async (req, res) => {
    const body = z
      .object({
        subject: z.string().min(1).max(200),
        predicate: z.string().min(1).max(200),
        object: z.string().min(1).max(500),
        kind: z.enum(['fact', 'preference']).default('fact'),
        confidence: z.number().min(0).max(1).optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success)
      throw badRequest('Body must be { subject, predicate, object, kind?, confidence? }');
    res.status(201).json(await rememberFact(currentContext(), body.data));
  });
  router.get('/memory/episodes', async (req, res) => {
    const type = str(req.query.type);
    if (type && !(EPISODE_TYPES as readonly string[]).includes(type))
      throw badRequest('Unknown episode type');
    const scope = str(req.query.scope);
    res.json({
      episodes: await recallEpisodes(currentContext(), {
        agent: str(req.query.agent),
        type,
        since: str(req.query.since),
        limit: Number(req.query.limit) || 100,
        scope: scope === 'user' || scope === 'team' ? scope : 'both',
      }),
    });
  });
  router.get('/memory/preferences', async (_req, res) => {
    res.json({ preferences: await getPreferences(currentContext()) });
  });
  router.get('/memory/procedures', async (_req, res) => {
    const ctx = currentContext();
    res.json({ procedures: await procedures(ctx), playbooks: await playbookStats(ctx) });
  });
  router.post('/graphs/:graph/compare', async (req, res) => {
    const to = graphName(req);
    const body = z
      .object({ from_graph: z.string().max(64).regex(GRAPH_NAME) })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest('Body must be { "from_graph": "<older graph>" }');
    if (body.data.from_graph === to) throw badRequest('from_graph must be another release');
    assertGraphAccess(body.data.from_graph);
    const tool = findTool('diff_releases');
    if (!tool) throw new Error('diff_releases is missing');
    const diff = (await runTool(tool, to, { from_graph: body.data.from_graph }))
      .result as ComparisonLike;
    const memory = await rememberComparison(currentContext(), body.data.from_graph, to, diff);
    res.json({ diff, memory });
  });
  return router;
}
