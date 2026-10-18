import type { CrawlResult } from '../types.js';
export interface CrawlSummary {
  screens: number;
  edges: number;
  linkEdges: number;
  jsEdges: number;
  components: number;
  orphans: string[];
  deadEnds: string[];
  issues: {
    total: number;
    occurrences: number;
    bySource: Record<string, number>;
    bySeverity: Record<string, number>;
  };
}
const count = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
export function summarize(result: CrawlResult): CrawlSummary {
  const inbound = new Set(result.edges.map((e) => e.to));
  const outbound = new Set(result.edges.map((e) => e.from));
  return {
    screens: result.screens.length,
    edges: result.edges.length,
    linkEdges: result.edges.filter((e) => e.via === 'link').length,
    jsEdges: result.edges.filter((e) => e.via === 'js').length,
    components: result.components.length,
    orphans: result.screens.filter((s) => !inbound.has(s.id)).map((s) => s.id),
    deadEnds: result.screens.filter((s) => !outbound.has(s.id)).map((s) => s.id),
    issues: {
      total: result.issues.length,
      occurrences: result.occurrences.length,
      bySource: count(result.issues.map((i) => i.source)),
      bySeverity: count(result.issues.map((i) => i.severity)),
    },
  };
}
