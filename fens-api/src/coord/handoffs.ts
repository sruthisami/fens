import { randomBytes } from 'node:crypto';
import { memoryGraph, type MemoryGraph } from '../graph/db.js';
import type { Ctx } from '../tenancy/context.js';
export const HANDOFF_KINDS = [
  'scan_requested',
  'proposals_ready',
  'decision_ready',
  'release_resolved',
  'needs_human',
] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];
export const AGENT_NAMES = ['ux', 'seo', 'decider', 'channels', 'closer', 'human'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export const CLAIM_TIMEOUT_MS = Number(process.env.HANDOFF_CLAIM_TIMEOUT_MS) || 60000;
export const MAX_ATTEMPTS = 3;
export interface Handoff {
  id: string;
  kind: HandoffKind;
  from_agent: string;
  to_agent: string;
  payload_key: string;
  status: 'pending' | 'claimed' | 'done' | 'failed';
  claimed_by: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  done_at: number | null;
  attempts: number;
  error: string | null;
  run_id: string | null;
  graph: string | null;
  result: string | null;
}
const toHandoff = (p: Record<string, unknown>): Handoff => ({
  id: String(p.id),
  kind: p.kind as HandoffKind,
  from_agent: String(p.from_agent),
  to_agent: String(p.to_agent),
  payload_key: String(p.payload_key),
  status: p.status as Handoff['status'],
  claimed_by: (p.claimed_by as string) ?? null,
  version: Number(p.version ?? 0),
  created_at: Number(p.created_at),
  updated_at: Number(p.updated_at),
  claimed_at: p.claimed_at === undefined || p.claimed_at === null ? null : Number(p.claimed_at),
  done_at: p.done_at === undefined || p.done_at === null ? null : Number(p.done_at),
  attempts: Number(p.attempts ?? 0),
  error: (p.error as string) ?? null,
  run_id: (p.run_id as string) ?? null,
  graph: (p.graph as string) ?? null,
  result: (p.result as string) ?? null,
});
export const newRunId = () => `run-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const team = (ctx: Ctx): Promise<MemoryGraph> => memoryGraph(ctx, 'team');
export async function createHandoff(
  ctx: Ctx,
  h: {
    kind: HandoffKind;
    from_agent: string;
    to_agent: AgentName;
    payload_key: string;
    run_id?: string | null;
    graph?: string | null;
    id?: string;
  },
): Promise<Handoff> {
  const m = await team(ctx);
  const id = h.id ?? `h-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const rows = await m.write<{
    h: Record<string, unknown>;
  }>(
    `MERGE (h:Handoff {id: $id})
     ON CREATE SET h.kind = $kind, h.from_agent = $from, h.to_agent = $to, h.payload_key = $payload,
       h.status = 'pending', h.version = 0, h.created_at = $now, h.updated_at = $now, h.attempts = 0,
       h.run_id = $run, h.graph = $graph
     RETURN properties(h) AS h`,
    {
      id,
      kind: h.kind,
      from: h.from_agent,
      to: h.to_agent,
      payload: h.payload_key,
      now: Date.now(),
      run: h.run_id ?? null,
      graph: h.graph ?? null,
    },
  );
  return toHandoff(rows[0]!.h);
}
export async function claimHandoff(
  ctx: Ctx,
  agent: string,
  claimer: string,
): Promise<Handoff | null> {
  const m = await team(ctx);
  const now = Date.now();
  const rows = await m.write<{
    h: Record<string, unknown>;
  }>(
    `MATCH (h:Handoff {status: 'pending', to_agent: $agent})
     WITH h ORDER BY h.created_at ASC, h.id ASC LIMIT 1
     SET h.status = 'claimed', h.claimed_by = $claimer, h.version = h.version + 1,
         h.claimed_at = $now, h.updated_at = $now
     RETURN properties(h) AS h`,
    { agent, claimer, now },
  );
  return rows[0] ? toHandoff(rows[0].h) : null;
}
export async function completeHandoff(
  ctx: Ctx,
  id: string,
  claimer: string,
  version: number,
  result = '',
): Promise<Handoff | null> {
  const m = await team(ctx);
  const now = Date.now();
  const rows = await m.write<{
    h: Record<string, unknown>;
  }>(
    `MATCH (h:Handoff {id: $id})
     WHERE h.status = 'claimed' AND h.claimed_by = $claimer AND h.version = $v
     SET h.status = 'done', h.version = $v + 1, h.updated_at = $now, h.done_at = $now, h.result = $result
     RETURN properties(h) AS h`,
    { id, claimer, v: version, now, result: result.slice(0, 2000) },
  );
  return rows[0] ? toHandoff(rows[0].h) : null;
}
export async function failHandoff(
  ctx: Ctx,
  id: string,
  claimer: string,
  version: number,
  error: string,
): Promise<Handoff | null> {
  const m = await team(ctx);
  const now = Date.now();
  const rows = await m.write<{
    h: Record<string, unknown>;
  }>(
    `MATCH (h:Handoff {id: $id})
     WHERE h.status = 'claimed' AND h.claimed_by = $claimer AND h.version = $v
     WITH h, h.attempts + 1 AS n
     SET h.attempts = n, h.status = CASE WHEN n >= $max THEN 'failed' ELSE 'pending' END,
         h.claimed_by = null, h.version = $v + 1, h.updated_at = $now, h.error = $error
     RETURN properties(h) AS h`,
    { id, claimer, v: version, now, error: error.slice(0, 500), max: MAX_ATTEMPTS },
  );
  return rows[0] ? toHandoff(rows[0].h) : null;
}
export async function reapExpired(
  ctx: Ctx,
  timeoutMs = CLAIM_TIMEOUT_MS,
  now = Date.now(),
): Promise<Handoff[]> {
  const m = await team(ctx);
  const rows = await m.write<{
    h: Record<string, unknown>;
  }>(
    `MATCH (h:Handoff {status: 'claimed'}) WHERE h.updated_at < $cutoff
     WITH h, h.attempts + 1 AS n
     SET h.attempts = n, h.status = CASE WHEN n >= $max THEN 'failed' ELSE 'pending' END,
         h.error = 'claim expired: ' + coalesce(h.claimed_by, 'unknown') + ' did not finish',
         h.claimed_by = null, h.version = h.version + 1, h.updated_at = $now
     RETURN properties(h) AS h`,
    { cutoff: now - timeoutMs, max: MAX_ATTEMPTS, now },
  );
  return rows.map((r) => toHandoff(r.h));
}
export async function listHandoffs(
  ctx: Ctx,
  q: {
    run_id?: string;
    status?: string;
    to_agent?: string;
    limit?: number;
  } = {},
): Promise<Handoff[]> {
  const m = await team(ctx);
  const limit = Math.max(1, Math.min(500, Math.trunc(q.limit ?? 200)));
  const rows = await m.read<{
    h: Record<string, unknown>;
  }>(
    `MATCH (h:Handoff)
     WHERE ($run IS NULL OR h.run_id = $run) AND ($status IS NULL OR h.status = $status)
       AND ($to IS NULL OR h.to_agent = $to)
     RETURN properties(h) AS h ORDER BY h.created_at DESC LIMIT ${limit}`,
    { run: q.run_id ?? null, status: q.status ?? null, to: q.to_agent ?? null },
  );
  return rows.map((r) => toHandoff(r.h));
}
