import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  api,
  ApiError,
  type ComponentUsage,
  type GraphData,
  type IssueDetail,
  type IssueListItem,
  type Lens,
  type Problem,
  type ProblemSummary,
  type Summary,
  problemsApi,
} from './api';
import { API_URL } from './config';
import { GraphCanvas, type GraphCanvasHandle, type LayoutName } from './components/GraphCanvas';
import { InvestigatePanel } from './components/InvestigatePanel';
import { IdentitySwitcher } from './components/IdentitySwitcher';
import { HandoffsPanel } from './components/HandoffsPanel';
import { MemoryPanel } from './components/MemoryPanel';
import { ChatPanel } from './components/ChatPanel';
import { IssuesPanel } from './components/IssuesPanel';
import { Legend } from './components/Legend';
import { ScreenPanel } from './components/ScreenPanel';
import { SummaryStrip, type FixFilter, type NavKind } from './components/SummaryStrip';
import { ProblemsPanel } from './components/ProblemsPanel';
import { ArbitrationPanel } from './components/ArbitrationPanel';
import { ComparePanel } from './components/ComparePanel';
import { ToolsPanel } from './components/ToolsPanel';
import { TrackingPanel } from './components/TrackingPanel';
import { TabIcon } from './components/TabIcon';
type Load<T> =
  | {
      state: 'loading';
    }
  | {
      state: 'error';
      message: string;
    }
  | {
      state: 'ready';
      value: T;
    };
interface GraphBundle {
  data: GraphData;
  components: ComponentUsage[];
}
interface IssueView {
  summary: Summary;
  issues: IssueListItem[];
}
const TABS = [
  'issues',
  'tools',
  'investigate',
  'arbitration',
  'compare',
  'tracking',
  'handoffs',
  'memory',
  'ask',
] as const;
type LeftTab = (typeof TABS)[number];
const TAB_LABEL: Record<LeftTab, string> = {
  issues: 'Problems',
  tools: 'Tools',
  investigate: 'Investigate',
  arbitration: 'Arbitration',
  compare: 'Compare',
  tracking: 'Tracking',
  handoffs: 'Handoffs',
  memory: 'Memory',
  ask: 'Ask FlowLens',
};
const TAB_INFO: Record<LeftTab, string> = {
  issues:
    'Everything wrong with the site, once each: what found it, the suggested fix and its verdict, and how to check it yourself.',
  tools:
    'Questions about the site’s structure. Open a tool and run it; the answer is highlighted on the map.',
  investigate:
    'Run the UX and SEO agents. Their findings and proposed fixes also appear in Problems, grouped with the page checks.',
  arbitration:
    'Test the agents’ proposed fixes on a copy of the site. Each verdict also appears on its problem in Problems.',
  compare: 'Compare this release with an older one: what was fixed, what is new, what persists.',
  tracking:
    'Where each agent finding was sent (GitHub, Linear, Figma) and whether it is still open.',
  handoffs: 'Run all agents as a pipeline and watch them pass work to each other.',
  memory: 'What FlowLens remembers: your preferences, learned facts and past activity.',
  ask: 'Ask a question about this site in plain words.',
};
const TAB_GROUPS: [string, LeftTab[]][] = [
  ['Explore', ['issues', 'tools']],
  ['Agents', ['investigate', 'arbitration', 'compare']],
  ['Hand off', ['tracking', 'handoffs']],
  ['Team', ['memory', 'ask']],
];
const WELCOME_KEY = 'flowlens.welcome.dismissed';
const WIDE_KEY = 'flowlens.panel.wide';
function storedWide(): boolean {
  try {
    return localStorage.getItem(WIDE_KEY) === '1';
  } catch {
    return false;
  }
}
function welcomeDismissed(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}
function Welcome({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="welcome" aria-label="Getting started">
      <div className="welcome-head">
        <h2>Start here</h2>
        <button type="button" className="link-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <ol>
        <li>
          <strong>Explore the map.</strong> Each box is a screen of the site, each arrow a link or
          click. Select a screen (or use <em>Open screen</em>) for its links, issues and screenshot.
        </li>
        <li>
          <strong>Spot problems.</strong> Each problem below says what found it (a page check or an
          agent), its suggested fix and verdict, and how to check it yourself. Select one to see it
          on the map.
        </li>
        <li>
          <strong>Ask the agents.</strong> <em>Investigate</em> runs the UX or SEO agent,{' '}
          <em>Arbitration</em> weighs their proposals, <em>Compare</em> diffs two releases.
        </li>
      </ol>
    </section>
  );
}
const params = new URLSearchParams(window.location.search);
const initialGraph = params.get('graph') ?? '';
const linkedId = params.get('finding') ?? '';
const linkedFinding = /^[a-f0-9]{16}$/.test(linkedId) ? { id: linkedId } : null;
const linkedProblemId = params.get('problem') ?? '';
const linkedProblem = /^[a-f0-9]{16}$/.test(linkedProblemId) ? { id: linkedProblemId } : null;
const linkedDecisionId = params.get('decision') ?? '';
const linkedDecision = /^[a-f0-9]{16}$/.test(linkedDecisionId) ? { id: linkedDecisionId } : null;
function nameList(ids: string[]): string {
  const shown = ids.slice(0, 3).join(', ');
  return ids.length > 3 ? `${shown} +${ids.length - 3} more` : shown;
}
export function App({ onIdentityChange }: { onIdentityChange: () => void }) {
  const [graphs, setGraphs] = useState<Load<string[]>>({ state: 'loading' });
  const [graph, setGraph] = useState('');
  const [bundle, setBundle] = useState<Load<GraphBundle> | null>(null);
  const [layout, setLayout] = useState<LayoutName>('breadthfirst');
  const [showShared, setShowShared] = useState(false);
  const [crawlableOnly, setCrawlableOnly] = useState(false);
  const [groups, setGroups] = useState<Record<string, string> | null>(null);
  const [lens, setLens] = useState<Lens | null>(null);
  const [view, setView] = useState<Load<IssueView> | null>(null);
  const [problemView, setProblemView] = useState<Load<{
    problems: Problem[];
    summary: ProblemSummary;
  }> | null>(null);
  const [problemsReload, setProblemsReload] = useState(0);
  const [fixFilter, setFixFilter] = useState<FixFilter | null>(null);
  const [listMode, setListMode] = useState<'problems' | 'checks'>('problems');
  const [selected, setSelected] = useState<string | null>(null);
  const [highlightLabel, setHighlightLabel] = useState<string | null>(null);
  const [component, setComponent] = useState('');
  const [issueId, setIssueId] = useState<string | null>(null);
  const [issueDetail, setIssueDetail] = useState<IssueDetail | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>(
    linkedFinding ? 'investigate' : linkedDecision ? 'arbitration' : 'issues',
  );
  const [leftOpen, setLeftOpen] = useState(true);
  const [wide, setWide] = useState(storedWide);
  const toggleWide = (next: boolean) => {
    setWide(next);
    setLeftOpen(true);
    try {
      localStorage.setItem(WIDE_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable: keep it for this visit only */
    }
    // The map was hidden: fit it again once it is back.
    if (!next) requestAnimationFrame(() => canvas.current?.resetView());
  };
  const [welcome, setWelcome] = useState(() => !welcomeDismissed());
  const dismissWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* storage unavailable: hide for this visit only */
    }
  };
  const canvas = useRef<GraphCanvasHandle>(null);
  const loadGraphs = useCallback(() => {
    setGraphs({ state: 'loading' });
    api
      .graphs()
      .then((list) => {
        setGraphs({ state: 'ready', value: list });
        setGraph((current) => {
          const wanted =
            current || (new URLSearchParams(window.location.search).get('graph') ?? '');
          return list.includes(wanted) ? wanted : (list[0] ?? '');
        });
      })
      .catch((err: Error) => setGraphs({ state: 'error', message: err.message }));
  }, []);
  useEffect(loadGraphs, [loadGraphs]);
  useEffect(() => {
    if (!graph) return;
    const url = new URL(window.location.href);
    url.searchParams.set('graph', graph);
    window.history.replaceState(null, '', url);
    let cancelled = false;
    setBundle({ state: 'loading' });
    setSelected(null);
    setGroups(null);
    setHighlightLabel(null);
    setComponent('');
    setIssueId(null);
    setIssueDetail(null);
    Promise.all([api.graph(graph), api.components(graph)])
      .then(([data, components]) => {
        if (!cancelled) setBundle({ state: 'ready', value: { data, components } });
      })
      .catch((err: Error) => !cancelled && setBundle({ state: 'error', message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [graph]);
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    setView({ state: 'loading' });
    setIssueId(null);
    setIssueDetail(null);
    Promise.all([api.summary(graph, lens), api.issues(graph, lens)])
      .then(([summary, issues]) => {
        if (!cancelled) setView({ state: 'ready', value: { summary, issues } });
      })
      .catch((err: Error) => !cancelled && setView({ state: 'error', message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [graph, lens]);
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    problemsApi
      .list(graph)
      .then((value) => !cancelled && setProblemView({ state: 'ready', value }))
      .catch(
        (err: Error) => !cancelled && setProblemView({ state: 'error', message: err.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [graph, problemsReload]);
  useEffect(() => {
    setProblemView(null);
    setFixFilter(null);
    setListMode('problems');
  }, [graph]);
  useEffect(() => {
    // With the map hidden the panel stays open next to the screen panel.
    setLeftOpen(wide || !selected);
  }, [selected]);
  const ready = bundle?.state === 'ready' ? bundle.value : null;
  const issueView = view?.state === 'ready' ? view.value : null;
  const problemData = problemView?.state === 'ready' ? problemView.value : null;
  const problemCount = problemData
    ? problemData.problems.filter((p) => !lens || p.lenses.includes(lens)).length
    : null;
  const sharedCount = useMemo(() => ready?.data.edges.filter((e) => e.shared).length ?? 0, [ready]);
  const jsOnlyCount = useMemo(
    () => ready?.data.edges.filter((e) => !e.via.includes('link')).length ?? 0,
    [ready],
  );
  const totalConnections = ready?.data.edges.length ?? 0;
  const visibleConnections =
    ready?.data.edges.filter(
      (e) => (showShared || !e.shared) && (!crawlableOnly || e.via.includes('link')),
    ).length ?? 0;
  const unlinkedIds = useMemo(
    () => ready?.data.nodes.filter((n) => n.unreachable_by_links).map((n) => n.id) ?? [],
    [ready],
  );
  const orphanIds = useMemo(
    () => ready?.data.nodes.filter((n) => n.orphan).map((n) => n.id) ?? [],
    [ready],
  );
  const deadEndIds = useMemo(
    () => ready?.data.nodes.filter((n) => n.dead_end).map((n) => n.id) ?? [],
    [ready],
  );
  const show = (label: string, nodeIds: string[], edgeIds: string[] = [], keepIssue = false) => {
    if (!keepIssue) {
      setIssueId(null);
      setIssueDetail(null);
    }
    canvas.current?.highlight(nodeIds, edgeIds);
    setHighlightLabel(
      `${label}: ${nodeIds.length} screen${nodeIds.length === 1 ? '' : 's'} (${nameList(nodeIds)})`,
    );
  };
  const clear = () => {
    canvas.current?.clearHighlight();
    setHighlightLabel(null);
    setComponent('');
    setIssueId(null);
    setIssueDetail(null);
  };
  const highlightComponent = async (name: string) => {
    setComponent(name);
    if (!name) return clear();
    try {
      show(`Contains ${name}`, await api.componentScreens(graph, name));
    } catch (err) {
      setHighlightLabel(err instanceof ApiError ? err.message : 'Could not load component');
    }
  };
  const selectIssue = async (id: string | null) => {
    if (!id) return clear();
    setComponent('');
    setIssueId(id);
    setIssueDetail(null);
    setIssueError(null);
    try {
      const detail = await api.issue(graph, id);
      setIssueDetail(detail);
      show(
        `Issue "${detail.issue.help}"`,
        detail.screens.map((s) => s.id),
        [],
        true,
      );
    } catch (err) {
      setIssueError(err instanceof ApiError ? err.message : 'Could not load the issue');
    }
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!forward && !back) return;
    e.preventDefault();
    const step = forward ? 1 : -1;
    const next = TABS[(TABS.indexOf(leftTab) + step + TABS.length) % TABS.length] as LeftTab;
    openTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const openTab = (tab: LeftTab) => {
    // Agents and arbitration may have run in another tab: refresh the problems when coming back.
    if (tab === 'issues' && leftTab !== 'issues') setProblemsReload((n) => n + 1);
    setLeftTab(tab);
    setLeftOpen(true);
  };
  const [jumpDecision, setJumpDecision] = useState<{ id: string } | null>(null);
  const openDecision = (id: string) => {
    setJumpDecision({ id });
    openTab('arbitration');
  };
  const [jumpProblem, setJumpProblem] = useState<{ id: string } | null>(null);
  const openProblem = (id: string) => {
    const p = problemData?.problems.find((x) => x.id === id);
    if (lens && p && !p.lenses.includes(lens)) setLens(null);
    setFixFilter(null);
    setListMode('problems');
    setJumpProblem({ id });
    setSelected(null);
    openTab('issues');
  };
  const showCheck = (id: string) => {
    setListMode('checks');
    void selectIssue(id);
  };
  const filterFixes = (f: FixFilter) => {
    setFixFilter(f);
    setListMode('problems');
    openTab('issues');
  };
  const [jumpFinding, setJumpFinding] = useState<{ id: string } | null>(null);
  const openFinding = (id: string) => {
    setJumpFinding({ id });
    openTab('investigate');
  };
  const highlightNav = (kind: NavKind) => {
    if (kind === 'orphans') show('Orphans', orphanIds);
    else if (kind === 'deadEnds') show('Dead ends', deadEndIds);
    else show('Not reachable by links', unlinkedIds);
  };
  const workspaceClass = [
    'workspace',
    selected ? 'with-panel' : '',
    leftOpen ? '' : 'left-collapsed',
    leftOpen && wide ? 'left-wide' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>FlowLens</h1>
          {graphs.state === 'ready' && graphs.value.length > 0 && (
            <label className="field graph-picker">
              <span className="visually-hidden">Graph</span>
              <select value={graph} onChange={(e) => setGraph(e.target.value)}>
                {graphs.value.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <IdentitySwitcher onChange={onIdentityChange} />
      </header>

      {graphs.state === 'loading' && <p className="notice">Loading graphs…</p>}
      {graphs.state === 'error' && (
        <div className="notice error" role="alert">
          <p>
            {graphs.message} Start it with <code>cd fens-api &amp;&amp; npm run dev</code> and
            check that FalkorDB is running.
          </p>
          <button type="button" onClick={loadGraphs}>
            Retry
          </button>
        </div>
      )}
      {graphs.state === 'ready' && graphs.value.length === 0 && (
        <div className="notice">
          <p>
            No crawled graphs yet. Run the explorer, for example{' '}
            <code>npm run crawl -- --graph demo-shop-v1 --url http://localhost:5174 --reset</code>,
            then reload.
          </p>
          <button type="button" onClick={loadGraphs}>
            Reload
          </button>
        </div>
      )}

      {bundle?.state === 'loading' && <p className="notice">Loading {graph}…</p>}
      {bundle?.state === 'error' && (
        <p className="notice error" role="alert">
          Could not load {graph}: {bundle.message}
        </p>
      )}

      {ready && (
        <>
          {view?.state === 'error' && (
            <p className="notice error" role="alert">
              Could not load issues: {view.message}
            </p>
          )}
          {issueView ? (
            <SummaryStrip
              problems={problemData?.problems ?? null}
              summary={problemData?.summary ?? null}
              lens={lens}
              onLens={setLens}
              onFixFilter={filterFixes}
              nav={{
                orphans: orphanIds.length,
                deadEnds: deadEndIds.length,
                unlinked: unlinkedIds.length,
              }}
              onHighlight={highlightNav}
            />
          ) : (
            <p className="notice">Loading summary…</p>
          )}

          <main className={workspaceClass}>
            <nav className="rail" aria-label="Sections">
              <div
                className="rail-tabs"
                role="tablist"
                aria-label="Issues, tools and agents"
                aria-orientation="vertical"
              >
                {TAB_GROUPS.map(([group, tabs]) => (
                  <div key={group} className="rail-group" role="presentation">
                    <span className="rail-label" aria-hidden="true">
                      {group}
                    </span>
                    {tabs.map((tab) => (
                      <button
                        key={tab}
                        id={`tab-${tab}`}
                        type="button"
                        role="tab"
                        aria-selected={leftTab === tab}
                        aria-controls={`tabpanel-${tab}`}
                        aria-expanded={leftTab === tab ? leftOpen : undefined}
                        tabIndex={leftTab === tab ? 0 : -1}
                        onClick={() =>
                          leftTab === tab && leftOpen ? setLeftOpen(false) : openTab(tab)
                        }
                        onKeyDown={onTabKey}
                      >
                        <TabIcon name={tab} />
                        <span className="tab-name">{TAB_LABEL[tab]}</span>
                        {tab === 'issues' && (
                          <span className="tab-count">{problemCount ?? '…'}</span>
                        )}
                        <span className="tab-chevron" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <p className="rail-foot">API {API_URL.replace(/^https?:\/\//, '')}</p>
            </nav>

            <div className="left" hidden={!leftOpen}>
              <div className="left-head">
                <div className="left-title">
                  <h2>
                    {TAB_LABEL[leftTab]}
                    {leftTab === 'issues' && lens ? ` · ${lens}` : ''}
                  </h2>
                  <p className="left-desc">{TAB_INFO[leftTab]}</p>
                </div>
                <div className="left-actions">
                  <button
                    type="button"
                    className="wide-toggle"
                    aria-pressed={wide}
                    onClick={() => toggleWide(!wide)}
                    title={
                      wide ? 'Show the map again' : 'Hide the map and give this panel the space'
                    }
                  >
                    <span aria-hidden="true">{wide ? '⤡' : '⤢'}</span>{' '}
                    {wide ? 'Show map' : 'Expand'}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setLeftOpen(false)}
                    aria-label={`Hide ${TAB_LABEL[leftTab]} panel`}
                    title="Hide panel"
                  >
                    ‹
                  </button>
                </div>
              </div>
              <div
                id="tabpanel-issues"
                role="tabpanel"
                aria-labelledby="tab-issues"
                hidden={leftTab !== 'issues'}
              >
                {welcome && <Welcome onDismiss={dismissWelcome} />}
                <fieldset className="segmented list-mode">
                  <legend className="visually-hidden">Show</legend>
                  <label>
                    <input
                      type="radio"
                      name="list-mode"
                      checked={listMode === 'problems'}
                      onChange={() => setListMode('problems')}
                    />
                    <span>Problems{problemCount !== null ? ` (${problemCount})` : ''}</span>
                  </label>
                  <label title="The raw results of the page checks (axe-core, FlowLens rules, Lighthouse) that problems are built from">
                    <input
                      type="radio"
                      name="list-mode"
                      checked={listMode === 'checks'}
                      onChange={() => setListMode('checks')}
                    />
                    <span>
                      Page check results{issueView ? ` (${issueView.issues.length})` : ''}
                    </span>
                  </label>
                </fieldset>
                {listMode === 'problems' ? (
                  <ProblemsPanel
                    graph={graph}
                    problems={problemData?.problems ?? null}
                    error={problemView?.state === 'error' ? problemView.message : null}
                    issues={issueView?.issues ?? []}
                    lens={lens}
                    fixFilter={fixFilter}
                    onClearFixFilter={() => setFixFilter(null)}
                    reloadKey={problemsReload}
                    focusProblem={jumpProblem ?? (graph === initialGraph ? linkedProblem : null)}
                    onHighlight={(label, nodeIds, edgeIds) => show(label, nodeIds, edgeIds)}
                    onOpenScreen={setSelected}
                    onShowCheck={showCheck}
                    onOpenFinding={openFinding}
                    onOpenDecision={openDecision}
                    onRunAgents={() => openTab('investigate')}
                    wide={wide}
                    onShowMap={() => toggleWide(false)}
                    onChanged={() => setProblemsReload((n) => n + 1)}
                  />
                ) : (
                  <>
                    <p className="muted list-mode-note">
                      Raw results of the page checks run during the crawl. Each one is also shown
                      inside the problem it belongs to.
                    </p>
                    <IssuesPanel
                      issues={issueView?.issues ?? []}
                      loading={!issueView}
                      selectedId={issueId}
                      detail={issueDetail}
                      detailError={issueError}
                      onSelect={(id) => void selectIssue(id)}
                      onOpenScreen={setSelected}
                    />
                  </>
                )}
              </div>
              <div
                id="tabpanel-tools"
                role="tabpanel"
                aria-labelledby="tab-tools"
                hidden={leftTab !== 'tools'}
              >
                <ToolsPanel
                  graph={graph}
                  nodes={ready.data.nodes}
                  onCommunities={setGroups}
                  onHighlight={(label, nodeIds, edgeIds) => show(label, nodeIds, edgeIds)}
                />
              </div>
              <div
                id="tabpanel-investigate"
                role="tabpanel"
                aria-labelledby="tab-investigate"
                hidden={leftTab !== 'investigate'}
              >
                <InvestigatePanel
                  graph={graph}
                  focusFinding={jumpFinding ?? (graph === initialGraph ? linkedFinding : null)}
                  graphs={graphs.state === 'ready' ? graphs.value : []}
                  onHighlight={(label, nodeIds, edgeIds) => show(label, nodeIds, edgeIds)}
                />
              </div>
              <div
                id="tabpanel-arbitration"
                role="tabpanel"
                aria-labelledby="tab-arbitration"
                hidden={leftTab !== 'arbitration'}
              >
                <ArbitrationPanel
                  graph={graph}
                  focusDecision={jumpDecision ?? (graph === initialGraph ? linkedDecision : null)}
                  onHighlight={(label, nodeIds, edgeIds) => show(label, nodeIds, edgeIds)}
                />
              </div>
              <div
                id="tabpanel-compare"
                role="tabpanel"
                aria-labelledby="tab-compare"
                hidden={leftTab !== 'compare'}
              >
                <ComparePanel
                  graph={graph}
                  graphs={graphs.state === 'ready' ? graphs.value : []}
                  onHighlight={(label, nodeIds, edgeIds) => show(label, nodeIds, edgeIds)}
                />
              </div>
              <div
                id="tabpanel-tracking"
                role="tabpanel"
                aria-labelledby="tab-tracking"
                hidden={leftTab !== 'tracking'}
              >
                <TrackingPanel
                  graph={graph}
                  active={leftTab === 'tracking'}
                  onOpenFinding={openFinding}
                />
              </div>
              <div
                id="tabpanel-handoffs"
                role="tabpanel"
                aria-labelledby="tab-handoffs"
                hidden={leftTab !== 'handoffs'}
              >
                <HandoffsPanel
                  graph={graph}
                  graphs={graphs.state === 'ready' ? graphs.value : []}
                  active={leftTab === 'handoffs'}
                />
              </div>
              <div
                id="tabpanel-memory"
                role="tabpanel"
                aria-labelledby="tab-memory"
                hidden={leftTab !== 'memory'}
              >
                <MemoryPanel active={leftTab === 'memory'} />
              </div>
              <div
                id="tabpanel-ask"
                role="tabpanel"
                aria-labelledby="tab-ask"
                hidden={leftTab !== 'ask'}
              >
                <ChatPanel graph={graph} />
              </div>
            </div>

            <div className="stage">
              <div className="canvas-toolbar" role="toolbar" aria-label="Graph controls">
                <fieldset className="segmented">
                  <legend className="visually-hidden">Layout</legend>
                  {(['breadthfirst', 'cose'] as const).map((name) => (
                    <label key={name}>
                      <input
                        type="radio"
                        name="layout"
                        value={name}
                        checked={layout === name}
                        onChange={() => setLayout(name)}
                      />
                      <span>{name === 'breadthfirst' ? 'Tree from /' : 'Force (cose)'}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="field compact">
                  <span className="field-label">Links</span>
                  <select
                    value={crawlableOnly ? 'crawlable' : 'all'}
                    onChange={(e) => setCrawlableOnly(e.target.value === 'crawlable')}
                    aria-label="Graph view"
                  >
                    <option value="all">All links</option>
                    <option value="crawlable">Crawlable links only</option>
                  </select>
                </label>
                <label className="checkbox compact">
                  <input
                    type="checkbox"
                    checked={showShared}
                    onChange={(e) => setShowShared(e.target.checked)}
                  />
                  Header/footer links ({sharedCount})
                </label>
                <label className="field compact">
                  <span className="field-label">Component</span>
                  <select
                    value={component}
                    onChange={(e) => void highlightComponent(e.target.value)}
                  >
                    <option value="">None</option>
                    {ready.components.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.screens} screens)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field compact">
                  <span className="field-label">Open screen</span>
                  <select
                    id="open-screen"
                    value={selected ?? ''}
                    onChange={(e) => setSelected(e.target.value || null)}
                  >
                    <option value="">Choose…</option>
                    {ready.data.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="toolbar-end"
                  onClick={() => canvas.current?.resetView()}
                >
                  Reset view
                </button>
              </div>

              <GraphCanvas
                ref={canvas}
                data={ready.data}
                layout={layout}
                showShared={showShared}
                crawlableOnly={crawlableOnly}
                groups={groups}
                selectedId={selected}
                onSelect={setSelected}
              />

              <div className="stage-foot">
                <p className={`stage-status${highlightLabel ? ' active' : ''}`} aria-live="polite">
                  {highlightLabel ? (
                    <>
                      <strong>Highlighted</strong> {highlightLabel}.
                    </>
                  ) : (
                    <>
                      Showing {ready.data.nodes.length} screens and {visibleConnections} of{' '}
                      {totalConnections} connections
                      {!showShared && sharedCount > 0 ? ` (${sharedCount} shared hidden)` : ''}
                      {crawlableOnly && jsOnlyCount > 0
                        ? ` (${jsOnlyCount} JavaScript-only clicks hidden; ${unlinkedIds.length} screen${unlinkedIds.length === 1 ? '' : 's'} not reachable by links: ${nameList(unlinkedIds)})`
                        : ''}
                      .
                    </>
                  )}
                  {highlightLabel && (
                    <button type="button" className="link-button" onClick={clear}>
                      Clear
                    </button>
                  )}
                </p>
                <Legend />
              </div>
            </div>

            {selected && (
              <ScreenPanel
                graph={graph}
                screenId={selected}
                onClose={() => setSelected(null)}
                onOpenScreen={setSelected}
                problems={problemData?.problems ?? []}
                onOpenProblem={openProblem}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
