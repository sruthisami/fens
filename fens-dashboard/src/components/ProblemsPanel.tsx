import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  decisionsApi,
  findingsApi,
  proposalsApi,
  type Decision,
  type Finding,
  type IssueListItem,
  type Lens,
  type Problem,
  type ProblemProcess,
  type ProblemSeverity,
  type ProblemStage,
  type Proposal,
} from '../api';
import { ChannelsPanel } from './ChannelsPanel';
import { SuggestedAssignee } from './SuggestedAssignee';
import { fixMatches, type FixFilter } from './SummaryStrip';

interface Props {
  graph: string;
  problems: Problem[] | null;
  error: string | null;
  issues: IssueListItem[];
  lens: Lens | null;
  fixFilter: FixFilter | null;
  onClearFixFilter: () => void;
  reloadKey: number;
  focusProblem: { id: string } | null;
  wide: boolean;
  onShowMap: () => void;
  onChanged: () => void;
  onHighlight: (label: string, nodeIds: string[], edgeIds?: string[]) => void;
  onOpenScreen: (id: string) => void;
  onShowCheck: (issueId: string) => void;
  onOpenFinding: (id: string) => void;
  onOpenDecision: (id: string) => void;
  onRunAgents: () => void;
}

const SEV_CLASS: Record<ProblemSeverity, string> = {
  high: 'serious',
  medium: 'moderate',
  low: 'minor',
};
const SEV_LABEL: Record<ProblemSeverity, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const STAGES: [ProblemStage, string][] = [
  ['found', 'Found'],
  ['fix_suggested', 'Fix suggested'],
  ['decided', 'Fix simulated'],
  ['sent', 'Sent'],
  ['resolved', 'Resolved'],
];
const STAGE_LABEL = Object.fromEntries(STAGES) as Record<ProblemStage, string>;
const OUTCOME_LABEL: Record<string, string> = {
  approved: 'Approved',
  reconciled: 'Reconciled',
  rejected: 'Rejected',
  needs_human: 'Needs a person',
};
const OUTCOME_HINT: Record<string, string> = {
  approved: 'No lens gets worse and at least one improves.',
  reconciled: 'The change hurt one lens; a playbook found a version that does not.',
  rejected: 'Nothing improves.',
  needs_human: 'A lens gets worse and no playbook helps: a person decides.',
};
const OUTCOME_CLASS: Record<string, string> = {
  approved: 'minor',
  reconciled: 'moderate',
  rejected: 'serious',
  needs_human: 'critical',
};
const EFFECT: Record<string, string> = {
  improves: 'improves',
  neutral: 'no change',
  worsens: 'worsens',
};
const FIX_LABEL: Record<FixFilter, string> = {
  with_fix: 'with a suggested fix',
  verified: 'whose fix was checked as safe',
  needs_human: 'whose fix needs a person',
  sent: 'sent to the team',
};
const PROCESS_SHORT: Record<ProblemProcess, string> = {
  page_check: 'Page check',
  map_analysis: 'Site map',
  content_analysis: 'Content',
};
const PROCESSES: [ProblemProcess | 'all', string][] = [
  ['all', 'Anything'],
  ['page_check', 'Page checks'],
  ['map_analysis', 'Site map analysis'],
  ['content_analysis', 'Content analysis'],
];

function pathEdges(findings: Finding[]): string[] {
  const edges = new Set<string>();
  for (const f of findings)
    for (const e of f.evidence) {
      const path = e.path ?? [];
      for (let i = 0; i + 1 < path.length; i++) edges.add(`${path[i]} -> ${path[i + 1]}`);
    }
  return [...edges];
}

const processes = (p: Problem) => [...new Set(p.found_by.map((f) => f.process))];

function Delta({ label, before, after }: { label: string; before: number; after: number }) {
  const d = after - before;
  return (
    <span className={`score ${d > 0 ? 'up' : d < 0 ? 'down' : 'same'}`}>
      {label} {before} → {after}{' '}
      <span className="score-delta">({d > 0 ? `+${d}` : d < 0 ? `${d}` : 'no change'})</span>
    </span>
  );
}

function Stepper({ stage }: { stage: ProblemStage }) {
  const at = STAGES.findIndex(([s]) => s === stage);
  return (
    <ol className="stepper" aria-label="Progress">
      {STAGES.map(([s, label], i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'current' : 'todo'}>
          <span className="step-dot" aria-hidden="true">
            {i < at ? '✓' : i + 1}
          </span>
          <span className="step-label">
            {label}
            {i < at && <span className="visually-hidden"> (done)</span>}
            {i === at && <span className="visually-hidden"> (current step)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Tags({ p }: { p: Problem }) {
  return (
    <span className="p-tags">
      <span className={`sev sev-${SEV_CLASS[p.severity]}`}>{SEV_LABEL[p.severity]}</span>
      {p.lenses.map((l) => (
        <span key={l} className={`lens-tag lens-${l.toLowerCase()}`}>
          {l}
        </span>
      ))}
    </span>
  );
}

function ProblemDetail({
  graph,
  problem,
  findings,
  proposals,
  decisions,
  issues,
  wide,
  onShowMap,
  onChanged,
  onHighlight,
  onShowCheck,
  onOpenFinding,
  onOpenDecision,
}: {
  graph: string;
  problem: Problem;
  findings: Finding[];
  proposals: Proposal[];
  decisions: Decision[];
  issues: Map<string, IssueListItem>;
  wide: boolean;
  onShowMap: () => void;
  onChanged: () => void;
  onHighlight: Props['onHighlight'];
  onShowCheck: Props['onShowCheck'];
  onOpenFinding: Props['onOpenFinding'];
  onOpenDecision: Props['onOpenDecision'];
}) {
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  useEffect(() => setToolStatus(null), [problem.id]);
  const lead = findings[0];
  const runTool = async (tool: string, args: Record<string, string>, label: string) => {
    setToolStatus(`Running ${tool}…`);
    try {
      const r = await api.tool(graph, tool, args);
      onHighlight(label, r.screens, r.edges);
      setToolStatus(
        `${label}: ${r.screens.length} screen${r.screens.length === 1 ? '' : 's'} highlighted on the map.`,
      );
    } catch (err) {
      setToolStatus(err instanceof ApiError ? err.message : `Could not run ${tool}`);
    }
  };
  const checkOnly = problem.issue_ids
    .map((id) => issues.get(id))
    .filter((i): i is IssueListItem => Boolean(i));

  const main = (
    <div className="pd-col">
      <section className="pd-section" aria-labelledby={`pd-what-${problem.id}`}>
        <h4 className="pd-h" id={`pd-what-${problem.id}`}>
          What’s wrong
        </h4>
        {lead ? (
          <p className="pd-text">{lead.explanation}</p>
        ) : (
          checkOnly.map((i) => (
            <p key={i.id} className="pd-text">
              A page check failed: {i.help}.
            </p>
          ))
        )}
        {lead && (
          <div className="callout">
            <strong>What to do</strong>
            <p>{lead.recommendation}</p>
          </div>
        )}
      </section>

      <section className="pd-section" aria-labelledby={`pd-found-${problem.id}`}>
        <h4 className="pd-h" id={`pd-found-${problem.id}`}>
          Found by
        </h4>
        <ul className="found-by">
          {problem.found_by.map((f, n) => (
            <li key={`${f.finding_id ?? f.issue_id ?? 'p'}-${n}`}>
              <span className={`proc proc-${f.process}`}>{PROCESS_SHORT[f.process]}</span>
              <div className="fb-body">
                <p className="fb-who">{f.by}</p>
                <p className="fb-detail">
                  {f.process_label}. {f.detail}.
                </p>
                <p className="fb-actions">
                  {f.issue_id && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onShowCheck(f.issue_id!)}
                    >
                      Open check result
                    </button>
                  )}
                  {f.finding_id && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenFinding(f.finding_id!)}
                    >
                      Open in Investigate
                    </button>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="pd-section" aria-labelledby={`pd-fix-${problem.id}`}>
        <h4 className="pd-h" id={`pd-fix-${problem.id}`}>
          Suggested fix
        </h4>
        {proposals.length === 0 ? (
          <p className="pd-text muted">
            No change from the fix catalog fits this problem (tables, content in the HTML, adding or
            removing links).{lead ? ' Follow “What to do” above.' : ''}
          </p>
        ) : (
          proposals.map((p) => {
            const d = decisions.find((x) => x.proposal_id === p.id);
            return (
              <div key={p.id} className="fix-card">
                <p className="fix-title">{p.title}</p>
                <p className="fix-meta">
                  Proposed by the {p.agent === 'seo' ? 'SEO' : 'UX'} agent. Expected: UX{' '}
                  {EFFECT[p.expected.ux]}, SEO {EFFECT[p.expected.seo]}.
                </p>
                {d ? (
                  <div className="verdict">
                    <p>
                      <span className={`sev sev-${OUTCOME_CLASS[d.outcome] ?? 'minor'}`}>
                        {OUTCOME_LABEL[d.outcome] ?? d.outcome}
                      </span>{' '}
                      <span className="muted">{OUTCOME_HINT[d.outcome]}</span>
                    </p>
                    <p className="scores">
                      <Delta label="UX" before={d.ux_before} after={d.ux_after} />
                      <Delta label="SEO" before={d.seo_before} after={d.seo_after} />
                    </p>
                    {d.playbook && <p className="muted">Playbook used: {d.playbook.name}.</p>}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenDecision(d.id)}
                    >
                      See the simulation and the UX vs SEO debate
                    </button>
                  </div>
                ) : (
                  <p className="muted">
                    Not simulated yet. Run arbitration to test it on a copy of the site.
                  </p>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );

  const side = (
    <div className="pd-col">
      <section className="pd-section" aria-labelledby={`pd-check-${problem.id}`}>
        <h4 className="pd-h" id={`pd-check-${problem.id}`}>
          Check it yourself
        </h4>
        {problem.guide.in_app.length > 0 && (
          <>
            <p className="pd-sub">In FlowLens</p>
            <ul className="tool-buttons">
              {problem.guide.in_app.map((t) => (
                <li key={`${t.tool}-${JSON.stringify(t.args)}`}>
                  <button
                    type="button"
                    className="tool-run"
                    onClick={() => void runTool(t.tool, t.args, t.label)}
                  >
                    <span aria-hidden="true">▶</span> {t.label}
                  </button>
                  <code className="tool-code">
                    {t.tool}
                    {Object.keys(t.args).length
                      ? `(${Object.entries(t.args)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(', ')})`
                      : ''}
                  </code>
                </li>
              ))}
            </ul>
            {toolStatus && (
              <p className="tool-status" aria-live="polite">
                {toolStatus}{' '}
                {wide && (
                  <button type="button" className="link-button" onClick={onShowMap}>
                    Show the map
                  </button>
                )}
              </p>
            )}
          </>
        )}
        {problem.guide.external.length > 0 && (
          <>
            <p className="pd-sub">Outside FlowLens</p>
            <ul className="ext-tools">
              {problem.guide.external.map((e) => (
                <li key={e.name}>
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer">
                      {e.name}
                      <span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <strong>{e.name}</strong>
                  )}
                  <span className="ext-how">{e.how}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="pd-section" aria-labelledby={`pd-send-${problem.id}`}>
        <h4 className="pd-h" id={`pd-send-${problem.id}`}>
          Send to the team
        </h4>
        {lead ? (
          <>
            <SuggestedAssignee graph={graph} finding_id={lead.id} onConfirm={setAssignee} />
            <ChannelsPanel
              graph={graph}
              findingId={lead.id}
              record={lead.channels}
              assignee={assignee}
              onChanged={onChanged}
            />
          </>
        ) : (
          <p className="pd-text muted">
            Run the agents once: every problem then has a finding that can be sent to GitHub, Linear
            (content problems only) or Figma.
          </p>
        )}
      </section>
    </div>
  );

  return (
    <div className="problem-detail">
      <Stepper stage={problem.stage} />
      <div className={`pd-body${wide ? ' two-col' : ''}`}>
        {main}
        {side}
      </div>
    </div>
  );
}

export function ProblemsPanel(props: Props) {
  const { graph, problems, error, lens, fixFilter, reloadKey, wide, onHighlight } = props;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [process, setProcess] = useState<ProblemProcess | 'all'>('all');
  const [severity, setSeverity] = useState<ProblemSeverity | 'all'>('all');
  const [query, setQuery] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([findingsApi.list(graph), proposalsApi.list(graph), decisionsApi.list(graph)])
      .then(([f, p, d]) => {
        if (cancelled) return;
        setFindings(f);
        setProposals(p);
        setDecisions(d.decisions);
      })
      .catch(() => {
        /* the problem list still shows; details fall back to what it carries */
      });
    return () => {
      cancelled = true;
    };
  }, [graph, reloadKey]);
  const shownGraph = useRef(graph);
  useEffect(() => {
    // Only on a real graph change, so a re-run of effects keeps a focused problem open.
    if (shownGraph.current === graph) return;
    shownGraph.current = graph;
    setOpen(null);
  }, [graph]);
  const focused = useRef<{ id: string } | null>(null);
  useEffect(() => {
    const target = props.focusProblem;
    if (!target || focused.current === target || !problems) return;
    const p = problems.find((x) => x.id === target.id);
    if (!p) return;
    focused.current = target;
    setProcess('all');
    setSeverity('all');
    setQuery('');
    setOpen(p.id);
    onHighlight(`Problem "${p.title}"`, p.screens);
    requestAnimationFrame(() =>
      document.getElementById(`problem-${p.id}`)?.scrollIntoView({ block: 'nearest' }),
    );
  }, [problems, props.focusProblem]);
  const issueMap = useMemo(() => new Map(props.issues.map((i) => [i.id, i])), [props.issues]);
  const all = problems ?? [];
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (p) =>
      (!lens || p.lenses.includes(lens)) &&
      (!fixFilter || fixMatches(p, fixFilter)) &&
      (severity === 'all' || p.severity === severity) &&
      (process === 'all' || p.found_by.some((f) => f.process === process)) &&
      (!q ||
        p.title.toLowerCase().includes(q) ||
        p.screens.some((s) => s.toLowerCase().includes(q)) ||
        p.found_by.some((f) => `${f.by} ${f.detail}`.toLowerCase().includes(q))),
  );
  const filtered = shown.length !== all.length;
  const select = (p: Problem, toggle: boolean) => {
    const next = toggle && open === p.id ? null : p.id;
    setOpen(next);
    if (next)
      onHighlight(
        `Problem "${p.title}"`,
        p.screens,
        pathEdges(findings.filter((f) => p.finding_ids.includes(f.id))),
      );
  };
  if (error) return <p role="alert">{error}</p>;
  if (!problems) return <p className="muted">Loading problems…</p>;
  const agentsRun = problems.some((p) => p.finding_ids.length);
  const detailFor = (p: Problem) => (
    <ProblemDetail
      graph={graph}
      problem={p}
      findings={p.finding_ids
        .map((id) => findings.find((f) => f.id === id))
        .filter((f): f is Finding => Boolean(f))}
      proposals={proposals.filter((x) => p.proposal_ids.includes(x.id))}
      decisions={decisions}
      issues={issueMap}
      wide={wide}
      onShowMap={props.onShowMap}
      onChanged={props.onChanged}
      onHighlight={onHighlight}
      onShowCheck={props.onShowCheck}
      onOpenFinding={props.onOpenFinding}
      onOpenDecision={props.onOpenDecision}
    />
  );
  const current = wide ? (shown.find((p) => p.id === open) ?? null) : null;
  return (
    <section className={`problems${wide ? ' wide' : ''}`} aria-label="Problems">
      {!agentsRun && (
        <p className="notice">
          These come from the page checks only.{' '}
          <button type="button" className="link-button" onClick={props.onRunAgents}>
            Run the agents
          </button>{' '}
          to find site-wide problems (journeys, orphans, content) and suggested fixes.
        </p>
      )}
      <div className="problem-toolbar" role="search">
        <label className="field search">
          <span className="visually-hidden">Search problems</span>
          <input
            type="search"
            placeholder="Search by title, screen or checker"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="field compact">
          <span className="field-label">Severity</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ProblemSeverity | 'all')}
          >
            <option value="all">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="field compact">
          <span className="field-label">Found by</span>
          <select
            value={process}
            onChange={(e) => setProcess(e.target.value as ProblemProcess | 'all')}
          >
            {PROCESSES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="problem-count" aria-live="polite">
        {filtered
          ? `Showing ${shown.length} of ${all.length} problems`
          : `${all.length} problem${all.length === 1 ? '' : 's'}`}
        {fixFilter ? `, only those ${FIX_LABEL[fixFilter]}` : ''}
        {lens ? `, ${lens} lens` : ''}.{' '}
        {fixFilter && (
          <button type="button" className="link-button" onClick={props.onClearFixFilter}>
            Clear the fix filter
          </button>
        )}
      </p>
      <div className="problem-layout">
        {shown.length === 0 ? (
          <p className="muted">No problems match.</p>
        ) : (
          <ul className="problem-list">
            {shown.map((p) => {
              const isOpen = open === p.id;
              return (
                <li
                  key={p.id}
                  id={`problem-${p.id}`}
                  className={`problem-card${isOpen ? ' open' : ''}`}
                >
                  <button
                    type="button"
                    className="problem-head"
                    aria-expanded={wide ? undefined : isOpen}
                    aria-current={wide && isOpen ? 'true' : undefined}
                    onClick={() => select(p, !wide)}
                  >
                    <span className="ph-top">
                      <Tags p={p} />
                      <span className={`stage-pill stage-${p.stage}`}>
                        {STAGE_LABEL[p.stage]}
                        {p.outcome ? `: ${OUTCOME_LABEL[p.outcome] ?? p.outcome}` : ''}
                      </span>
                    </span>
                    <span className="ph-title">{p.title}</span>
                    <span className="ph-meta">
                      {processes(p)
                        .map((x) => PROCESS_SHORT[x])
                        .join(' + ')}{' '}
                      · {p.screens.length} screen{p.screens.length === 1 ? '' : 's'}
                      {p.proposal_ids.length ? ' · fix proposed' : ''}
                    </span>
                  </button>
                  {!wide && isOpen && detailFor(p)}
                </li>
              );
            })}
          </ul>
        )}
        {wide && (
          <div className="problem-pane" aria-live="polite">
            {current ? (
              <>
                <header className="pane-head">
                  <Tags p={current} />
                  <h3>{current.title}</h3>
                  <p className="ph-meta pane-screens">
                    {current.screens.length} screen{current.screens.length === 1 ? '' : 's'}:{' '}
                    {current.screens.slice(0, 6).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="screen-chip"
                        onClick={() => props.onOpenScreen(s)}
                        title={`Open ${s}`}
                      >
                        {s}
                      </button>
                    ))}
                    {current.screens.length > 6 ? ` +${current.screens.length - 6} more` : ''}
                  </p>
                </header>
                {detailFor(current)}
              </>
            ) : (
              <p className="pane-empty">
                Select a problem to see what found it, its fix and how to check it.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
