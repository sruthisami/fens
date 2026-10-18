import { memoryGraph } from '../graph/db.js';
import type { Ctx } from '../tenancy/context.js';
import { rememberFact, writeEpisode, type Episode } from './memory.js';
export function factKey(
  findingKey: string,
  category?: string,
): {
  subject: string;
  predicate: string;
} {
  const parts = findingKey.split('|');
  const t = parts.findIndex((p) => /^(component|screen|task):/.test(p));
  const subject = t >= 0 ? (parts[t] as string) : findingKey;
  const rule = t >= 0 ? parts[t + 1] : undefined;
  const cat = category ?? (t > 0 ? parts[t - 1] : parts[0]);
  return { subject, predicate: `has ${rule ?? cat} finding` };
}
export const openIn = (graph: string) => `open (seen in ${graph})`;
export const fixedIn = (graph: string) => `fixed in ${graph}`;
const graphOf = (object: string) =>
  /(?:seen in|fixed in) ([a-z0-9][a-z0-9_-]*)/.exec(object)?.[1] ?? null;
export function newer(ctx: Ctx, a: string, b: string): boolean {
  const i = ctx.tenant.graphs.indexOf(a);
  const j = ctx.tenant.graphs.indexOf(b);
  return i >= 0 && j >= 0 && i > j;
}
async function currentObject(ctx: Ctx, subject: string, predicate: string): Promise<string | null> {
  const m = await memoryGraph(ctx, 'team');
  const rows = await m.read<{
    o: string;
  }>(
    'MATCH (f:Fact {subject: $s, predicate: $p}) WHERE f.valid_to IS NULL RETURN f.object AS o LIMIT 1',
    { s: subject, p: predicate },
  );
  return rows[0]?.o ?? null;
}
export async function rememberFindings(
  ctx: Ctx,
  graph: string,
  findings: {
    key: string;
    category: string;
  }[],
  episode: Episode,
): Promise<string[]> {
  const ids: string[] = [];
  for (const f of findings) {
    const { subject, predicate } = factKey(f.key, f.category);
    const cur = await currentObject(ctx, subject, predicate);
    const curGraph = cur ? graphOf(cur) : null;
    if (curGraph && curGraph !== graph && newer(ctx, curGraph, graph)) continue;
    const r = await rememberFact(ctx, {
      subject,
      predicate,
      object: openIn(graph),
      confidence: 0.9,
      source_episode: episode.id,
    });
    ids.push(r.fact.id);
  }
  return ids;
}
export interface ComparisonLike {
  findings: {
    resolved: {
      key: string;
      title: string;
    }[];
    persisting: {
      key: string;
      title: string;
    }[];
    new: {
      key: string;
      title: string;
    }[];
  };
  issues: {
    fixed: unknown[];
    new: unknown[];
  };
  health: {
    from: {
      score: number;
    };
    to: {
      score: number;
    };
  };
}
export async function rememberComparison(
  ctx: Ctx,
  from: string,
  to: string,
  diff: ComparisonLike,
): Promise<{
  episode: Episode;
  fixed: string[];
  open: string[];
  superseded: string[];
}> {
  const episode = await writeEpisode(ctx, {
    type: 'release_scan',
    agent: 'release-diff',
    summary: `${from} to ${to}: health ${diff.health.from.score} to ${diff.health.to.score}; ${diff.findings.resolved.length} findings resolved, ${diff.findings.persisting.length} persisting, ${diff.findings.new.length} new; ${diff.issues.fixed.length} issues fixed, ${diff.issues.new.length} new.`,
    graph: to,
    ref_key: `${from}->${to}`,
  });
  const fixed: string[] = [];
  const open: string[] = [];
  const superseded: string[] = [];
  for (const f of diff.findings.resolved) {
    const r = await rememberFact(ctx, {
      ...factKey(f.key),
      object: fixedIn(to),
      confidence: 0.95,
      source_episode: episode.id,
    });
    fixed.push(r.fact.id);
    superseded.push(...r.superseded);
  }
  for (const f of [...diff.findings.persisting, ...diff.findings.new]) {
    const r = await rememberFact(ctx, {
      ...factKey(f.key),
      object: openIn(to),
      confidence: 0.9,
      source_episode: episode.id,
    });
    open.push(r.fact.id);
    superseded.push(...r.superseded);
  }
  return { episode, fixed, open, superseded };
}
