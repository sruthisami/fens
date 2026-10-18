import type { ReadOnlyGraph } from '../graph/db.js';
import { JS_ONLY, jsOnlyPredicate } from '../lens/jsOnly.js';
import { compareTask } from '../tools/graphTools.js';
export const LENS_WEIGHTS = {
  issue: { critical: 10, serious: 10, moderate: 5, minor: 2 },
  orphan: 5,
  deadEnd: 5,
  detourClick: 2,
  mobileOverflow: 5,
  homeLinkAbove: 1,
  unreachableByLinks: 5,
  depthAbove: 2,
  jsOnly: 5,
  tableLost: 5,
} as const;
export const HOME_LINK_LIMIT = 12;
export const MAX_LINK_DEPTH = 3;
export const JS_ONLY_LIMIT = JS_ONLY.ratio;
export interface Part {
  key: string;
  label: string;
  count: number;
  points: number;
}
export interface LensScore {
  score: number;
  parts: Part[];
}
export interface LensScores {
  ux: LensScore;
  seo: LensScore;
}
const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;
const score = (parts: Part[]): LensScore => ({
  score: Math.max(0, 100 - parts.reduce((n, p) => n + p.points, 0)),
  parts,
});
const one = async (g: ReadOnlyGraph, cypher: string, params?: Record<string, unknown>) =>
  (
    await g.read<{
      n: number;
    }>(cypher, params)
  )[0]?.n ?? 0;
async function issueParts(
  g: ReadOnlyGraph,
  lenses: string[],
  allowedOnly: boolean,
): Promise<Part[]> {
  const rows = await g.read<{
    severity: string;
    n: number;
  }>(
    `MATCH (i:Issue)-[:VIOLATES]->(gl:Guideline)
     WHERE gl.lens IN $lenses AND coalesce(i.status, 'open') = 'open'
     MATCH (i)-[:FOUND_ON]->(s:Screen)
     WHERE ${allowedOnly ? 'coalesce(s.robots_disallowed, false) = false' : 'true'}
     WITH DISTINCT i
     RETURN i.severity AS severity, count(i) AS n`,
    { lenses },
  );
  return SEVERITIES.map((sev) => {
    const count = rows.find((r) => r.severity === sev)?.n ?? 0;
    return {
      key: `issues_${sev}`,
      label: `open ${lenses.join('/')} issues: ${sev}`,
      count,
      points: count * LENS_WEIGHTS.issue[sev],
    };
  });
}
async function startScreen(g: ReadOnlyGraph): Promise<string> {
  const rows = await g.read<{
    id: string;
  }>(
    "MATCH (s:Screen) WHERE s.discovered_via = 'start' RETURN s.id AS id ORDER BY s.depth LIMIT 1",
  );
  return rows[0]?.id ?? '/';
}
export async function lensScores(
  g: ReadOnlyGraph,
  baselineTables?: Set<string>,
): Promise<LensScores> {
  const start = await startScreen(g);
  const tasks = (await compareTask.run(g, {} as never, { graph: '' })).result as {
    tasks: {
      detour: number | null;
    }[];
  };
  const detour = tasks.tasks.reduce((n, t) => n + Math.max(0, t.detour ?? 0), 0);
  const homeLinks = await one(
    g,
    "MATCH (:Screen {id: $id})-[e:NAVIGATES_TO]->(:Screen) WHERE e.via = 'link' RETURN count(e) AS n",
    { id: start },
  );
  const orphans = await one(
    g,
    'MATCH (s:Screen) WHERE NOT ()-[:NAVIGATES_TO]->(s) RETURN count(s) AS n',
  );
  const deadEnds = await one(
    g,
    'MATCH (s:Screen) WHERE NOT (s)-[:NAVIGATES_TO]->() RETURN count(s) AS n',
  );
  const overflow = await one(
    g,
    'MATCH (s:Screen) WHERE s.mobile_overflow = true RETURN count(s) AS n',
  );
  const above = Math.max(0, homeLinks - HOME_LINK_LIMIT);
  const ux = score([
    ...(await issueParts(g, ['UX'], false)),
    {
      key: 'orphans',
      label: 'orphan screens',
      count: orphans,
      points: orphans * LENS_WEIGHTS.orphan,
    },
    {
      key: 'dead_ends',
      label: 'dead-end screens',
      count: deadEnds,
      points: deadEnds * LENS_WEIGHTS.deadEnd,
    },
    {
      key: 'detour',
      label: 'task detour (forced minus shortest clicks)',
      count: detour,
      points: detour * LENS_WEIGHTS.detourClick,
    },
    {
      key: 'mobile_overflow',
      label: 'screens wider than a phone',
      count: overflow,
      points: overflow * LENS_WEIGHTS.mobileOverflow,
    },
    {
      key: 'choice_overload',
      label: `links on ${start} above ${HOME_LINK_LIMIT}`,
      count: above,
      points: above * LENS_WEIGHTS.homeLinkAbove,
    },
  ]);
  const allowed = 'coalesce(s.robots_disallowed, false) = false';
  const unreachable = await one(
    g,
    `MATCH (s:Screen) WHERE ${allowed} AND s.link_depth IS NULL RETURN count(s) AS n`,
  );
  const depthRows = await g.read<{
    d: number;
  }>(
    `MATCH (s:Screen) WHERE ${allowed} AND s.link_depth > ${MAX_LINK_DEPTH} RETURN s.link_depth AS d`,
  );
  const depthLevels = depthRows.reduce((n, r) => n + (r.d - MAX_LINK_DEPTH), 0);
  const jsOnly = await one(
    g,
    `MATCH (s:Screen) WHERE ${jsOnlyPredicate('s')} RETURN count(s) AS n`,
  );
  const tables = new Set(
    (
      await g.read<{
        id: string;
      }>(`MATCH (s:Screen) WHERE ${allowed} AND s.has_table = true RETURN s.id AS id`)
    ).map((r) => r.id),
  );
  const baseline = baselineTables ?? tables;
  const lost = [...baseline].filter((id) => !tables.has(id)).length;
  const seo = score([
    ...(await issueParts(g, ['SEO', 'AEO'], true)),
    {
      key: 'unreachable_by_links',
      label: 'screens unreachable by links',
      count: unreachable,
      points: unreachable * LENS_WEIGHTS.unreachableByLinks,
    },
    {
      key: 'link_depth',
      label: `link depth levels above ${MAX_LINK_DEPTH}`,
      count: depthLevels,
      points: depthLevels * LENS_WEIGHTS.depthAbove,
    },
    {
      key: 'js_only',
      label: `indexable content screens with more than ${JS_ONLY_LIMIT * 100}% of their text only after JavaScript`,
      count: jsOnly,
      points: jsOnly * LENS_WEIGHTS.jsOnly,
    },
    {
      key: 'table_lost',
      label: 'semantic tables lost (extractability)',
      count: lost,
      points: lost * LENS_WEIGHTS.tableLost,
    },
  ]);
  return { ux, seo };
}
export async function tableScreens(g: ReadOnlyGraph): Promise<Set<string>> {
  return new Set(
    (
      await g.read<{
        id: string;
      }>(
        'MATCH (s:Screen) WHERE coalesce(s.robots_disallowed, false) = false AND s.has_table = true RETURN s.id AS id',
      )
    ).map((r) => r.id),
  );
}
