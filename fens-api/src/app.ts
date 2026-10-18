import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler, notFound } from './http/errors.js';
import { agentRouter } from './routes/agent.js';
import { decideRouter } from './routes/decide.js';
import { graphsRouter } from './routes/graphs.js';
import { memoryRouter } from './routes/memory.js';
import { chatRouter } from './routes/chat.js';
import { coordRouter } from './routes/coord.js';
import { contextMiddleware, meRouter } from './tenancy/http.js';
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: env.ALLOWED_ORIGIN,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'X-Tenant-Token', 'X-User'],
    }),
  );
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'fens-api' });
  });
  app.use('/api', express.json({ limit: '64kb' }));
  app.use('/api', contextMiddleware);
  app.use('/api', meRouter());
  app.use('/api', memoryRouter());
  app.use('/api', chatRouter());
  app.use('/api', coordRouter());
  app.use('/api', agentRouter());
  app.use('/api', decideRouter());
  app.use('/api', graphsRouter());
  app.use((_req, _res, next) => next(notFound('Not found')));
  app.use(errorHandler);
  return app;
}
