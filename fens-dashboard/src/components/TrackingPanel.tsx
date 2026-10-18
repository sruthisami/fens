import { useEffect, useState } from 'react';
import { CHANNELS, decisionsApi, findingsApi, type Decision, type Finding } from '../api';
import { ChannelChips, channelView } from './ChannelBadges';

interface Props {
  graph: string;
  active: boolean;
  onOpenFinding: (id: string) => void;
}
type Filter = 'all' | 'sent' | 'unsent' | 'open';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sent', label: 'Sent' },
  { value: 'open', label: 'Still open' },
  { value: 'unsent', label: 'Not sent' },
];
const SEV_CLASS: Record<string, string> = { high: 'serious', medium: 'moderate', low: 'minor' };
const sev = (s: string) => s[0]?.toUpperCase() + s.slice(1);
const OUTCOME: Record<string, string> = {
  approved: 'Approved',
  reconciled: 'Reconciled',
  needs_human: 'Needs a person',
  rejected: 'Rejected',
};
const isSent = (f: Finding) => CHANNELS.some((c) => channelView(f.channels, c).state !== 'none');
const isOpen = (f: Finding) => CHANNELS.some((c) => channelView(f.channels, c).state === 'open');

export function TrackingPanel({ graph, active, onOpenFinding }: Props) {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    Promise.all([findingsApi.list(graph), decisionsApi.list(graph)]).then(
      ([f, d]) => {
        setFindings(f);
        setDecisions(d.decisions);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : 'Could not load tracking'),
    );
  useEffect(() => {
    if (active) void load();
  }, [graph, active]);

  if (error) return <p role="alert">{error}</p>;
  if (!findings) return <p className="muted">Loading…</p>;

  const counts = CHANNELS.map((c) => {
    const views = findings.map((f) => channelView(f.channels, c));
    return {
      c,
      name: views[0]?.name ?? c,
      open: views.filter((v) => v.state === 'open').length,
      closed: views.filter((v) => v.state === 'closed').length,
    };
  });
  const sentCount = findings.filter(isSent).length;
  const shown = findings.filter((f) =>
    filter === 'sent'
      ? isSent(f)
      : filter === 'unsent'
        ? !isSent(f)
        : filter === 'open'
          ? isOpen(f)
          : true,
  );
  const tracked = decisions.filter((d) => d.github_issue_url || d.linear_issue_url);

  return (
    <div className="tools">
      <section className="tool" aria-labelledby="tracking-title">
        <h3 id="tracking-title">Where findings are tracked</h3>
        <p>
          <strong>{sentCount}</strong> of {findings.length} finding
          {findings.length === 1 ? '' : 's'} in {graph} sent to at least one channel.
        </p>
        <table className="compare-table tracking-totals">
          <caption className="visually-hidden">Open and closed items per channel</caption>
          <thead>
            <tr>
              <th scope="col">Channel</th>
              <th scope="col">Open</th>
              <th scope="col">Closed</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((x) => (
              <tr key={x.c}>
                <th scope="row">{x.name}</th>
                <td>{x.open}</td>
                <td>{x.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          ● open · ✓ closed (GitHub closed, Linear done, Figma resolved reply) · ○ not sent. To send
          or check a finding, open it in Investigate. Closing happens in Compare, once a newer
          release no longer has the finding.
        </p>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </section>

      <section className="tool" aria-labelledby="tracking-findings">
        <h3 id="tracking-findings">Agent findings ({shown.length})</h3>
        <fieldset className="segmented">
          <legend className="visually-hidden">Show findings</legend>
          {FILTERS.map((x) => (
            <label key={x.value}>
              <input
                type="radio"
                name="tracking-filter"
                value={x.value}
                checked={filter === x.value}
                onChange={() => setFilter(x.value)}
              />
              <span>{x.label}</span>
            </label>
          ))}
        </fieldset>
        {shown.length === 0 ? (
          <p className="muted">
            {findings.length === 0 ? 'No findings yet. Run an investigation.' : 'None.'}
          </p>
        ) : (
          <ul className="issue-list tracking-list">
            {shown.map((f) => (
              <li key={f.id}>
                <div className="tracking-head">
                  <span className={`sev sev-${SEV_CLASS[f.severity] ?? 'minor'}`}>
                    {sev(f.severity)}
                  </span>
                  <span className="issue-help">{f.title}</span>
                </div>
                <span className="issue-meta">
                  {f.agent === 'seo' ? 'SEO agent' : 'UX agent'} · {f.category}
                  {f.stale ? ' · stale' : ''}
                </span>
                <ChannelChips record={f.channels} />
                <button type="button" className="link-button" onClick={() => onOpenFinding(f.id)}>
                  Open in Investigate
                  <span className="visually-hidden">: {f.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tool" aria-labelledby="tracking-decisions">
        <h3 id="tracking-decisions">Decisions with an issue ({tracked.length})</h3>
        {tracked.length === 0 ? (
          <p className="muted">
            None. Approved and reconciled decisions can open a GitHub issue in Arbitration;
            needs-a-person decisions can open a Linear issue.
          </p>
        ) : (
          <ul className="issue-list tracking-list">
            {tracked.map((d) => (
              <li key={d.id}>
                <span className="issue-help">{d.proposal_title}</span>
                <span className="issue-meta">{OUTCOME[d.outcome] ?? d.outcome}</span>
                <span className="chips">
                  {d.github_issue_url && (
                    <span className="chip">
                      <a href={d.github_issue_url} target="_blank" rel="noopener noreferrer">
                        GitHub issue
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </a>
                    </span>
                  )}
                  {d.linear_issue_url && (
                    <span className="chip">
                      <a href={d.linear_issue_url} target="_blank" rel="noopener noreferrer">
                        Linear issue
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </a>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
