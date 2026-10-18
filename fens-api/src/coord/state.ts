import { memoryGraph } from '../graph/db.js';
import type { Ctx } from '../tenancy/context.js';
export interface StateRow<T = unknown> {
  key: string;
  value: T;
  version: number;
}
export async function getState<T>(ctx: Ctx, key: string): Promise<StateRow<T> | null> {
  const m = await memoryGraph(ctx, 'team');
  const rows = await m.read<{
    key: string;
    value: string;
    version: number;
  }>('MATCH (s:State {key: $key}) RETURN s.key AS key, s.value AS value, s.version AS version', {
    key,
  });
  const r = rows[0];
  return r ? { key: r.key, value: JSON.parse(r.value) as T, version: r.version } : null;
}
export async function casState(
  ctx: Ctx,
  key: string,
  version: number,
  value: unknown,
): Promise<number | null> {
  const m = await memoryGraph(ctx, 'team');
  const json = JSON.stringify(value);
  const rows =
    version === 0
      ? await m.write<{
          v: number;
        }>(
          `OPTIONAL MATCH (s:State {key: $key}) WITH s WHERE s IS NULL
           CREATE (n:State {key: $key, value: $value, version: 1}) RETURN n.version AS v`,
          { key, value: json },
        )
      : await m.write<{
          v: number;
        }>(
          `MATCH (s:State {key: $key}) WHERE s.version = $v
           SET s.value = $value, s.version = $v + 1 RETURN s.version AS v`,
          { key, v: version, value: json },
        );
  return rows[0]?.v ?? null;
}
export async function updateState<T>(
  ctx: Ctx,
  key: string,
  change: (current: T | null) => T,
  tries = 20,
): Promise<{
  value: T;
  version: number;
}> {
  for (let i = 0; i < tries; i++) {
    const cur = await getState<T>(ctx, key);
    const next = change(cur ? cur.value : null);
    const v = await casState(ctx, key, cur?.version ?? 0, next);
    if (v !== null) return { value: next, version: v };
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (i + 1)));
  }
  throw new Error(`State ${key}: too many concurrent writers`);
}
export async function takeFlag(ctx: Ctx, key: string, holder: string): Promise<boolean> {
  const cur = await getState<{
    on: boolean;
    by: string | null;
  }>(ctx, key);
  if (cur?.value.on) return false;
  return (
    (await casState(ctx, key, cur?.version ?? 0, {
      on: true,
      by: holder,
      at: new Date().toISOString(),
    })) !== null
  );
}
export async function releaseFlag(ctx: Ctx, key: string, holder: string): Promise<void> {
  const cur = await getState<{
    on: boolean;
    by: string | null;
  }>(ctx, key);
  if (cur?.value.on && cur.value.by === holder)
    await casState(ctx, key, cur.version, { on: false, by: null, at: new Date().toISOString() });
}
