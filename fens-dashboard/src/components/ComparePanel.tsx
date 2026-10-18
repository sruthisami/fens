import { useState } from 'react';
import {
  ApiError,
  CHANNEL_LABEL,
  CHANNELS,
  channelsApi,
  releaseApi,
  type ReleaseDiff,
} from '../api';
interface Props {
  graph: string;
  graphs: string[];
  onHighlight: (label: string, nodeIds: string[], edgeIds?: string[]) => void;
}
const sev = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : '—');
export function ComparePanel({ graph, graphs, onHighlight }: Props) {
  const older = graphs.filter((g) => g !== graph);
  const [from, setFrom] = useState(older[0] ?? '');
  const [diff, setDiff] = useState<ReleaseDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, string[]>>({});
  const compare = async () => {
    if (!from) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await releaseApi.compare(graph, from);
      setDiff(r.diff);
      setMessage(
        `Remembered as ${r.memory.episode.id}: ${r.memory.fixed.length} finding fact(s) marked fixed, ${r.memory.superseded.length} older fact(s) superseded.`,
      );
    } catch (err) {
      setDiff(null);
      setError(err instanceof ApiError ? err.message : 'Could not compare the releases');
    } finally {
      setBusy(false);
    }
  };
  const resolveEverywhere = async (id: string, title: string) => {
    if (
      !window.confirm(
        `Resolve "${title}" everywhere? It is resolved in ${graph}. FlowLens comments on and closes the GitHub issue, comments on and marks done the Linear issue, and replies on the Figma comment (Figma's API cannot mark a comment resolved, so resolve that thread in Figma).`,
      )
    )
      return;
    setMessage(null);
    try {
      const r = await channelsApi.resolve(from, id, graph);
      setResolved((all) => ({
        ...all,
        [id]: CHANNELS.map((c) => {
          const x = r.results[c];
          return `${CHANNEL_LABEL[c]}: ${x?.status ?? 'not sent'}${x?.message ? ` (${x.message})` : ''}`;
        }),
      }));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not resolve the finding');
    }
  };
  if (older.length === 0) {
    return (
      <div className="tools">
        <p className="muted">Crawl a second release (for example demo-shop-v2) to compare them.</p>
      </div>
    );
  }
  return (
    <div className="tools">
      <form
        className="tool"
        onSubmit={(e) => {
          e.preventDefault();
          void compare();
        }}
      >
        <h3>Compare releases</h3>
        <p className="muted">
          Older release against <strong>{graph}</strong> (the newer one).
        </p>
        <div className="stack">
          <label htmlFor="compare-from">Older release</label>
          <select id="compare-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            {older.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy}>
          {busy ? 'Comparing…' : 'Compare'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>

      {diff && (
        <>
          <section className="tool" aria-labelledby="cards-title">
            <h3 id="cards-title">
              {diff.from} → {diff.to}
            </h3>
            <dl className="cards">
              <div className="card">
                <dt>Forced clicks</dt>
                <dd>
                  {diff.metrics.forcedClicks.from} → {diff.metrics.forcedClicks.to}
                </dd>
              </div>
              <div className="card">
                <dt>Orphans</dt>
                <dd>
                  {diff.metrics.orphans.from} → {diff.metrics.orphans.to}
                </dd>
              </div>
              <div className="card">
                <dt>Dead ends</dt>
                <dd>
                  {diff.metrics.deadEnds.from} → {diff.metrics.deadEnds.to}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => onHighlight(`Changed since ${diff.from}`, diff.changed_screens)}
              disabled={diff.changed_screens.length === 0}
            >
              Highlight changed screens ({diff.changed_screens.length})
            </button>
          </section>

          {message && <p role="status">{message}</p>}

          <section className="tool" aria-labelledby="fixed-title">
            <h3 id="fixed-title">Fixed page check results ({diff.issues.fixed.length})</h3>
            {diff.issues.fixed.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <table className="compare-table">
                <caption className="visually-hidden">Issues fixed in {diff.to}</caption>
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Issue</th>
                    <th scope="col">Screens before</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.issues.fixed.map((i) => (
                    <tr key={i.key}>
                      <td>{sev(i.severity)}</td>
                      <td>
                        {i.help} <span className="muted">({i.rule_id})</span>
                      </td>
                      <td>{i.screens.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="tool" aria-labelledby="new-title">
            <h3 id="new-title">
              New page check results ({diff.issues.new.length}) and agent findings (
              {diff.findings.new.length})
            </h3>
            {diff.issues.new.length + diff.findings.new.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="edge-list">
                {diff.issues.new.map((i) => (
                  <li key={i.key}>
                    <span className={`sev sev-${i.severity}`}>{sev(i.severity)}</span> {i.help}{' '}
                    <span className="muted">({i.rule_id})</span>
                  </li>
                ))}
                {diff.findings.new.map((f) => (
                  <li key={f.key}>
                    <span className="muted">Finding ({sev(f.severity)}):</span> {f.title}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tool" aria-labelledby="resolved-title">
            <h3 id="resolved-title">Resolved agent findings ({diff.findings.resolved.length})</h3>
            {diff.findings.resolved.length === 0 ? (
              <p className="muted">None.</p>
            ) : (
              <ul className="issue-list">
                {diff.findings.resolved.map((f) => (
                  <li key={f.id}>
                    <span
                      className={`sev sev-${f.severity === 'high' ? 'serious' : f.severity === 'medium' ? 'moderate' : 'minor'}`}
                    >
                      {sev(f.severity)}
                    </span>{' '}
                    {f.title}
                    <p className="muted">
                      {f.channel_status.github} · {f.channel_status.linear} ·{' '}
                      {f.channel_status.figma}
                    </p>
                    {(f.github_issue_url || f.linear_issue_url || f.figma_comment_url) &&
                      !resolved[f.id] && (
                        <div className="button-row">
                          {f.github_issue_url && (
                            <a href={f.github_issue_url} target="_blank" rel="noopener noreferrer">
                              GitHub
                              <span className="visually-hidden"> issue (opens in a new tab)</span>
                            </a>
                          )}
                          {f.linear_issue_url && (
                            <a href={f.linear_issue_url} target="_blank" rel="noopener noreferrer">
                              Linear
                              <span className="visually-hidden"> issue (opens in a new tab)</span>
                            </a>
                          )}
                          {f.figma_comment_url && (
                            <a href={f.figma_comment_url} target="_blank" rel="noopener noreferrer">
                              Figma
                              <span className="visually-hidden"> comment (opens in a new tab)</span>
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => void resolveEverywhere(f.id, f.title)}
                          >
                            Resolve everywhere
                          </button>
                        </div>
                      )}
                    {resolved[f.id] && (
                      <ul className="edge-list" role="status">
                        {resolved[f.id]?.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tool" aria-labelledby="persist-title">
            <h3 id="persist-title">
              Still present: page check results ({diff.issues.unchanged.length}), agent findings (
              {diff.findings.persisting.length})
            </h3>
            <ul className="edge-list">
              {diff.issues.unchanged.map((i) => (
                <li key={i.key}>
                  <span className={`sev sev-${i.severity_to}`}>{sev(i.severity_to)}</span> {i.help}{' '}
                  <span className="muted">({i.rule_id})</span>
                </li>
              ))}
              {diff.findings.persisting.map((f) => (
                <li key={f.key}>
                  Finding: {f.title}{' '}
                  <span className="muted">
                    ({sev(f.severity_from ?? '')} → {sev(f.severity_to)})
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="tool" aria-labelledby="screens-title">
            <h3 id="screens-title">Screens</h3>
            <p>
              Added: {diff.screens.added.length ? diff.screens.added.join(', ') : 'none'}
              <br />
              Removed: {diff.screens.removed.length ? diff.screens.removed.join(', ') : 'none'}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
