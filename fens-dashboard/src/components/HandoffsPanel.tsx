import { useEffect, useMemo, useState } from 'react';
import { ApiError, coordApi, type Handoff } from '../api';
interface Props {
  graph: string;
  graphs: string[];
  active: boolean;
}
const LANES = ['ux', 'seo', 'decider', 'channels', 'closer', 'human'] as const;
const LANE_LABEL: Record<string, string> = {
  ux: 'UX agent',
  seo: 'SEO agent',
  decider: 'Decider',
  channels: 'Channels',
  closer: 'Closer',
  human: 'Needs a person',
};
const POLL_MS = 2000;
const STUCK_MS = 10000;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clock = (t: number | null) => (t ? new Date(t).toLocaleTimeString() : '—');
export function HandoffsPanel({ graph, graphs, active }: Props) {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [now, setNow] = useState(Date.now());
  const [run, setRun] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () =>
      coordApi.handoffs().then(
        (r) => {
          if (cancelled) return;
          setHandoffs(r.handoffs);
          setNow(r.now);
          setError(null);
        },
        (err: unknown) =>
          !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load handoffs'),
      );
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);
  const runs = useMemo(() => {
    const byRun = new Map<string, Handoff[]>();
    for (const h of handoffs) {
      const id = h.run_id ?? 'no run';
      byRun.set(id, [...(byRun.get(id) ?? []), h]);
    }
    return [...byRun.entries()]
      .map(([id, list]) => ({
        id,
        list: list.sort((a, b) => a.created_at - b.created_at),
        start: Math.min(...list.map((h) => h.created_at)),
      }))
      .sort((a, b) => b.start - a.start);
  }, [handoffs]);
  const shown = runs.find((r) => r.id === run) ?? runs[0] ?? null;
  const older = graphs.filter((g) => g !== graph);
  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await coordApi.pipeline(graph, compareWith || undefined);
      setRun(r.run_id);
      setMessage(
        `Pipeline ${r.run_id} started on ${graph}: ${r.handoffs.length} handoff(s) created.${r.comparison ? ` ${r.comparison}` : ''} Workers pick them up (start them with: cd fens-api && npm run workers).`,
      );
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not start the pipeline');
    } finally {
      setBusy(false);
    }
  };
  const stuck = shown?.list.some((h) => h.status === 'pending' && now - h.created_at > STUCK_MS);
  return (
    <div className="tools">
      <section className="tool" aria-labelledby="pipeline-title">
        <h3 id="pipeline-title">Agent pipeline</h3>
        <p className="muted">
          The UX and SEO agents scan {graph} in parallel, the decider claims their proposals once,
          and the channels worker prepares previews only (nothing is sent without your confirm).
          Each agent is a worker process.
        </p>
        <div className="stack">
          <label htmlFor="pipeline-compare">Also compare with (optional)</label>
          <select
            id="pipeline-compare"
            value={compareWith}
            onChange={(e) => setCompareWith(e.target.value)}
          >
            <option value="">No comparison</option>
            {older.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => void start()} disabled={busy || !graph}>
          {busy ? 'Starting…' : 'Run pipeline'}
        </button>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </section>

      {runs.length > 0 && (
        <section className="tool" aria-labelledby="runs-title">
          <h3 id="runs-title">Run</h3>
          <label className="field">
            Show run
            <select value={shown?.id ?? ''} onChange={(e) => setRun(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} ({new Date(r.start).toLocaleTimeString()}, {r.list.length} handoffs)
                </option>
              ))}
            </select>
          </label>
          {stuck && (
            <p role="alert">
              A handoff has waited more than 10 s: are the workers running?{' '}
              <code>cd fens-api &amp;&amp; npm run workers</code>
            </p>
          )}
          {shown && <Timeline list={shown.list} now={now} />}
        </section>
      )}

      <section className="tool" aria-labelledby="handoffs-title">
        <h3 id="handoffs-title">Handoffs{shown ? ` in ${shown.id}` : ''}</h3>
        <p className="muted">Updated every 2 seconds while this tab is open.</p>
        {!shown ? (
          <p className="muted">No handoffs yet. Run the pipeline.</p>
        ) : (
          <div className="table-scroll" tabIndex={0} aria-label="Handoffs table">
            <table className="compare-table">
              <caption className="visually-hidden">Handoffs of the run, oldest first</caption>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">From → to</th>
                  <th scope="col">Status</th>
                  <th scope="col">Claimed by</th>
                  <th scope="col">Created</th>
                  <th scope="col">Claimed</th>
                  <th scope="col">Done</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.list.map((h) => (
                  <tr key={h.id}>
                    <td>{h.kind}</td>
                    <td>
                      {h.from_agent} → {h.to_agent}
                    </td>
                    <td>
                      <span className={`status status-${h.status}`}>{h.status}</span>
                    </td>
                    <td>{h.claimed_by ?? '—'}</td>
                    <td>{clock(h.created_at)}</td>
                    <td>{clock(h.claimed_at)}</td>
                    <td>{clock(h.done_at)}</td>
                    <td>{h.attempts}</td>
                    <td>{h.error ? `Error: ${h.error}` : (h.result ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
function Timeline({ list, now }: { list: Handoff[]; now: number }) {
  const t0 = Math.min(...list.map((h) => h.created_at));
  const end = Math.max(
    ...list.map((h) => h.done_at ?? (h.status === 'failed' ? h.updated_at : now)),
    t0 + 1000,
  );
  const span = end - t0;
  const lanes = LANES.filter((l) => list.some((h) => h.to_agent === l));
  const W = 600;
  const LANE_H = 28;
  const LEFT = 110;
  const x = (t: number) => LEFT + ((t - t0) / span) * (W - LEFT - 10);
  const y = (lane: string) => 18 + lanes.indexOf(lane as (typeof LANES)[number]) * LANE_H;
  const scan = (a: string) => list.find((h) => h.kind === 'scan_requested' && h.to_agent === a);
  const ux = scan('ux');
  const seo = scan('seo');
  const overlap =
    ux?.claimed_at && seo?.claimed_at
      ? Math.min(ux.done_at ?? now, seo.done_at ?? now) - Math.max(ux.claimed_at, seo.claimed_at)
      : null;
  return (
    <figure className="timeline">
      <svg
        viewBox={`0 0 ${W} ${18 + lanes.length * LANE_H + 14}`}
        role="img"
        aria-labelledby="timeline-text"
      >
        {lanes.map((l) => (
          <g key={l}>
            <text x={4} y={y(l) + 4} className="timeline-label">
              {LANE_LABEL[l]}
            </text>
            <line x1={LEFT} x2={W - 10} y1={y(l)} y2={y(l)} className="timeline-lane" />
          </g>
        ))}
        {list.map((h) => {
          const ly = y(h.to_agent);
          const claimed = h.claimed_at ?? (h.status === 'pending' ? now : h.updated_at);
          const done = h.done_at ?? (h.status === 'claimed' ? now : h.updated_at);
          const froms = h.from_agent
            .split('+')
            .filter((f) => lanes.includes(f as (typeof LANES)[number]));
          return (
            <g key={h.id}>
              {froms.map((f) => (
                <line
                  key={f}
                  x1={x(h.created_at)}
                  x2={x(h.created_at)}
                  y1={y(f)}
                  y2={ly}
                  className="timeline-handoff"
                />
              ))}
              <line
                x1={x(h.created_at)}
                x2={x(claimed)}
                y1={ly}
                y2={ly}
                className="timeline-wait"
              />
              {h.claimed_at && (
                <rect
                  x={x(h.claimed_at)}
                  y={ly - 7}
                  width={Math.max(2, x(done) - x(h.claimed_at))}
                  height={14}
                  className={`timeline-work work-${h.status}`}
                />
              )}
            </g>
          );
        })}
        <text x={LEFT} y={18 + lanes.length * LANE_H + 8} className="timeline-label">
          0 s
        </text>
        <text
          x={W - 10}
          y={18 + lanes.length * LANE_H + 8}
          textAnchor="end"
          className="timeline-label"
        >
          {secs(span)}
        </text>
      </svg>
      <figcaption id="timeline-text">
        <ol className="edge-list">
          {list.map((h) => (
            <li key={h.id}>
              {LANE_LABEL[h.to_agent] ?? h.to_agent}: {h.kind} from {h.from_agent}, created at{' '}
              {secs(h.created_at - t0)}
              {h.claimed_at
                ? `, worked ${secs(h.claimed_at - t0)} to ${h.done_at ? secs(h.done_at - t0) : 'now'}`
                : ', waiting'}
              , {h.status}
              {h.attempts ? ` after ${h.attempts} returned claim(s)` : ''}.
            </li>
          ))}
        </ol>
        {overlap !== null && (
          <p className="muted">
            {overlap > 0
              ? `The UX and SEO agents ran in parallel for ${secs(overlap)}.`
              : 'The UX and SEO agents did not overlap in this run.'}{' '}
            Dashed: waiting for a worker. Solid: an agent working.
          </p>
        )}
      </figcaption>
    </figure>
  );
}
