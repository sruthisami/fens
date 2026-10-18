import type { CrawlResult, NavEdge, ScreenRecord } from '../types.js';
export function collapseTemplates(result: CrawlResult): CrawlResult {
  const groups = new Map<string, ScreenRecord[]>();
  for (const s of result.screens) {
    const segments = s.id.split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const key = `${segments[0]}|${s.fingerprint}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const rename = new Map<string, string>();
  const collapsed: ScreenRecord[] = [];
  const usedIds = new Set<string>();
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const segment = key.split('|')[0];
    let id = `/${segment}/*`;
    if (usedIds.has(id)) id = `${id}~${members[0]?.fingerprint.slice(0, 6)}`;
    usedIds.add(id);
    const sorted = [...members].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    const rep = sorted[0];
    if (!rep) continue;
    for (const m of sorted) rename.set(m.id, id);
    collapsed.push({
      ...rep,
      id,
      path: id,
      depth: Math.min(...sorted.map((m) => m.depth)),
      instances: sorted.length,
      instance_paths: sorted.map((m) => m.id),
    });
  }
  if (rename.size === 0) return result;
  const representatives = new Set(collapsed.map((c) => c.instance_paths[0]));
  const screens = [...result.screens.filter((s) => !rename.has(s.id)), ...collapsed];
  const edges = new Map<string, NavEdge>();
  for (const e of result.edges) {
    const from = rename.get(e.from) ?? e.from;
    const to = rename.get(e.to) ?? e.to;
    if (from === to) continue;
    edges.set(`${from}|${to}|${e.action}`, { ...e, from, to });
  }
  const components = result.components
    .filter((c) => !rename.has(c.screen) || representatives.has(c.screen))
    .map((c) => {
      const screen = rename.get(c.screen) ?? c.screen;
      return { ...c, screen, id: c.id.replace(c.screen, screen) };
    });
  const occurrences = new Map<string, CrawlResult['occurrences'][number]>();
  for (const o of result.occurrences) {
    const screen = rename.get(o.screen) ?? o.screen;
    const key = `${o.issue}|${screen}`;
    if (!occurrences.has(key)) occurrences.set(key, { ...o, screen });
  }
  return {
    ...result,
    screens,
    edges: [...edges.values()],
    components,
    occurrences: [...occurrences.values()],
  };
}
