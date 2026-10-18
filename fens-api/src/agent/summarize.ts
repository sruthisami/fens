type R = Record<string, unknown>;
const list = (ids: unknown[], n = 3) => {
  const s = ids.slice(0, n).map(String).join(', ');
  return ids.length > n ? `${s} +${ids.length - n} more` : s;
};
export function summarize(tool: string, out: unknown): string {
  const o = out as R;
  const r = (o?.result ?? {}) as R;
  switch (tool) {
    case 'shortest_path':
      return r.found ? `${String(r.length)} steps` : 'no path';
    case 'find_orphans':
    case 'find_dead_ends': {
      const s = (r.screens as R[]) ?? [];
      return s.length ? `${s.length}: ${list(s.map((x) => x.id))}` : 'none';
    }
    case 'betweenness':
    case 'pagerank': {
      const rk = (r.ranking as R[]) ?? [];
      return `top: ${list(rk.map((x) => `${String(x.id)}=${String(x.score)}`))}`;
    }
    case 'communities':
      return `${String(r.count)} groups`;
    case 'component_fanout':
      return `${String(r.screen_count)} screens, ${((r.issues as R[]) ?? []).length} issue(s)`;
    case 'issues_by_component': {
      const rk = (r.ranking as R[]) ?? [];
      return rk.length
        ? list(
            rk.map(
              (x) => `${String(x.component)} (${String(x.issues)}/${String(x.screens)} screens)`,
            ),
          )
        : 'none';
    }
    case 'compare_task': {
      const t = (r.tasks as R[]) ?? [];
      return t.length
        ? list(
            t.map(
              (x) =>
                `${String(x.id)}: forced ${String(x.forced_clicks)}, shortest ${String((x.shortest as R)?.length)}`,
            ),
          )
        : 'no tasks recorded';
    }
    case 'get_graph_schema': {
      const labels = (o?.nodeLabels as unknown[]) ?? [];
      return labels.length ? `labels: ${list(labels, 6)}` : 'schema';
    }
    default: {
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    }
  }
}
