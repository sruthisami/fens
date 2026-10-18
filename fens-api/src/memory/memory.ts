import { randomBytes } from 'node:crypto';
import { memoryGraph, type MemoryGraph, type MemoryScope } from '../graph/db.js';
import type { Ctx } from '../tenancy/context.js';
export const EPISODE_TYPES = [
  'run',
  'decision',
  'chat',
  'release_scan',
  'handoff',
  'summary',
] as const;
export type EpisodeType = (typeof EPISODE_TYPES)[number];
export interface Episode {
  id: string;
  type: EpisodeType;
  agent: string;
  summary: string;
  at: string;
  graph: string | null;
  ref_key: string | null;
  scope: MemoryScope;
}
export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  kind: 'fact' | 'preference';
  confidence: number;
  valid_from: string;
  valid_to: string | null;
  source_episode: string | null;
  last_confirmed: string | null;
  superseded_by: string | null;
  supersedes: string[];
  scope: MemoryScope;
}
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const nowIso = () => new Date().toISOString();
const limitOf = (n: unknown, max = 500) => Math.max(1, Math.min(max, Math.trunc(Number(n) || 50)));
export async function writeEpisode(
  ctx: Ctx,
  e: {
    type: EpisodeType;
    agent: string;
    summary: string;
    graph?: string | null;
    ref_key?: string | null;
  },
  scope: MemoryScope = 'team',
): Promise<Episode> {
  const m = await memoryGraph(ctx, scope);
  const episode = {
    id: newId('ep'),
    type: e.type,
    agent: e.agent,
    summary: e.summary.slice(0, 2000),
    at: nowIso(),
    graph: e.graph ?? null,
    ref_key: e.ref_key ?? null,
  };
  await m.write('CREATE (e:Episode) SET e = $e', { e: episode });
  return { ...episode, scope };
}
interface EpisodeRow {
  e: Omit<Episode, 'scope'>;
}
export async function recallEpisodes(
  ctx: Ctx,
  q: {
    agent?: string;
    type?: string;
    since?: string;
    limit?: number;
    scope?: MemoryScope | 'both';
  } = {},
): Promise<Episode[]> {
  const scopes: MemoryScope[] = q.scope === 'both' ? ['team', 'user'] : [q.scope ?? 'team'];
  const out: Episode[] = [];
  for (const scope of scopes) {
    const m = await memoryGraph(ctx, scope);
    const rows = await m.read<EpisodeRow>(
      `MATCH (e:Episode)
       WHERE ($agent IS NULL OR e.agent = $agent) AND ($type IS NULL OR e.type = $type)
         AND ($since IS NULL OR e.at >= $since)
       RETURN properties(e) AS e ORDER BY e.at DESC LIMIT ${limitOf(q.limit)}`,
      { agent: q.agent ?? null, type: q.type ?? null, since: q.since ?? null },
    );
    out.push(
      ...rows.map((r) => ({
        ...r.e,
        graph: r.e.graph ?? null,
        ref_key: r.e.ref_key ?? null,
        scope,
      })),
    );
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limitOf(q.limit));
}
export interface RememberInput {
  subject: string;
  predicate: string;
  object: string;
  kind?: 'fact' | 'preference';
  confidence?: number;
  source_episode?: string | null;
}
export interface RememberResult {
  fact: Fact;
  status: 'created' | 'reconfirmed';
  superseded: string[];
}
export const scopeOfKind = (kind: 'fact' | 'preference'): MemoryScope =>
  kind === 'preference' ? 'user' : 'team';
export async function rememberFact(
  ctx: Ctx,
  input: RememberInput,
  scope?: MemoryScope,
): Promise<RememberResult> {
  const kind = input.kind ?? 'fact';
  const m = await memoryGraph(ctx, scope ?? scopeOfKind(kind));
  const now = nowIso();
  const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.9));
  const fact = {
    id: newId('f'),
    subject: input.subject.slice(0, 200),
    predicate: input.predicate.slice(0, 200),
    object: input.object.slice(0, 500),
    kind,
    confidence,
    valid_from: now,
    source_episode: input.source_episode ?? null,
    last_confirmed: now,
  };
  const created = await m.write<{
    id: string;
    superseded: string[];
  }>(
    `OPTIONAL MATCH (same:Fact {subject: $f.subject, predicate: $f.predicate, object: $f.object})
     WHERE same.valid_to IS NULL
     WITH same WHERE same IS NULL
     CREATE (n:Fact)
     SET n = $f
     WITH n
     OPTIONAL MATCH (old:Fact {subject: $f.subject, predicate: $f.predicate})
     WHERE old.valid_to IS NULL AND old.id <> n.id
     FOREACH (o IN CASE WHEN old IS NULL THEN [] ELSE [old] END |
       SET o.valid_to = $now
       CREATE (n)-[:SUPERSEDES]->(o))
     RETURN n.id AS id, collect(old.id) AS superseded`,
    { f: fact, now },
  );
  if (created[0]) {
    const superseded = created[0].superseded.filter(Boolean);
    return {
      fact: toFact({ ...fact, valid_to: null }, m.scope, null, superseded),
      status: 'created',
      superseded,
    };
  }
  const same = await m.write<{
    f: Record<string, unknown>;
  }>(
    `MATCH (f:Fact {subject: $s, predicate: $p, object: $o}) WHERE f.valid_to IS NULL
     SET f.last_confirmed = $now,
         f.confidence = CASE WHEN $c > f.confidence THEN $c ELSE f.confidence END
     RETURN properties(f) AS f`,
    { s: fact.subject, p: fact.predicate, o: fact.object, now, c: confidence },
  );
  return {
    fact: toFact(same[0]?.f ?? fact, m.scope, null, []),
    status: 'reconfirmed',
    superseded: [],
  };
}
function toFact(
  p: Record<string, unknown>,
  scope: MemoryScope,
  supersededBy: string | null,
  supersedes: string[],
): Fact {
  return {
    id: String(p.id),
    subject: String(p.subject),
    predicate: String(p.predicate),
    object: String(p.object),
    kind: p.kind === 'preference' ? 'preference' : 'fact',
    confidence: Number(p.confidence ?? 0),
    valid_from: String(p.valid_from),
    valid_to: (p.valid_to as string) ?? null,
    source_episode: (p.source_episode as string) ?? null,
    last_confirmed: (p.last_confirmed as string) ?? null,
    superseded_by: supersededBy,
    supersedes,
    scope,
  };
}
async function factsIn(
  m: MemoryGraph,
  q: {
    subject?: string | null;
    keyword?: string | null;
    kind?: string | null;
    include_history?: boolean;
    limit?: number;
  },
): Promise<Fact[]> {
  const rows = await m.read<{
    f: Record<string, unknown>;
    by: string | null;
    sup: string[];
  }>(
    `MATCH (f:Fact)
     WHERE ($subject IS NULL OR f.subject = $subject)
       AND ($kind IS NULL OR f.kind = $kind)
       AND ($history OR f.valid_to IS NULL)
       AND ($kw IS NULL OR toLower(f.subject) CONTAINS $kw OR toLower(f.predicate) CONTAINS $kw
            OR toLower(f.object) CONTAINS $kw)
     OPTIONAL MATCH (newer:Fact)-[:SUPERSEDES]->(f)
     OPTIONAL MATCH (f)-[:SUPERSEDES]->(older:Fact)
     RETURN properties(f) AS f, newer.id AS by, collect(older.id) AS sup
     ORDER BY f.valid_from DESC LIMIT ${limitOf(q.limit)}`,
    {
      subject: q.subject ?? null,
      kind: q.kind ?? null,
      history: !!q.include_history,
      kw: q.keyword ? q.keyword.toLowerCase() : null,
    },
  );
  return rows.map((r) => toFact(r.f, m.scope, r.by ?? null, (r.sup ?? []).filter(Boolean)));
}
export async function recall(
  ctx: Ctx,
  q: {
    subject?: string;
    keyword?: string;
    include_history?: boolean;
    limit?: number;
  } = {},
): Promise<Fact[]> {
  const out: Fact[] = [];
  for (const scope of ['team', 'user'] as const)
    out.push(...(await factsIn(await memoryGraph(ctx, scope), q)));
  return out.sort((a, b) => b.valid_from.localeCompare(a.valid_from)).slice(0, limitOf(q.limit));
}
export async function getPreferences(ctx: Ctx): Promise<Fact[]> {
  const out: Fact[] = [];
  for (const scope of ['user', 'team'] as const)
    out.push(...(await factsIn(await memoryGraph(ctx, scope), { kind: 'preference' })));
  return out;
}
export interface PlaybookStats {
  id: string;
  name: string;
  success_count: number;
  fail_count: number;
  rate: number | null;
}
export async function creditPlaybook(
  ctx: Ctx,
  pb: {
    id: string;
    name: string;
    pattern?: string;
    change_type?: string;
  },
  decisionKey: string,
  outcome: 'success' | 'fail',
): Promise<{
  counted: boolean;
}> {
  const m = await memoryGraph(ctx, 'team');
  const rows = await m.write<{
    s: number;
  }>(
    `MERGE (p:Playbook {id: $id})
     ON CREATE SET p.success_count = 0, p.fail_count = 0
     SET p.name = $name, p.pattern = $pattern, p.change_type = $ct
     WITH p
     OPTIONAL MATCH (c:Credit {key: $key})
     WITH p, c WHERE c IS NULL
     CREATE (:Credit {key: $key, playbook: $id, outcome: $outcome, at: $now})
     SET p.success_count = p.success_count + $s, p.fail_count = p.fail_count + $f
     RETURN p.success_count AS s`,
    {
      id: pb.id,
      name: pb.name,
      pattern: pb.pattern ?? null,
      ct: pb.change_type ?? null,
      key: `${decisionKey}|${pb.id}`,
      outcome,
      now: nowIso(),
      s: outcome === 'success' ? 1 : 0,
      f: outcome === 'fail' ? 1 : 0,
    },
  );
  return { counted: rows.length > 0 };
}
export const successRate = (s: number, f: number) => (s + 1) / (s + f + 2);
export async function playbookStats(ctx: Ctx): Promise<PlaybookStats[]> {
  const m = await memoryGraph(ctx, 'team');
  const rows = await m.read<{
    id: string;
    name: string;
    s: number;
    f: number;
  }>(
    'MATCH (p:Playbook) RETURN p.id AS id, p.name AS name, p.success_count AS s, p.fail_count AS f ORDER BY id',
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    success_count: r.s ?? 0,
    fail_count: r.f ?? 0,
    rate: (r.s ?? 0) + (r.f ?? 0) > 0 ? (r.s ?? 0) / ((r.s ?? 0) + (r.f ?? 0)) : null,
  }));
}
export async function useProcedure(
  ctx: Ctx,
  agent: string,
  name: string,
  steps: string[],
): Promise<void> {
  const m = await memoryGraph(ctx, 'team');
  await m.write(
    `MERGE (p:Procedure {id: $id})
     ON CREATE SET p.uses = 0
     SET p.name = $name, p.agent = $agent, p.steps = $steps, p.uses = p.uses + 1, p.last_used = $now`,
    { id: `${agent}-investigation`, name, agent, steps: JSON.stringify(steps), now: nowIso() },
  );
}
export async function procedures(ctx: Ctx) {
  const m = await memoryGraph(ctx, 'team');
  const rows = await m.read<{
    p: Record<string, unknown>;
  }>('MATCH (p:Procedure) RETURN properties(p) AS p ORDER BY p.id');
  return rows.map(({ p }) => ({
    id: String(p.id),
    name: String(p.name),
    agent: String(p.agent),
    steps: JSON.parse(String(p.steps ?? '[]')) as string[],
    uses: Number(p.uses ?? 0),
    last_used: (p.last_used as string) ?? null,
  }));
}
