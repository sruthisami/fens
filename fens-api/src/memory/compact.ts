import { fileURLToPath } from 'node:url';
import { closeDb, memoryGraph, type MemoryGraph } from '../graph/db.js';
import { runWithContext, tenantContext, tenants } from '../tenancy/context.js';
export const KEEP = 200;
export const DECAY_DAYS = 30;
export const DECAY = 0.8;
export const MIN_CONFIDENCE = 0.05;
export function isoWeek(iso: string): {
  week: string;
  start: string;
} {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return {
    week: `${thursday.getUTCFullYear()}-W${String(n).padStart(2, '0')}`,
    start: monday.toISOString(),
  };
}
interface Ep {
  id: string;
  type: string;
  agent: string;
  at: string;
  graph: string | null;
}
export async function compactGraph(
  m: MemoryGraph,
  now = new Date(),
  dryRun = false,
): Promise<{
  graph: string;
  summarised: number;
  weeks: number;
  decayed: number;
}> {
  const old = await m.read<Ep>(`MATCH (e:Episode) WHERE e.type <> 'summary'
     RETURN e.id AS id, e.type AS type, e.agent AS agent, e.at AS at, e.graph AS graph
     ORDER BY e.at DESC SKIP ${KEEP}`);
  const weeks = new Map<
    string,
    {
      start: string;
      eps: Ep[];
    }
  >();
  for (const e of old) {
    const w = isoWeek(e.at);
    const entry = weeks.get(w.week) ?? { start: w.start, eps: [] };
    entry.eps.push(e);
    weeks.set(w.week, entry);
  }
  if (!dryRun)
    for (const [week, { start, eps }] of weeks) {
      const count = (k: keyof Ep) => {
        const c: Record<string, number> = {};
        for (const e of eps) c[String(e[k] ?? 'none')] = (c[String(e[k] ?? 'none')] ?? 0) + 1;
        return Object.entries(c)
          .map(([x, n]) => `${x} ${n}`)
          .join(', ');
      };
      const line = `${eps.length} episodes (${count('type')}); agents ${count('agent')}; graphs ${count('graph')}`;
      await m.write(
        `MERGE (s:Episode {ref_key: $ref, type: 'summary'})
         ON CREATE SET s.id = $sid, s.agent = 'memory-compact', s.at = $start, s.graph = null,
                       s.summary = $prefix, s.count = 0, s.episode_ids = '[]'
         SET s.summary = s.summary + ' ' + $line, s.count = s.count + $n
         WITH s
         MATCH (e:Episode) WHERE e.id IN $ids
         DETACH DELETE e`,
        {
          ref: `week:${week}`,
          sid: `ep-summary-${week}`,
          start,
          prefix: `Week ${week} (compacted):`,
          line,
          n: eps.length,
          ids: eps.map((e) => e.id),
        },
      );
    }
  const cutoff = new Date(now.getTime() - DECAY_DAYS * 86400000).toISOString();
  const stale = await m.read<{
    n: number;
  }>(
    `MATCH (f:Fact) WHERE f.valid_to IS NULL AND coalesce(f.last_confirmed, f.valid_from) < $cutoff
       AND f.confidence > $min
     RETURN count(f) AS n`,
    { cutoff, min: MIN_CONFIDENCE },
  );
  if (!dryRun)
    await m.write(
      `MATCH (f:Fact) WHERE f.valid_to IS NULL AND coalesce(f.last_confirmed, f.valid_from) < $cutoff
         AND f.confidence > $min
       WITH f, f.confidence * $decay AS c
       SET f.confidence = CASE WHEN c < $min THEN $min ELSE c END, f.decayed_at = $now`,
      { cutoff, min: MIN_CONFIDENCE, decay: DECAY, now: now.toISOString() },
    );
  return { graph: m.name, summarised: old.length, weeks: weeks.size, decayed: stale[0]?.n ?? 0 };
}
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  for (const t of tenants()) {
    for (const scope of ['team', ...t.users.map((u) => u.id)]) {
      const ctx = tenantContext(t.id, scope === 'team' ? undefined : scope);
      const m = await memoryGraph(ctx, scope === 'team' ? 'team' : 'user');
      const r = await runWithContext(ctx, () => compactGraph(m, new Date(), dryRun));
      console.log(
        `${r.graph}: ${r.summarised} episode(s) summarised into ${r.weeks} week(s), ${r.decayed} fact(s) ${dryRun ? 'would lose' : 'lost'} confidence`,
      );
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
