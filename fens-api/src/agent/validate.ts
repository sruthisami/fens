import type { ReadOnlyGraph } from '../graph/db.js';
import { findingSchema, type FindingInput } from './types.js';
export interface Rejected {
  title: string;
  reason: string;
}
export function isValidWalk(path: string[], edgeSet: Set<string>): boolean {
  if (path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i++) {
    if (!edgeSet.has(`${path[i]} -> ${path[i + 1]}`)) {
      return false;
    }
  }
  return true;
}
export async function validateFindings(
  g: ReadOnlyGraph,
  raw: unknown[],
  note: (message: string) => void = () => {},
) {
  const screens = new Set(
    (
      await g.read<{
        id: string;
      }>('MATCH (s:Screen) RETURN s.id AS id')
    ).map((r) => r.id),
  );
  const components = new Set(
    (
      await g.read<{
        name: string;
      }>('MATCH (d:DesignSystemComponent) RETURN d.name AS name')
    ).map((r) => r.name),
  );
  const tasks = new Set(
    (
      await g.read<{
        id: string;
      }>('MATCH (t:Task) RETURN t.id AS id')
    ).map((r) => r.id),
  );
  const navigatesTo = await g.read<{
    from: string;
    to: string;
  }>('MATCH (a:Screen)-[:NAVIGATES_TO]->(b:Screen) RETURN a.id AS from, b.id AS to');
  const flowsTo = await g.read<{
    from: string;
    to: string;
  }>('MATCH (a:Screen)-[:FLOWS_TO]->(b:Screen) RETURN a.id AS from, b.id AS to');
  const navigatesToEdges = new Set(navigatesTo.map((e) => `${e.from} -> ${e.to}`));
  const flowsToEdges = new Set(flowsTo.map((e) => `${e.from} -> ${e.to}`));
  const valid: FindingInput[] = [];
  const rejected: Rejected[] = [];
  for (const item of raw) {
    const parsed = findingSchema.safeParse(item);
    const title = String(
      (
        item as {
          title?: unknown;
        }
      )?.title ?? 'untitled finding',
    );
    if (!parsed.success) {
      rejected.push({
        title,
        reason: `does not match the finding schema: ${parsed.error.issues[0]?.message ?? ''}`,
      });
      continue;
    }
    const f = { ...(item as FindingInput), ...parsed.data };
    const { type, id } = f.target;
    const targetOk =
      (type === 'screen' && screens.has(id)) ||
      (type === 'component' && components.has(id)) ||
      (type === 'task' && tasks.has(id));
    if (!targetOk) {
      rejected.push({ title, reason: `target ${type} "${id}" is not in the graph` });
      continue;
    }
    const bad: string[] = [];
    const evidence: typeof f.evidence = [];
    for (const e of f.evidence) {
      const unknown = [...e.screens, ...e.path].filter((s) => !screens.has(s));
      if (unknown.length) {
        bad.push(...unknown);
        continue;
      }
      if (e.screens.length === 0 && e.path.length === 0) {
        continue;
      }
      let validPath = e.path;
      let validScreens = e.screens;
      if (e.path && e.path.length > 0) {
        const isFlow = e.args?.edge_set === 'flow';
        const edgeSet = isFlow ? flowsToEdges : navigatesToEdges;
        if (!isValidWalk(e.path, edgeSet)) {
          const droppedPath = e.path;
          validScreens = [...new Set([...e.screens, ...droppedPath])];
          validPath = [];
          const why =
            droppedPath.length < 2
              ? `a path needs at least two screens (got ${droppedPath.length})`
              : 'it is not a walk in the graph (a consecutive pair is not linked)';
          note(
            `finding "${title}": dropped the path (${why}); kept ${validScreens.length} screens as an unordered list`,
          );
        } else {
          validScreens = [...new Set([...e.screens, ...e.path])];
          validPath = [...e.path];
        }
      } else {
        validScreens = [...new Set(e.screens)];
        validPath = [];
      }
      evidence.push({
        ...e,
        screens: validScreens,
        path: validPath,
      });
    }
    if (evidence.length === 0) {
      rejected.push({
        title,
        reason: bad.length
          ? `evidence cites screens that do not exist: ${[...new Set(bad)].join(', ')}`
          : 'no evidence with screens',
      });
      continue;
    }
    valid.push({ ...f, evidence });
  }
  return { valid, rejected };
}
