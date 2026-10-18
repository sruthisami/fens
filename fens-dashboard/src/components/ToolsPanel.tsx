import { useEffect, useState, type FormEvent } from 'react';
import { Section } from './Section';
import {
  api,
  type CrawlDepthResult,
  type GraphNode,
  type IssuesByComponentResult,
  type JsOnlyResult,
  type LensSummaryResult,
  type MobileOverflowResult,
  type RankingResult,
  type ShortestPathResult,
  type SitemapGapsResult,
  type StableCommunities,
  type ToolResult,
  type UnreachableResult,
} from '../api';
interface Props {
  graph: string;
  nodes: GraphNode[];
  onHighlight: (label: string, nodeIds: string[], edgeIds?: string[]) => void;
  onCommunities?: (groups: Record<string, string> | null) => void;
}
type Ranking = {
  name: 'betweenness' | 'pagerank';
  data: ToolResult<RankingResult>;
};
interface TaskComparison {
  tasks: {
    id: string;
    name: string;
    start: string;
    forced_clicks: number;
    forced_path: {
      order: number;
      action: string;
      from: string;
      to: string;
      moved: boolean;
    }[];
    shortest: ShortestPathResult;
    detour: number | null;
  }[];
}
const TOP = 5;
type EdgeSet = 'all' | 'flow' | 'href';
type SeoResult =
  | {
      tool: 'crawl_depth';
      data: CrawlDepthResult;
    }
  | {
      tool: 'unreachable_by_links';
      data: UnreachableResult;
    }
  | {
      tool: 'js_only_content';
      data: JsOnlyResult;
    }
  | {
      tool: 'mobile_overflow_screens';
      data: MobileOverflowResult;
    }
  | {
      tool: 'sitemap_gaps';
      data: SitemapGapsResult;
    }
  | {
      tool: 'lens_summary';
      data: LensSummaryResult;
    };
const SEO_TOOLS: {
  tool: SeoResult['tool'];
  label: string;
  highlight: string;
}[] = [
  { tool: 'crawl_depth', label: 'Link depth', highlight: 'Deepest screens by links' },
  {
    tool: 'unreachable_by_links',
    label: 'Not reachable by links',
    highlight: 'Not reachable by links',
  },
  {
    tool: 'js_only_content',
    label: 'JavaScript-only content',
    highlight: 'JavaScript-only content',
  },
  { tool: 'mobile_overflow_screens', label: 'Mobile overflow', highlight: 'Wider than 375px' },
  { tool: 'sitemap_gaps', label: 'Sitemap gaps', highlight: 'Sitemap gaps' },
  { tool: 'lens_summary', label: 'Issues by lens', highlight: 'Issues by lens' },
];
export function ToolsPanel({ graph, nodes, onHighlight, onCommunities }: Props) {
  const ids = nodes.map((n) => n.id);
  const [from, setFrom] = useState(ids.includes('/') ? '/' : (ids[0] ?? ''));
  const [to, setTo] = useState(
    ids.includes('/checkout/confirmation') ? '/checkout/confirmation' : (ids[ids.length - 1] ?? ''),
  );
  const [edgeSet, setEdgeSet] = useState<EdgeSet>('all');
  const [seo, setSeo] = useState<SeoResult | null>(null);
  const [communities, setCommunities] = useState<StableCommunities | null>(null);
  const [path, setPath] = useState<ToolResult<ShortestPathResult> | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [byComponent, setByComponent] = useState<IssuesByComponentResult | null>(null);
  const [tasks, setTasks] = useState<TaskComparison | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .tool<IssuesByComponentResult>(graph, 'issues_by_component')
      .then((r) => !cancelled && setByComponent(r.result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [graph]);
  const run = async <T,>(name: string, task: () => Promise<T>): Promise<T | null> => {
    setBusy(name);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool failed');
      return null;
    } finally {
      setBusy(null);
    }
  };
  const runPath = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run('path', () =>
      api.tool<ShortestPathResult>(graph, 'shortest_path', { from, to, edge_set: edgeSet }),
    );
    if (!r) return;
    setPath(r);
    if (r.result.found) onHighlight(`Shortest path ${from} to ${to}`, r.screens, r.edges);
  };
  const runRanking = async (name: Ranking['name']) => {
    const r = await run(name, () =>
      api.tool<RankingResult>(graph, name, { edge_set: 'flow', top: String(TOP) }),
    );
    if (!r) return;
    setRanking({ name, data: r });
    onHighlight(`Top ${TOP} by ${name === 'pagerank' ? 'PageRank' : 'betweenness'}`, r.screens);
  };
  const runSeo = async (entry: (typeof SEO_TOOLS)[number]) => {
    const r = await run(entry.tool, () => api.tool<unknown>(graph, entry.tool));
    if (!r) return;
    setSeo({ tool: entry.tool, data: r.result } as SeoResult);
    if (r.screens.length) onHighlight(entry.highlight, r.screens, r.edges);
  };
  const runCommunities = async () => {
    const r = await run('communities', () =>
      api.tool<StableCommunities>(graph, 'stable_communities'),
    );
    if (!r) return;
    setCommunities(r.result);
    onCommunities?.(
      Object.fromEntries(r.result.groups.flatMap((gr) => gr.screens.map((s) => [s, gr.label]))),
    );
  };
  const hideCommunities = () => {
    setCommunities(null);
    onCommunities?.(null);
  };
  const runTasks = async () => {
    const r = await run('tasks', () => api.tool<TaskComparison>(graph, 'compare_task'));
    if (r) setTasks(r.result);
  };
  const showForced = (t: TaskComparison['tasks'][number]) => {
    const screens = [t.start, ...t.forced_path.map((s) => s.to)];
    const edges = t.forced_path.filter((s) => s.moved).map((s) => `${s.from} -> ${s.to}`);
    onHighlight(`Forced journey "${t.name}"`, [...new Set(screens)], edges);
  };
  const showShortest = (t: TaskComparison['tasks'][number]) => {
    const steps = t.shortest.steps;
    onHighlight(
      `Shortest path for "${t.name}"`,
      [t.start, ...steps.map((s) => s.to)],
      steps.map((s) => `${s.from} -> ${s.to}`),
    );
  };
  return (
    <div className="tools">
      {error && <p role="alert">{error}</p>}

      <Section title="Shortest path" hint="Fewest clicks between two screens.">
        <form onSubmit={(e) => void runPath(e)}>
          <div className="stack">
            <label htmlFor="tool-from">From</label>
            <select id="tool-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          <div className="stack">
            <label htmlFor="tool-to">To</label>
            <select id="tool-to" value={to} onChange={(e) => setTo(e.target.value)}>
              {ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
          <div className="stack">
            <label htmlFor="tool-edges">Links to use</label>
            <select
              id="tool-edges"
              value={edgeSet}
              onChange={(e) => setEdgeSet(e.target.value as EdgeSet)}
            >
              <option value="all">All links</option>
              <option value="flow">Without header/footer links</option>
              <option value="href">Plain links only (crawlable)</option>
            </select>
          </div>
          <button type="submit" disabled={busy === 'path'}>
            {busy === 'path' ? 'Running…' : 'Run'}
          </button>
          {path && (
            <div className="tool-result" aria-live="polite">
              {path.result.found ? (
                <>
                  <p>
                    <strong>
                      {path.result.length} click{path.result.length === 1 ? '' : 's'}
                    </strong>{' '}
                    from {path.screens[0]} to {path.screens[path.screens.length - 1]}
                  </p>
                  <ol className="steps">
                    {path.result.steps.map((s, i) => (
                      <li key={`${s.from}-${i}`}>
                        “{s.action}”{' '}
                        <span className="muted">({s.via === 'js' ? 'click' : 'link'})</span> →{' '}
                        {s.to}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p>No path found.</p>
              )}
            </div>
          )}
        </form>
      </Section>

      <Section
        title="Task journeys"
        hint="Clicks a recorded journey needs, compared with the shortest path."
      >
        <button type="button" onClick={() => void runTasks()} disabled={busy !== null}>
          {busy === 'tasks' ? 'Running…' : 'Compare tasks'}
        </button>
        {tasks && (
          <div className="tool-result" aria-live="polite">
            {tasks.tasks.length === 0 ? (
              <p className="muted">No tasks recorded. Crawl with --tasks.</p>
            ) : (
              tasks.tasks.map((t) => (
                <div key={t.id}>
                  <p>
                    <strong>{t.name}</strong>: forced {t.forced_clicks} clicks, shortest{' '}
                    {t.shortest.length ?? '—'}
                    {t.detour !== null ? `, detour ${t.detour}` : ''}
                  </p>
                  <div className="button-row">
                    <button type="button" onClick={() => showForced(t)}>
                      Show forced journey
                    </button>
                    <button type="button" onClick={() => showShortest(t)}>
                      Show shortest path
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Section>

      <Section
        title="Key screens"
        hint="Screens most paths pass through, or where links point most."
      >
        <p className="muted">Ignores header and footer links.</p>
        <div className="button-row">
          <button
            type="button"
            onClick={() => void runRanking('betweenness')}
            disabled={busy !== null}
          >
            Betweenness (top {TOP})
          </button>
          <button
            type="button"
            onClick={() => void runRanking('pagerank')}
            disabled={busy !== null}
          >
            PageRank (top {TOP})
          </button>
        </div>
        {ranking && (
          <div className="tool-result" aria-live="polite">
            <p className="muted">
              {ranking.name === 'pagerank'
                ? 'Where link weight collects.'
                : 'Screens that many shortest click paths pass through.'}
            </p>
            <ol className="steps">
              {ranking.data.result.ranking.map((r) => (
                <li key={r.id}>
                  {r.id} <span className="muted">{r.score}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      <Section title="Communities" hint="Groups of screens that link mostly to each other.">
        <div className="button-row">
          <button type="button" onClick={() => void runCommunities()} disabled={busy !== null}>
            {busy === 'communities' ? 'Running…' : 'Show communities'}
          </button>
          <button type="button" onClick={hideCommunities} disabled={!communities}>
            Hide communities
          </button>
        </div>
        {communities && (
          <div className="tool-result" aria-live="polite">
            <p className="muted">
              Label propagation is unstable on small graphs, so it ran {communities.runs} times.
              Screens that landed together in at least {Math.round(communities.threshold * 100)}% of
              the runs share a group. Each screen on the graph shows its group as text (“Group A”),
              and the colour only repeats it.
            </p>
            <ul className="legend-groups">
              {communities.groups.map((gr) => (
                <li key={gr.label}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onHighlight(`Group ${gr.label}`, gr.screens)}
                  >
                    Group {gr.label}
                  </button>{' '}
                  ({gr.size}): {gr.screens.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title="SEO and AEO checks"
        hint="What search crawlers and answer engines see: links only, raw HTML, mobile."
      >
        <div className="button-row">
          {SEO_TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              onClick={() => void runSeo(t)}
              disabled={busy !== null}
            >
              {busy === t.tool ? 'Running…' : t.label}
            </button>
          ))}
        </div>
        {seo && (
          <div className="tool-result" aria-live="polite">
            <SeoResultView result={seo} />
          </div>
        )}
      </Section>

      <Section
        title="Fix once, fix everywhere"
        hint="Shared components ranked by how many issues and screens they affect."
      >
        {!byComponent ? (
          <p className="muted">Loading…</p>
        ) : byComponent.ranking.length === 0 ? (
          <p className="muted">No issues are linked to a component.</p>
        ) : (
          <ul className="issue-list">
            {byComponent.ranking.map((row) => (
              <li key={row.component}>
                <button
                  type="button"
                  className="issue-item"
                  onClick={() => onHighlight(`Component ${row.component}`, row.screen_ids)}
                >
                  <span className="issue-help">{row.component}</span>
                  <span className="issue-meta">
                    {row.issues} issue{row.issues === 1 ? '' : 's'} on {row.screens} screen
                    {row.screens === 1 ? '' : 's'} · {row.rules.join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
function SeoResultView({ result }: { result: SeoResult }) {
  switch (result.tool) {
    case 'crawl_depth': {
      const d = result.data;
      return (
        <>
          <p>
            <strong>Deepest by links: {d.max_link_depth ?? '—'}</strong> from {d.start};{' '}
            {d.unreachable_by_links} screen{d.unreachable_by_links === 1 ? '' : 's'} not reachable
            by links.
          </p>
          <ul className="steps">
            {d.distribution.map((row) => (
              <li key={row.depth}>
                Depth {row.depth}: {row.count} screen{row.count === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </>
      );
    }
    case 'unreachable_by_links': {
      const d = result.data;
      return (
        <>
          <p>
            <strong>{d.count}</strong> screen{d.count === 1 ? '' : 's'} only reachable through
            buttons or scripts:
          </p>
          <ul className="steps">
            {d.screens.map((s) => (
              <li key={s.id}>
                {s.id}{' '}
                <span className="muted">
                  via {s.reached_by.map((r) => `“${r.action}” on ${r.from}`).join(', ') || '—'}
                </span>
              </li>
            ))}
          </ul>
          {d.not_reachable_at_all.length > 0 && (
            <p className="muted">
              Not reachable from {d.start} at all:{' '}
              {d.not_reachable_at_all.map((s) => s.id).join(', ')}
            </p>
          )}
        </>
      );
    }
    case 'js_only_content':
      return (
        <>
          <p>
            <strong>{result.data.count}</strong> screen{result.data.count === 1 ? '' : 's'} with at
            least {pct(result.data.min_ratio)} of their text only after JavaScript:
          </p>
          <ul className="steps">
            {result.data.screens.map((s) => (
              <li key={s.id}>
                {s.id} <span className="muted">{pct(s.js_only_ratio)}</span>
                {s.raw_status && s.raw_status !== 200 ? (
                  <span className="muted"> (raw request {s.raw_status})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      );
    case 'mobile_overflow_screens':
      return result.data.count === 0 ? (
        <p>No screen scrolls sideways at 375px.</p>
      ) : (
        <ul className="steps">
          {result.data.screens.map((s) => (
            <li key={s.id}>
              {s.id}{' '}
              <span className="muted">
                {s.component ?? s.selector ?? ''}
                {s.width ? `, ${s.width}` : ''}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'sitemap_gaps':
      return result.data.gaps.length === 0 && result.data.not_in_sitemap.length === 0 ? (
        <p>The sitemap and the crawl agree.</p>
      ) : (
        <>
          {result.data.gaps.map((gap) => (
            <div key={gap.kind}>
              <p>
                <strong>{gap.help}</strong>
              </p>
              <ul className="steps">
                {gap.screens.flatMap((s) =>
                  s.urls.map((u) => (
                    <li key={`${s.screen}-${u}`}>
                      {u} <span className="muted">(screen {s.screen})</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          ))}
        </>
      );
    case 'lens_summary':
      return (
        <>
          <ul className="steps">
            {result.data.lenses.map((l) => (
              <li key={l.lens}>
                <strong>{l.lens}</strong>: {l.total} issue{l.total === 1 ? '' : 's'} on {l.screens}{' '}
                screen{l.screens === 1 ? '' : 's'}{' '}
                <span className="muted">
                  ({l.bySeverity.serious + l.bySeverity.critical} serious or critical,{' '}
                  {l.bySeverity.moderate} moderate, {l.bySeverity.minor} minor)
                </span>
              </li>
            ))}
          </ul>
          <h4>Guideline conflicts</h4>
          <ul className="steps">
            {result.data.conflicts.map((c) => (
              <li key={`${c.from.id}-${c.to.id}`}>
                {c.from.lens} “{c.from.name}” ({c.from_issues}) versus {c.to.lens} “{c.to.name}” (
                {c.to_issues}). <span className="muted">{c.reason}</span>
              </li>
            ))}
          </ul>
        </>
      );
  }
}
