import { useEffect, useRef, useState } from 'react';
import { ChannelChips } from './ChannelBadges';
import { ChannelsPanel } from './ChannelsPanel';
import { Section } from './Section';
import { DebatePanel, isContested } from './DebatePanel';
import { SuggestedAssignee } from './SuggestedAssignee';
import {
  type AgentChoice,
  type AgentName,
  type Comparison,
  findingsApi,
  investigate,
  proposalsApi,
  decisionsApi,
  type Decision,
  type AgentEvent,
  type Finding,
  type InvestigateMode,
  type Proposal,
} from '../api';
interface Props {
  graph: string;
  graphs: string[];
  focusFinding?: { id: string } | null;
  onHighlight: (label: string, nodeIds: string[], edgeIds?: string[]) => void;
}
const MODES: {
  value: InvestigateMode;
  label: string;
}[] = [
  { value: 'rules', label: 'Rules only (no AI)' },
  { value: 'llm', label: 'AI agent (Gemini)' },
  { value: 'replay', label: 'Replay last run' },
];
const AGENTS: {
  value: AgentChoice;
  label: string;
}[] = [
  { value: 'ux', label: 'UX agent' },
  { value: 'seo', label: 'SEO agent' },
  { value: 'both', label: 'Both agents' },
];
const AGENT_LABEL: Record<AgentName, string> = { ux: 'UX agent', seo: 'SEO agent' };
const CHANGE_LABEL: Record<Proposal['change']['type'], string> = {
  table_to_cards: 'Table to cards',
  table_responsive: 'Responsive table',
  content_in_html: 'Content in the HTML',
  remove_links: 'Remove links',
  add_link: 'Add a link',
};
const EFFECT_TEXT = { improves: 'improves', neutral: 'no change', worsens: 'worsens' } as const;
function proposalTarget(p: Proposal): string {
  const { screen, from, to, component } = p.change.params as Record<string, unknown>;
  if (p.change.type === 'add_link') return `${String(from)} → ${String(to)}`;
  if (p.change.type === 'remove_links')
    return `${String(from)} → ${(Array.isArray(to) ? to : []).join(', ')}`;
  return `${String(screen)}${component ? ` (${String(component)})` : ''}`;
}
const sev = (s: string) => s[0]?.toUpperCase() + s.slice(1);
const SEV_CLASS: Record<string, string> = { high: 'serious', medium: 'moderate', low: 'minor' };
const shortArgs = (args: Record<string, unknown>) =>
  Object.entries(args)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
function evidenceTargets(f: Finding) {
  const screens = new Set<string>();
  const edges = new Set<string>();
  for (const e of f.evidence) {
    const path = e.path ?? [];
    [...e.screens, ...path].forEach((s) => screens.add(s));
    if (path.length > 1) {
      for (let i = 0; i + 1 < path.length; i++) edges.add(`${path[i]} -> ${path[i + 1]}`);
    }
  }
  return { screens: [...screens], edges: [...edges] };
}
export function InvestigatePanel(props: Props) {
  const { graph, onHighlight } = props;
  const [mode, setMode] = useState<InvestigateMode>('rules');
  const [agent, setAgent] = useState<AgentChoice>('both');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState('');
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<AgentEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [showSuppressed, setShowSuppressed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const decisionOf = new Map(decisions.map((d) => [d.proposal_id, d]));
  const refresh = () =>
    Promise.all([findingsApi.list(graph), proposalsApi.list(graph), decisionsApi.list(graph)])
      .then(([f, p, d]) => {
        setFindings(f);
        setProposals(p);
        setDecisions(d.decisions);
      })
      .catch((err: Error) => setError(err.message));
  useEffect(() => {
    setTrace([]);
    setSelected(null);
    void refresh();
    return () => abort.current?.abort();
  }, [graph]);
  const run = async () => {
    setRunning(true);
    setError(null);
    setTrace([]);
    setSelected(null);
    abort.current = new AbortController();
    try {
      for await (const e of investigate(
        graph,
        mode,
        abort.current.signal,
        compareWith || undefined,
        agent,
      )) {
        setTrace((t) => [...t, e]);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Investigation failed');
    } finally {
      setRunning(false);
    }
  };
  const select = (f: Finding) => {
    const open = selected === f.id ? null : f.id;
    setSelected(open);
    if (open) {
      const t = evidenceTargets(f);
      onHighlight(`Finding "${f.title}"`, t.screens, t.edges);
    }
  };
  const selectProposal = (p: Proposal) => {
    const open = openProposal === p.id ? null : p.id;
    setOpenProposal(open);
    if (open) onHighlight(`Proposal "${p.title}"`, p.targets.screens);
  };
  const focused = useRef<{ id: string } | null>(null);
  useEffect(() => {
    const target = props.focusFinding;
    if (!target || focused.current === target) return;
    const f = findings.find((x) => x.id === target.id);
    if (!f) return;
    focused.current = target;
    if (f.suppressed_by) setShowSuppressed(true);
    setSelected(f.id);
    const t = evidenceTargets(f);
    onHighlight(`Finding "${f.title}"`, t.screens, t.edges);
    requestAnimationFrame(() =>
      document.getElementById(`finding-${f.id}`)?.scrollIntoView({ block: 'center' }),
    );
  }, [findings, props.focusFinding]);
  const done = trace.find(
    (
      e,
    ): e is Extract<
      AgentEvent,
      {
        type: 'done';
      }
    > => e.type === 'done',
  );
  const results = new Map(
    trace
      .filter(
        (
          e,
        ): e is Extract<
          AgentEvent,
          {
            type: 'tool_result';
          }
        > => e.type === 'tool_result',
      )
      .map((e) => [e.n, e]),
  );
  return (
    <div className="tools">
      <Section
        title="Run the agents"
        hint="The UX and SEO agents read the graph and explain what they find."
        defaultOpen
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="stack">
            <label htmlFor="investigate-mode">Mode</label>
            <select
              id="investigate-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as InvestigateMode)}
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="group">
            <legend>Agent</legend>
            {AGENTS.map((a) => (
              <label key={a.value} className="radio">
                <input
                  type="radio"
                  name="investigate-agent"
                  value={a.value}
                  checked={agent === a.value}
                  onChange={() => setAgent(a.value)}
                />
                {a.label}
              </label>
            ))}
          </fieldset>
          {props.graphs.filter((g) => g !== graph).length > 0 && (
            <div className="stack">
              <label htmlFor="investigate-compare">Compare with an older release (optional)</label>
              <select
                id="investigate-compare"
                value={compareWith}
                onChange={(e) => setCompareWith(e.target.value)}
              >
                <option value="">Nothing</option>
                {props.graphs
                  .filter((g) => g !== graph)
                  .map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <button type="submit" disabled={running}>
            {running ? 'Running…' : 'Run'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      </Section>

      {trace.length > 0 && (
        <Section title="Trace" hint="Each tool the agents called, as it happened." defaultOpen>
          <ol className="trace" aria-live="polite">
            {trace.map((e, i) => {
              if (e.type === 'tool_call') {
                const r = results.get(e.n);
                return (
                  <li key={i}>
                    <code>{e.tool}</code>
                    {Object.keys(e.args).length ? (
                      <span className="muted"> ({shortArgs(e.args)})</span>
                    ) : null}
                    {r ? (
                      <div className={r.ok ? 'muted' : 'trace-error'}>
                        {r.ok ? '→' : 'Failed:'} {r.summary}
                      </div>
                    ) : (
                      <div className="muted">running…</div>
                    )}
                  </li>
                );
              }
              if (e.type === 'comparison')
                return <ComparisonTrace key={i} comparison={e.comparison} />;
              if (e.type === 'note')
                return (
                  <li key={i} className="muted">
                    {e.message}
                  </li>
                );
              if (e.type === 'error')
                return (
                  <li key={i} className="trace-error">
                    Error: {e.message}
                  </li>
                );
              if (e.type === 'rejected')
                return (
                  <li key={i} className="trace-error">
                    Rejected “{e.title}”: {e.reason}
                  </li>
                );
              if (e.type === 'agent')
                return (
                  <li key={i}>
                    <strong>{AGENT_LABEL[e.agent]}</strong>
                  </li>
                );
              if (e.type === 'proposal_rejected')
                return (
                  <li key={i} className="trace-error">
                    Rejected proposal “{e.title}” ({AGENT_LABEL[e.agent]}): {e.reason}
                  </li>
                );
              return null;
            })}
          </ol>
          {done && (
            <p className="muted">
              Done: {done.findings} finding{done.findings === 1 ? '' : 's'}
              {done.proposals !== undefined
                ? `, ${done.proposals} proposal${done.proposals === 1 ? '' : 's'}`
                : ''}
              , {done.rejected} rejected, {done.tool_calls} tool calls,{' '}
              {(done.ms / 1000).toFixed(1)} s{done.stopped ? ` (stopped: ${done.stopped})` : ''}.
            </p>
          )}
        </Section>
      )}

      <Section
        title={`Proposed fixes (${proposals.length})`}
        hint="Concrete changes the agents suggest. Open one to see the UX and SEO arguments."
      >
        {proposals.length === 0 ? (
          <p className="muted">No proposals yet. Run an investigation.</p>
        ) : (
          <ul className="issue-list">
            {proposals.map((p) => {
              const open = openProposal === p.id;
              return (
                <li key={p.id} className={open ? 'open' : undefined}>
                  <button
                    type="button"
                    className="issue-item"
                    aria-expanded={open}
                    onClick={() => selectProposal(p)}
                  >
                    <span className="issue-help">{p.title}</span>
                    <span className="issue-meta">
                      {AGENT_LABEL[p.agent]} · {CHANGE_LABEL[p.change.type] ?? p.change.type} ·{' '}
                      {proposalTarget(p)}
                    </span>
                    <span className="issue-meta">
                      Expected: UX {EFFECT_TEXT[p.expected.ux]}, SEO {EFFECT_TEXT[p.expected.seo]}
                    </span>
                    {(() => {
                      const d = decisionOf.get(p.id);
                      const contested = d
                        ? isContested(d)
                        : p.expected.ux === 'worsens' || p.expected.seo === 'worsens';
                      return contested ? <span className="chip">UX vs SEO</span> : null;
                    })()}
                  </button>
                  {open && (
                    <div className="issue-detail">
                      <p>{p.rationale}</p>
                      <dl className="props">
                        <dt>Change</dt>
                        <dd>
                          <code>{p.change.type}</code> {JSON.stringify(p.change.params)}
                        </dd>
                        <dt>Resolves</dt>
                        <dd>{p.issue_keys.length ? p.issue_keys.join('; ') : 'No issue'}</dd>
                        <dt>Status</dt>
                        <dd>{p.status} (not applied)</dd>
                      </dl>
                      <DebatePanel
                        graph={graph}
                        decision={decisionOf.get(p.id)}
                        onLinearCreated={(url) =>
                          setDecisions((all) =>
                            all.map((x) =>
                              x.proposal_id === p.id ? { ...x, linear_issue_url: url } : x,
                            ),
                          )
                        }
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title={`Agent findings (${findings.filter((f) => !f.suppressed_by).length}${
          findings.some((f) => f.suppressed_by)
            ? `, ${findings.filter((f) => f.suppressed_by).length} suppressed`
            : ''
        })`}
        hint="Problems the agents found, with evidence. Select one to see it on the graph and send it on."
        defaultOpen
      >
        {findings.some((f) => f.suppressed_by) && (
          <button
            type="button"
            className="link-button"
            aria-pressed={showSuppressed}
            onClick={() => setShowSuppressed((v) => !v)}
          >
            {showSuppressed ? 'Hide' : 'Show'} {findings.filter((f) => f.suppressed_by).length}{' '}
            suppressed by your preferences
          </button>
        )}
        {findings.length === 0 ? (
          <p className="muted">No findings yet. Run an investigation.</p>
        ) : (
          <ul className="issue-list">
            {findings
              .filter((f) => showSuppressed || !f.suppressed_by)
              .map((f) => {
                const open = selected === f.id;
                return (
                  <li key={f.id} className={open ? 'open' : undefined}>
                    <button
                      type="button"
                      id={`finding-${f.id}`}
                      className="issue-item"
                      aria-expanded={open}
                      onClick={() => select(f)}
                    >
                      <span className={`sev sev-${SEV_CLASS[f.severity] ?? 'minor'}`}>
                        {sev(f.severity)}
                      </span>
                      <span className="issue-help">{f.title}</span>
                      <span className="issue-meta">
                        {AGENT_LABEL[f.agent ?? 'ux']} · {f.category}
                        {f.target ? ` · ${f.target.type} ${f.target.id}` : ''} · origin:{' '}
                        {f.origin ?? f.mode}
                        {f.stale ? ' · stale (no longer produced by the latest run)' : ''}
                        {f.suppressed_by
                          ? ` · suppressed by preference ${f.suppressed_by.fact_id} (${f.suppressed_by.text})`
                          : ''}
                      </span>
                      <ChannelChips record={f.channels} links={false} />
                    </button>
                    {open && (
                      <div className="issue-detail">
                        <p className="muted">
                          Origin: {f.origin ?? f.mode} · Mode: {f.mode}
                        </p>
                        <p>{f.explanation}</p>
                        <h4>Evidence</h4>
                        <ul className="edge-list">
                          {f.evidence.map((e, i) => (
                            <li key={i}>
                              <code>{e.tool}</code>
                              {Object.keys(e.args).length ? (
                                <span className="muted"> ({shortArgs(e.args)})</span>
                              ) : null}
                              :{' '}
                              {e.path.length > 1
                                ? e.path.join(' → ')
                                : `${e.screens.length} screen(s)`}
                            </li>
                          ))}
                        </ul>
                        <h4>Recommendation</h4>
                        <p>{f.recommendation}</p>
                        <SuggestedAssignee
                          graph={graph}
                          finding_id={f.id}
                          onConfirm={setAssignee}
                        />
                        <ChannelsPanel
                          graph={graph}
                          findingId={f.id}
                          record={f.channels}
                          assignee={assignee}
                          onChanged={() => void refresh()}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Section>
    </div>
  );
}
function ComparisonTrace({ comparison }: { comparison: Comparison }) {
  const block = (title: string, items: Comparison['improved']) => (
    <>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="trace">
          {items.map((i, k) => (
            <li key={k}>
              {i.text} <span className="muted">[cites {i.cite}]</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return (
    <li className="comparison">
      <strong>
        Compared with {comparison.from} (
        {comparison.source === 'ai' ? 'AI summary' : 'rule-based summary'})
      </strong>
      {comparison.note && <p className="muted">{comparison.note}</p>}
      {block('Improved', comparison.improved)}
      {block('Regressed', comparison.regressed)}
      {block('Persisting', comparison.persisting)}
    </li>
  );
}
