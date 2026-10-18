import { Router } from 'express';
import { z } from 'zod';
import { HANDOFF_KINDS, listHandoffs } from '../coord/handoffs.js';
import { startPipeline } from '../coord/pipeline.js';
import { getState } from '../coord/state.js';
import { memoryGraph } from '../graph/db.js';
import { badRequest } from '../http/errors.js';
import { assertGraphAccess, currentContext } from '../tenancy/context.js';
import { GRAPH_NAME } from './graphs.js';
const str = (v: unknown) => (typeof v === 'string' && v.length ? v : undefined);
export function coordRouter(): Router {
  const router = Router();
  router.post('/graphs/:graph/pipeline', async (req, res) => {
    const graph = String(req.params.graph ?? '');
    if (!GRAPH_NAME.test(graph)) throw badRequest('Invalid graph name');
    assertGraphAccess(graph);
    const body = z
      .object({ compare_with: z.string().max(64).regex(GRAPH_NAME).optional() })
      .safeParse(req.body ?? {});
    if (!body.success) throw badRequest('Body must be { "compare_with"?: "<older graph>" }');
    if (body.data.compare_with) assertGraphAccess(body.data.compare_with);
    res.status(201).json(await startPipeline(currentContext(), graph, body.data.compare_with));
  });
  router.get('/handoffs', async (req, res) => {
    const status = str(req.query.status);
    if (status && !['pending', 'claimed', 'done', 'failed'].includes(status))
      throw badRequest('Unknown status');
    res.json({
      kinds: HANDOFF_KINDS,
      handoffs: await listHandoffs(currentContext(), {
        run_id: str(req.query.run_id),
        status,
        to_agent: str(req.query.to_agent),
        limit: Number(req.query.limit) || 200,
      }),
      now: Date.now(),
    });
  });
  router.get('/state', async (_req, res) => {
    const ctx = currentContext();
    const m = await memoryGraph(ctx, 'team');
    const keys = await m.read<{
      key: string;
    }>("MATCH (s:State) WHERE NOT s.key STARTS WITH 'run:' RETURN s.key AS key ORDER BY key");
    const state = [];
    for (const { key } of keys) state.push(await getState(ctx, key));
    res.json({ state });
  });
  return router;
}
