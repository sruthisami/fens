import { useEffect, useRef, useState } from 'react';
import { api, assetUrl, type EdgeDetail, type Problem, type ScreenDetail } from '../api';
import { severityLabel } from './IssuesPanel';
interface Props {
  graph: string;
  screenId: string;
  onClose: () => void;
  onOpenScreen: (id: string) => void;
  problems: Problem[];
  onOpenProblem: (id: string) => void;
}
const PROBLEM_SEV: Record<Problem['severity'], string> = {
  high: 'serious',
  medium: 'moderate',
  low: 'minor',
};
function EdgeList({
  title,
  edges,
  dir,
  onOpenScreen,
}: {
  title: string;
  edges: EdgeDetail[];
  dir: 'from' | 'to';
  onOpenScreen: (id: string) => void;
}) {
  return (
    <section>
      <h3>
        {title} <span className="count">({edges.length})</span>
      </h3>
      {edges.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <ul className="edge-list">
          {edges.map((e, i) => {
            const other = (dir === 'from' ? e.from : e.to) ?? '';
            return (
              <li key={`${other}-${e.action}-${i}`}>
                <button type="button" className="link-button" onClick={() => onOpenScreen(other)}>
                  {other}
                </button>{' '}
                <span className="muted">
                  “{e.action}” · {e.via === 'js' ? 'click' : 'link'}
                  {e.redirects_to ? ` · fresh visit lands on ${e.redirects_to}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
export function ScreenPanel({
  graph,
  screenId,
  onClose,
  onOpenScreen,
  problems,
  onOpenProblem,
}: Props) {
  const onScreen = problems.filter((p) => p.screens.includes(screenId));
  const [detail, setDetail] = useState<ScreenDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    api
      .screen(graph, screenId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [graph, screenId]);
  useEffect(() => {
    heading.current?.focus();
  }, [screenId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const s = detail?.screen;
  const flags = s
    ? [
        detail.incoming.length === 0 ? 'Orphan' : null,
        detail.outgoing.length === 0 ? 'Dead end' : null,
        s.state_required ? 'State-required' : null,
        s.link_depth === undefined && s.js_only_ratio !== undefined
          ? 'Not reachable by links'
          : null,
        s.mobile_overflow ? 'Scrolls sideways at 375px' : null,
      ].filter((f): f is string => f !== null)
    : [];
  return (
    <aside className="panel" aria-labelledby="panel-title">
      <div className="panel-head">
        <h2 id="panel-title" ref={heading} tabIndex={-1}>
          {screenId}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close screen details">
          Close
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!detail && !error && <p className="muted">Loading screen…</p>}
      {s && (
        <>
          <dl className="props">
            <dt>Title</dt>
            <dd>{s.title || '—'}</dd>
            <dt>Depth</dt>
            <dd>{s.depth ?? '—'}</dd>
            <dt>Discovered via</dt>
            <dd>{s.discovered_via ?? '—'}</dd>
            {s.js_only_ratio !== undefined && (
              <>
                <dt>Link depth</dt>
                <dd>{s.link_depth ?? 'Not reachable by links'}</dd>
                <dt>Text only after JavaScript</dt>
                <dd>
                  {Math.round(s.js_only_ratio * 100)}%
                  {s.raw_status && s.raw_status !== 200 ? ` (raw request: ${s.raw_status})` : ''}
                </dd>
                <dt>Structured data</dt>
                <dd>{s.jsonld_types?.length ? s.jsonld_types.join(', ') : 'None'}</dd>
                <dt>In sitemap</dt>
                <dd>{s.in_sitemap === undefined ? '—' : s.in_sitemap ? 'Yes' : 'No'}</dd>
                <dt>LCP / CLS</dt>
                <dd>
                  {s.lcp_ms === undefined ? '—' : `${s.lcp_ms} ms`} /{' '}
                  {s.cls === undefined ? '—' : s.cls}
                </dd>
              </>
            )}
            <dt>Flags</dt>
            <dd>
              {flags.length === 0 ? (
                'None'
              ) : (
                <ul className="flags">
                  {flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
          <section>
            <h3>
              Problems on this screen <span className="count">({onScreen.length})</span>
            </h3>
            {onScreen.length === 0 ? (
              <p className="muted">None</p>
            ) : (
              <ul className="edge-list">
                {onScreen.map((p) => (
                  <li key={p.id}>
                    <span className={`sev sev-${PROBLEM_SEV[p.severity]}`}>
                      {severityLabel(p.severity)}
                    </span>{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onOpenProblem(p.id)}
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>
              Page check results on this screen{' '}
              <span className="count">({detail.issues.length})</span>
            </h3>
            {detail.issues.length === 0 ? (
              <p className="muted">None</p>
            ) : (
              <ul className="edge-list">
                {detail.issues.map((i) => (
                  <li key={i.id}>
                    <span className={`sev sev-${i.severity}`}>{severityLabel(i.severity)}</span>{' '}
                    {i.help}{' '}
                    <span className="muted">
                      ({i.rule_id}
                      {i.node_count
                        ? `, ${i.node_count} element${i.node_count === 1 ? '' : 's'}`
                        : ''}
                      )
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {s.screenshot_url ? (
            <img
              className="shot"
              src={assetUrl(s.screenshot_url)}
              alt={`Screenshot of ${s.title || screenId} (${screenId})`}
              loading="lazy"
            />
          ) : (
            <p className="muted">No screenshot.</p>
          )}
          <EdgeList
            title="Incoming"
            edges={detail.incoming}
            dir="from"
            onOpenScreen={onOpenScreen}
          />
          <EdgeList title="Outgoing" edges={detail.outgoing} dir="to" onOpenScreen={onOpenScreen} />
          <section>
            <h3>
              Components <span className="count">({detail.components.length})</span>
            </h3>
            {detail.components.length === 0 ? (
              <p className="muted">None</p>
            ) : (
              <ul className="components">
                {detail.components.map((c) => (
                  <li key={c.name}>
                    {c.name} <span className="muted">× {c.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </aside>
  );
}
