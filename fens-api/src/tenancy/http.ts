import { Router, type RequestHandler } from 'express';
import { canSee, currentContext, resolveContext, runWithContext } from './context.js';
const one = (v: unknown) => (typeof v === 'string' ? v : undefined);
export const contextMiddleware: RequestHandler = (req, _res, next) => {
  const screenshot = req.method === 'GET' && /^\/graphs\/[^/]+\/screenshots\//.test(req.path);
  const token =
    one(req.headers['x-tenant-token']) ?? (screenshot ? one(req.query.tenant_token) : undefined);
  const user = one(req.headers['x-user']) ?? (screenshot ? one(req.query.user) : undefined);
  let ctx;
  try {
    ctx = resolveContext(token, user);
  } catch (err) {
    next(err);
    return;
  }
  runWithContext(ctx, () => next());
};
export function meRouter(): Router {
  const router = Router();
  router.get('/me', (_req, res) => {
    const { tenant, user } = currentContext();
    res.json({
      tenant: { id: tenant.id, name: tenant.name, dev_token: tenant.dev_token },
      user,
      users: tenant.users,
      graphs: tenant.graphs.filter((g) => canSee(currentContext(), g)),
    });
  });
  return router;
}
