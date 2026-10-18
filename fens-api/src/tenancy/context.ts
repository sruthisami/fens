import { AsyncLocalStorage } from 'node:async_hooks';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { HttpError, notFound } from '../http/errors.js';
const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: z.string().min(1),
  token_env: z.string().regex(/^[A-Z0-9_]+$/),
  dev_token: z.string().min(8),
  users: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_]{0,40}$/), name: z.string() }))
    .min(1),
  graphs: z.array(z.string()),
  history_graph: z.string().nullable(),
});
export interface Tenant {
  id: string;
  name: string;
  token: string;
  dev_token: boolean;
  users: {
    id: string;
    name: string;
  }[];
  graphs: string[];
  history_graph: string | null;
}
export interface Ctx {
  tenant: Tenant;
  user: {
    id: string;
    name: string;
  };
  system?: boolean;
}
export const TENANTS_FILE = resolve('config/tenants.json');
let cache: Tenant[] | null = null;
export function tenants(): Tenant[] {
  if (cache) return cache;
  const raw = JSON.parse(readFileSync(TENANTS_FILE, 'utf8')) as {
    tenants: unknown;
  };
  const list = z.array(tenantSchema).parse(raw.tenants);
  cache = list.map((t) => {
    const fromEnv = process.env[t.token_env];
    return {
      id: t.id,
      name: t.name,
      token: fromEnv && fromEnv.length > 0 ? fromEnv : t.dev_token,
      dev_token: !(fromEnv && fromEnv.length > 0),
      users: t.users,
      graphs: t.graphs,
      history_graph: t.history_graph,
    };
  });
  return cache;
}
const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function resolveContext(token: string | undefined, user: string | undefined): Ctx {
  if (!token) throw new HttpError(401, 'Missing X-Tenant-Token header.');
  const tenant = tenants().find((t) => sameToken(t.token, token));
  if (!tenant) throw new HttpError(401, 'Unknown tenant token.');
  if (!user) throw new HttpError(401, 'Missing X-User header.');
  const u = tenant.users.find((x) => x.id === user);
  if (!u) throw new HttpError(403, `User ${user} is not a member of ${tenant.name}.`);
  return { tenant, user: u };
}
export function tenantContext(tenantId: string, userId?: string): Ctx {
  const tenant = tenants().find((t) => t.id === tenantId);
  if (!tenant) throw new Error(`Unknown tenant ${tenantId}`);
  const user = (userId ? tenant.users.find((u) => u.id === userId) : undefined) ?? {
    id: userId ?? 'worker',
    name: userId ?? 'worker',
  };
  if (userId && !tenant.users.some((u) => u.id === userId) && !/^worker/.test(userId))
    throw new Error(`User ${userId} is not a member of ${tenant.id}`);
  return { tenant, user };
}
export function systemContext(): Ctx {
  return {
    tenant: {
      id: 'system',
      name: 'System',
      token: '',
      dev_token: false,
      users: [],
      graphs: [],
      history_graph: null,
    },
    user: { id: 'system', name: 'System' },
    system: true,
  };
}
const store = new AsyncLocalStorage<Ctx>();
export const runWithContext = <T>(ctx: Ctx, fn: () => T): T => store.run(ctx, fn);
export function currentContext(): Ctx {
  const ctx = store.getStore();
  if (!ctx)
    throw new Error(
      'No tenant context: run inside runWithContext (request, MCP server, worker or script).',
    );
  return ctx;
}
export const MEMORY_PREFIXES = ['mem_', 'memu_', 'memtest_'];
export const isMemoryGraph = (name: string) => MEMORY_PREFIXES.some((p) => name.startsWith(p));
export function canSee(ctx: Ctx, name: string): boolean {
  if (isMemoryGraph(name)) return false;
  if (ctx.system) return true;
  if (name.startsWith(`sim-${ctx.tenant.id}-`)) return true;
  if (name === ctx.tenant.history_graph) return true;
  return ctx.tenant.graphs.includes(name);
}
export function assertGraphAccess(name: string, ctx: Ctx = currentContext()): void {
  if (!canSee(ctx, name)) throw notFound(`Unknown graph: ${name}`);
}
