import { FalkorDB, type Graph } from 'falkordb';
import { env } from '../config/env.js';
import { HttpError, notFound } from '../http/errors.js';
import { assertGraphAccess, currentContext, type Ctx } from '../tenancy/context.js';
let connection: Promise<FalkorDB> | null = null;
async function db(): Promise<FalkorDB> {
  connection ??= FalkorDB.connect({ url: env.FALKORDB_URL }).catch((err: unknown) => {
    connection = null;
    console.error('FalkorDB connection failed:', err instanceof Error ? err.message : err);
    throw new HttpError(503, 'Graph database unavailable');
  });
  return connection;
}
export async function listGraphNames(): Promise<string[]> {
  return (await db()).list();
}
export interface ReadOnlyGraph {
  read<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}
export async function openGraph(name: string): Promise<ReadOnlyGraph> {
  assertGraphAccess(name);
  if (!(await listGraphNames()).includes(name)) throw notFound(`Unknown graph: ${name}`);
  const graph: Graph = (await db()).selectGraph(name);
  return {
    async read<T>(cypher: string, params?: Record<string, unknown>) {
      const reply = await graph.roQuery<T>(
        cypher,
        params ? { params: params as never } : undefined,
      );
      return reply.data ?? [];
    },
  };
}
export async function openFindingWriter(name: string) {
  assertGraphAccess(name);
  if (!(await listGraphNames()).includes(name)) throw notFound(`Unknown graph: ${name}`);
  const graph: Graph = (await db()).selectGraph(name);
  return {
    async write(cypher: string, params?: Record<string, unknown>): Promise<void> {
      await graph.query(cypher, params ? { params: params as never } : undefined);
    },
  };
}
export async function closeDb(): Promise<void> {
  if (connection) await (await connection).close();
  connection = null;
}
export const SIM_PREFIX = 'sim-';
const assertSim = (name: string) => {
  if (!name.startsWith(SIM_PREFIX))
    throw new Error(`Refusing to write to ${name}: not a sim- copy`);
};
export async function copyToSim(src: string, dest: string): Promise<void> {
  assertSim(dest);
  assertGraphAccess(src);
  assertGraphAccess(dest);
  if (!(await listGraphNames()).includes(src)) throw notFound(`Unknown graph: ${src}`);
  await deleteSim(dest);
  await (await db()).selectGraph(src).copy(dest);
}
export async function deleteSim(name: string): Promise<void> {
  assertSim(name);
  assertGraphAccess(name);
  if ((await listGraphNames()).includes(name)) await (await db()).selectGraph(name).delete();
}
export async function openSimWriter(name: string) {
  assertSim(name);
  assertGraphAccess(name);
  const graph: Graph = (await db()).selectGraph(name);
  return {
    async write(cypher: string, params?: Record<string, unknown>): Promise<void> {
      await graph.query(cypher, params ? { params: params as never } : undefined);
    },
  };
}
export const HISTORY_GRAPH = 'flowlens-history';
export async function openHistoryWriter() {
  const graph: Graph = (await db()).selectGraph(HISTORY_GRAPH);
  return {
    async write(cypher: string, params?: Record<string, unknown>): Promise<void> {
      await graph.query(cypher, params ? { params: params as never } : undefined);
    },
  };
}
export async function hasGraph(name: string): Promise<boolean> {
  return (await listGraphNames()).includes(name);
}
export type MemoryScope = 'team' | 'user';
export const MEMORY_GRAPH = /^[a-z0-9_]+$/;
export interface MemoryGraph {
  name: string;
  scope: MemoryScope;
  read<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
  write<T = unknown>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}
const memoryIndexed = new Set<string>();
const MEMORY_INDEXES = [
  'CREATE INDEX FOR (e:Episode) ON (e.id)',
  'CREATE INDEX FOR (e:Episode) ON (e.at)',
  'CREATE INDEX FOR (f:Fact) ON (f.id)',
  'CREATE INDEX FOR (f:Fact) ON (f.subject)',
  'CREATE INDEX FOR (h:Handoff) ON (h.id)',
  'CREATE INDEX FOR (h:Handoff) ON (h.status)',
  'CREATE INDEX FOR (s:State) ON (s.key)',
  'CREATE INDEX FOR (p:Playbook) ON (p.id)',
  'CREATE INDEX FOR (p:Procedure) ON (p.id)',
  'CREATE INDEX FOR (s:Session) ON (s.id)',
];
export function memoryGraphName(ctx: Ctx, scope: MemoryScope): string {
  if (ctx.system) throw new Error('The system context has no memory graph.');
  const t = ctx.tenant.id.replace(/-/g, '_');
  const name = scope === 'team' ? `mem_${t}` : `memu_${t}_${ctx.user.id.replace(/-/g, '_')}`;
  if (!MEMORY_GRAPH.test(name)) throw new Error(`Invalid memory graph name ${name}`);
  return name;
}
export async function memoryGraph(ctx: Ctx, scope: MemoryScope): Promise<MemoryGraph> {
  const name = memoryGraphName(ctx, scope);
  const graph: Graph = (await db()).selectGraph(name);
  const run = async <T>(ro: boolean, cypher: string, params?: Record<string, unknown>) => {
    const opts = params ? { params: params as never } : undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        const reply = ro
          ? await graph.roQuery<T>(cypher, opts)
          : await graph.query<T>(cypher, opts);
        return reply.data ?? [];
      } catch (err) {
        if (!/Max pending queries exceeded/.test((err as Error).message) || attempt >= 30)
          throw err;
        await new Promise((r) => setTimeout(r, 2 + Math.random() * 5 * (attempt + 1)));
      }
    }
  };
  if (!memoryIndexed.has(name)) {
    for (const q of MEMORY_INDEXES) await graph.query(q).catch(() => {});
    memoryIndexed.add(name);
  }
  return {
    name,
    scope,
    read: <T>(cypher: string, params?: Record<string, unknown>) => run<T>(true, cypher, params),
    write: <T>(cypher: string, params?: Record<string, unknown>) => run<T>(false, cypher, params),
  };
}
export async function copyGraph(src: string, dest: string): Promise<void> {
  if (!currentContext().system) throw new Error('Only the system context copies site graphs.');
  if (!(await listGraphNames()).includes(src)) throw notFound(`Unknown graph: ${src}`);
  await (await db()).selectGraph(src).copy(dest);
}
