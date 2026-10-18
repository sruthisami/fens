import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Router, type Request, type RequestHandler } from 'express';
import { env } from '../config/env.js';
import { listGraphNames, openGraph } from '../graph/db.js';
import { canSee, currentContext } from '../tenancy/context.js';
import {
  cytoscapeGraph,
  designSystemComponents,
  hasScreens,
  issueDetail,
  issueList,
  screenDetail,
  screensWithComponent,
  summary,
  type Lens,
} from '../graph/queries.js';
import { badRequest, notFound } from '../http/errors.js';
import { findTool, runTool } from '../tools/index.js';
export const GRAPH_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const COMPONENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ISSUE_ID = /^[a-f0-9]{16}$/;
const SCREENSHOT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.png$/;
const route =
  (handler: (req: Request) => Promise<unknown>): RequestHandler =>
  async (req, res) => {
    res.json(await handler(req));
  };
function graphName(req: Request): string {
  const name = String(req.params.graph ?? '');
  if (name.length > 64 || !GRAPH_NAME.test(name)) {
    throw badRequest('Invalid graph name: use lowercase letters, digits, "-" and "_"');
  }
  return name;
}
async function graphFor(req: Request) {
  const name = graphName(req);
  return { name, g: await openGraph(name) };
}
const LENSES = ['UX', 'SEO', 'AEO'] as const;
function lensOf(req: Request): Lens | null {
  const raw = req.query.lens;
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !(LENSES as readonly string[]).includes(raw)) {
    throw badRequest('lens must be UX, SEO or AEO');
  }
  return raw as Lens;
}
export function graphsRouter(): Router {
  const router = Router();
  router.get(
    '/graphs',
    route(async () => {
      const ctx = currentContext();
      const names = (await listGraphNames())
        .filter((n) => GRAPH_NAME.test(n) && !n.startsWith('sim-') && canSee(ctx, n))
        .filter((n) => n !== ctx.tenant.history_graph)
        .sort();
      const withScreens: string[] = [];
      for (const n of names) {
        if (await hasScreens(await openGraph(n))) withScreens.push(n);
      }
      return { graphs: withScreens };
    }),
  );
  router.get(
    '/graphs/:graph/summary',
    route(async (req) => {
      const { name, g } = await graphFor(req);
      return summary(g, name, lensOf(req));
    }),
  );
  router.get(
    '/graphs/:graph/graph',
    route(async (req) => {
      const { name, g } = await graphFor(req);
      return cytoscapeGraph(g, name);
    }),
  );
  router.get(
    '/graphs/:graph/screens/:id',
    route(async (req) => {
      const { name, g } = await graphFor(req);
      const id = String(req.params.id ?? '');
      if (!id.startsWith('/') || id.length > 512) {
        throw badRequest('Invalid screen id: it must be a URL-encoded path starting with "/"');
      }
      const detail = await screenDetail(g, name, id);
      if (!detail) throw notFound(`Unknown screen: ${id}`);
      return detail;
    }),
  );
  router.get(
    '/graphs/:graph/components',
    route(async (req) => {
      const { g } = await graphFor(req);
      return { components: await designSystemComponents(g) };
    }),
  );
  router.get(
    '/graphs/:graph/components/:name/screens',
    route(async (req) => {
      const { g } = await graphFor(req);
      const component = String(req.params.name ?? '');
      if (!COMPONENT_NAME.test(component)) throw badRequest('Invalid component name');
      const screens = await screensWithComponent(g, component);
      if (!screens) throw notFound(`Unknown component: ${component}`);
      return { component, screens };
    }),
  );
  router.get(
    '/graphs/:graph/issues',
    route(async (req) => {
      const { g } = await graphFor(req);
      return { issues: await issueList(g, lensOf(req)) };
    }),
  );
  router.get(
    '/graphs/:graph/issues/:id',
    route(async (req) => {
      const { g } = await graphFor(req);
      const id = String(req.params.id ?? '');
      if (!ISSUE_ID.test(id)) throw badRequest('Invalid issue id: expected 16 hex characters');
      const detail = await issueDetail(g, id);
      if (!detail) throw notFound(`Unknown issue: ${id}`);
      return detail;
    }),
  );
  router.get(
    '/graphs/:graph/tools/:tool',
    route(async (req) => {
      const name = graphName(req);
      const tool = findTool(String(req.params.tool ?? ''));
      if (!tool) throw notFound(`Unknown tool: ${String(req.params.tool)}`);
      return runTool(tool, name, { ...req.query });
    }),
  );
  router.get('/graphs/:graph/screenshots/:file', (req, res, next) => {
    try {
      const name = graphName(req);
      const file = String(req.params.file ?? '');
      if (!SCREENSHOT_FILE.test(file)) throw badRequest('Invalid screenshot file name');
      const folder = resolve(env.ARTIFACTS_DIR, name, 'screens');
      const target = resolve(folder, file);
      if (!target.startsWith(folder + sep)) throw badRequest('Invalid screenshot path');
      if (!existsSync(target)) throw notFound('Screenshot not found');
      res.sendFile(
        target,
        { dotfiles: 'deny', headers: { 'Cache-Control': 'no-cache' } },
        (err) => {
          if (err) next(err);
        },
      );
    } catch (err) {
      next(err);
    }
  });
  router.use((_req, _res, next) => next(notFound('Not found')));
  return router;
}
