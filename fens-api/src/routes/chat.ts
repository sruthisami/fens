import { Router } from 'express';
import { z } from 'zod';
import { answer } from '../chat/answer.js';
import {
  addMessage,
  closeIdle,
  closeSession,
  getSession,
  listSessions,
  startSession,
  whatIRemember,
} from '../chat/sessions.js';
import { badRequest, notFound } from '../http/errors.js';
import { assertGraphAccess, currentContext } from '../tenancy/context.js';
import { GRAPH_NAME } from './graphs.js';
const SESSION_ID = /^s-[a-z0-9]+-[a-f0-9]{6}$/;
function sessionId(raw: unknown): string {
  const id = String(raw ?? '');
  if (!SESSION_ID.test(id)) throw badRequest('Invalid session id');
  return id;
}
export function chatRouter(): Router {
  const router = Router();
  router.get('/chat/sessions', async (_req, res) => {
    const ctx = currentContext();
    await closeIdle(ctx);
    res.json({ sessions: await listSessions(ctx), remembered: await whatIRemember(ctx) });
  });
  router.post('/chat/sessions', async (_req, res) => {
    res.status(201).json(await startSession(currentContext()));
  });
  router.get('/chat/sessions/:id', async (req, res) => {
    const found = await getSession(currentContext(), sessionId(req.params.id));
    if (!found) throw notFound('Unknown session');
    res.json(found);
  });
  router.post('/chat/sessions/:id/messages', async (req, res) => {
    const ctx = currentContext();
    const id = sessionId(req.params.id);
    const body = z
      .object({
        text: z.string().min(1).max(2000),
        graph: z.string().max(64).regex(GRAPH_NAME),
        mode: z.enum(['rules', 'llm']).default('rules'),
      })
      .safeParse(req.body ?? {});
    if (!body.success)
      throw badRequest('Body must be { "text", "graph", "mode"?: "rules" | "llm" }');
    assertGraphAccess(body.data.graph);
    const found = await getSession(ctx, id);
    if (!found) throw notFound('Unknown session');
    if (found.session.status !== 'open')
      throw badRequest('This session is closed; start a new one.');
    const question = await addMessage(ctx, id, 'user', body.data.text);
    const a = await answer(ctx, body.data.graph, body.data.text, body.data.mode);
    const reply = await addMessage(ctx, id, 'assistant', a.text, a.tool_calls);
    res.json({ question, reply, intent: a.intent, mode: a.mode, note: a.note ?? null });
  });
  router.post('/chat/sessions/:id/close', async (req, res) => {
    const out = await closeSession(currentContext(), sessionId(req.params.id));
    if (!out) throw notFound('Unknown session');
    res.json(out);
  });
  return router;
}
