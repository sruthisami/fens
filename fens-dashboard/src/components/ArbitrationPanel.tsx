import { Fragment, useEffect, useRef, useState } from 'react';
import { DebatePanel, isContested } from './DebatePanel';
import { SuggestedAssignee } from './SuggestedAssignee';
import {
  decide,
  decisionsApi,
  proposalsApi,
  type Decision,
  type DecideEvent,
  type IssuePreview,
  type PlaybookRow,
  type Proposal,
} from '../api';
interface Props {
  graph: string;
  focusDecision?: { id: string } | null;
  onHighlight: (label: string, nodeIds: string[], edgeIds?: string[]) => void;
}
const AGENT_LABEL: Record<string, string> = { ux: 'UX agent', seo: 'SEO agent' };
const EFFECT = { improves: 'improves', neutral: 'no change', worsens: 'worsens' } as const;
const OUTCOME_LABEL: Record<Decision['outcome'], string> = {
  approved: 'Approved',
  reconciled: 'Reconciled',
  rejected: 'Rejected',
  needs_human: 'Needs a person',
};
const OUTCOME_CLASS: Record<Decision['outcome'], string> = {
  approved: 'minor',
  reconciled: 'moderate',
  rejected: 'serious',
  needs_human: 'critical',
};
function target(p: Proposal): string {
  const { screen, from, to, component } = p.change.params as Record<string, unknown>;
  if (p.change.type === 'add_link') return `${String(from)} → ${String(to)}`;
  if (p.change.type === 'remove_links')
    return `${String(from)} → ${(Array.isArray(to) ? to : []).join(', ')}`;
  return `${String(screen)}${component ? ` (${String(component)})` : ''}`;
}
function Score({ label, before, after }: { label: string; before: number; after: number }) {
  const d = after - before;
  return (
    <div className="score">
      {label} {before} → {after} ({d > 0 ? `+${d}` : d})
    </div>
  );
}
export function ArbitrationPanel({ graph, focusDecision, onHighlight }: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [mode, setMode] = useState<'rules' | 'llm'>('rules');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<IssuePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const refresh = () =>
    Promise.all([proposalsApi.list(graph), decisionsApi.list(graph)])
      .then(([p, d]) => {
        setProposals(p);
        setDecisions(d.decisions);
        setPlaybooks(d.playbooks);
      })
      .catch((err: Error) => setError(err.message));
  useEffect(() => {
    setOpen(null);
    setPreview(null);
    void refresh();
    return () => abort.current?.abort();
  }, [graph]);
  const run = async () => {
    setRunning(true);
    setError(null);
    setMessage(null);
    abort.current = new AbortController();
    const titles = new Map(proposals.map((p) => [p.id, p.title]));
    try {
      for await (const e of decide(graph, mode, abort.current.signal)) {
        const describe: Partial<Record<DecideEvent['type'], () => string>> = {
          start: () =>
            `Arbitrating ${
              (
                e as Extract<
                  DecideEvent,
                  {
                    type: 'start';
                  }
                >
              ).proposals
            } proposals…`,
          simulating: () => {
            const x = e as Extract<
              DecideEvent,
              {
                type: 'simulating';
              }
            >;
            return `Simulating ${x.label} for "${titles.get(x.proposal_id) ?? x.proposal_id}"…`;
          },
          decision: () => {
            const x = (
              e as Extract<
                DecideEvent,
                {
                  type: 'decision';
                }
              >
            ).decision;
            return `${OUTCOME_LABEL[x.outcome]}: ${x.proposal_title}`;
          },
          error: () =>
            `Error: ${
              (
                e as Extract<
                  DecideEvent,
                  {
                    type: 'error';
                  }
                >
              ).message
            }`,
          done: () => {
            const x = e as Extract<
              DecideEvent,
              {
                type: 'done';
              }
            >;
            return `Done: ${x.decisions} decisions (${Object.entries(x.outcomes)
              .map(([k, v]) => `${v} ${k.replace('_', ' ')}`)
              .join(', ')}) in ${(x.ms / 1000).toFixed(1)} s.`;
          },
        };
        const text = describe[e.type]?.();
        if (text) setStatus(text);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Arbitration failed');
    } finally {
      setRunning(false);
    }
  };
  const select = (p: Proposal, d: Decision | undefined) => {
    const next = open === p.id ? null : p.id;
    setOpen(next);
    setPreview(null);
    setMessage(null);
    if (next)
      onHighlight(`Affected by "${p.title}"`, d?.screens.length ? d.screens : p.targets.screens);
  };
  const showPreview = async (d: Decision) => {
    setMessage(null);
    try {
      setPreview(await decisionsApi.preview(graph, d.id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Preview failed');
    }
  };
  const createIssue = async (d: Decision) => {
    const who = assignee ? ` and assign @${assignee}` : '';
    if (
      !window.confirm(
        `Create a GitHub issue for the ${d.outcome} decision on "${d.proposal_title}"${who}?`,
      )
    )
      return;
    try {
      const r = await decisionsApi.createIssue(graph, d.id, assignee ?? undefined);
      setDecisions((all) =>
        all.map((x) => (x.id === d.id ? { ...x, github_issue_url: r.url } : x)),
      );
      setMessage(
        `Issue created: ${r.url}${r.assigned ? ` (assigned @${assignee})` : ''}${r.assign_note ? `. ${r.assign_note}` : ''}`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create the issue');
    }
  };
  const focused = useRef<{ id: string } | null>(null);
  useEffect(() => {
    if (!focusDecision || focused.current === focusDecision) return;
    const d = decisions.find((x) => x.id === focusDecision.id);
    const p = d && proposals.find((x) => x.id === d.proposal_id);
    if (!d || !p) return;
    focused.current = focusDecision;
    setOpen(p.id);
    onHighlight(`Affected by "${p.title}"`, d.screens.length ? d.screens : p.targets.screens);
    requestAnimationFrame(() =>
      document.getElementById(`proposal-${p.id}`)?.scrollIntoView({ block: 'start' }),
    );
  }, [decisions, proposals, focusDecision]);
  const byProposal = new Map(decisions.map((d) => [d.proposal_id, d]));
  return (
    <div className="tools">
      <form
        className="tool"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <h3>Arbitration</h3>
        <p className="muted">
          Each proposal is simulated on a copy of the graph. A lens that moves by less than 2 points
          counts as unchanged.
        </p>
        <div className="stack">
          <label htmlFor="arbitrate-mode">Rationale</label>
          <select
            id="arbitrate-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'rules' | 'llm')}
          >
            <option value="rules">Template (no AI)</option>
            <option value="llm">Written by Gemini</option>
          </select>
        </div>
        <button type="submit" disabled={running || proposals.length === 0}>
          {running ? 'Running…' : 'Run arbitration'}
        </button>
        <p className="muted" aria-live="polite">
          {status}
        </p>
        {error && <p role="alert">{error}</p>}
      </form>

      <section className="tool" aria-labelledby="arbitration-table">
        <h3 id="arbitration-table">Proposed fixes and verdicts ({proposals.length})</h3>
        {proposals.length === 0 ? (
          <p className="muted">No proposals yet. Run the agents in the Investigate tab first.</p>
        ) : (
          <table className="arbitration">
            <caption className="visually-hidden">
              Proposals with their simulated lens scores and decisions
            </caption>
            <thead>
              <tr>
                <th scope="col">Proposal</th>
                <th scope="col">Expected</th>
                <th scope="col">Simulated</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => {
                const d = byProposal.get(p.id);
                const expanded = open === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr className={expanded ? 'open' : undefined}>
                      <th scope="row">
                        <button
                          type="button"
                          id={`proposal-${p.id}`}
                          className="link-button"
                          aria-expanded={expanded}
                          onClick={() => select(p, d)}
                        >
                          {p.title}
                        </button>
                        <div className="muted">
                          {AGENT_LABEL[p.agent] ?? p.agent} · <code>{p.change.type}</code> ·{' '}
                          {target(p)}
                        </div>
                      </th>
                      <td>
                        UX {EFFECT[p.expected.ux]}, SEO {EFFECT[p.expected.seo]}
                      </td>
                      <td>
                        {d ? (
                          <>
                            <Score label="UX" before={d.ux_before} after={d.ux_after} />
                            <Score label="SEO" before={d.seo_before} after={d.seo_after} />
                            <div className="muted">
                              {d.playbook
                                ? `After the playbook's change (${d.playbook.name})`
                                : 'After the proposed change'}
                            </div>
                          </>
                        ) : (
                          <span className="muted">Not simulated yet</span>
                        )}
                      </td>
                      <td>
                        {d ? (
                          <>
                            <span className={`sev sev-${OUTCOME_CLASS[d.outcome]}`}>
                              {OUTCOME_LABEL[d.outcome]}
                            </span>
                            {isContested(d) && <div className="chip">UX vs SEO</div>}
                            {d.playbook && <div>Playbook: {d.playbook.name}</div>}
                            <div className="muted">
                              {d.precedent ? 'Follows a precedent' : 'No precedent'}
                            </div>
                            {d.note && <div className="muted">{d.note}</div>}
                          </>
                        ) : (
                          <span className="muted">No decision yet</span>
                        )}
                      </td>
                    </tr>
                    {expanded && d && (
                      <tr className="detail-row">
                        <td colSpan={4}>
                          <div className="issue-detail">
                            <p>{d.rationale}</p>
                            {d.outcome === 'needs_human' && (
                              <p>
                                <strong>Marked for a person to decide.</strong> Raise it in Linear
                                to discuss.
                              </p>
                            )}
                            <DebatePanel
                              graph={graph}
                              decision={d}
                              onLinearCreated={(url) =>
                                setDecisions((all) =>
                                  all.map((x) =>
                                    x.id === d.id ? { ...x, linear_issue_url: url } : x,
                                  ),
                                )
                              }
                            />
                            <details>
                              <summary>Simulation details</summary>
                              <ul className="edge-list">
                                {d.simulations.map((s) => (
                                  <li key={s.label}>
                                    <strong>{s.label}</strong>: UX {s.ux_before} → {s.ux_after} (
                                    {s.ux}
                                    ), SEO {s.seo_before} → {s.seo_after} ({s.seo})
                                    {s.parts.length > 0 && (
                                      <ul>
                                        {s.parts.map((x) => (
                                          <li key={`${x.lens}-${x.key}`} className="muted">
                                            {x.lens.toUpperCase()} {x.label}: penalty {x.before} →{' '}
                                            {x.after}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </details>
                            <SuggestedAssignee
                              graph={graph}
                              decision_id={d.id}
                              onConfirm={setAssignee}
                            />
                            {(d.outcome === 'approved' || d.outcome === 'reconciled') && (
                              <div className="button-row">
                                <button type="button" onClick={() => void showPreview(d)}>
                                  Preview GitHub issue
                                </button>
                                {d.github_issue_url ? (
                                  <a
                                    href={d.github_issue_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open GitHub issue
                                    <span className="visually-hidden"> (opens in a new tab)</span>
                                  </a>
                                ) : (
                                  <button type="button" onClick={() => void createIssue(d)}>
                                    Create GitHub issue
                                  </button>
                                )}
                              </div>
                            )}
                            {message && <p role="status">{message}</p>}
                            {preview && (
                              <div className="preview">
                                <h4>{preview.title}</h4>
                                <pre className="html-sample">
                                  <code>{preview.body}</code>
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {playbooks.length > 0 && (
        <section className="tool" aria-labelledby="playbooks-title">
          <h3 id="playbooks-title">Playbooks</h3>
          <ul className="edge-list">
            {playbooks.map((pb) => (
              <li key={pb.id}>
                <strong>{pb.name}</strong> <span className="muted">({pb.change_type})</span>:{' '}
                {pb.success_count} reconciled, {pb.fail_count} tried without success
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
