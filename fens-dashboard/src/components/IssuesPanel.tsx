import type { IssueDetail, IssueListItem } from '../api';
interface Props {
  issues: IssueListItem[];
  loading?: boolean;
  selectedId: string | null;
  detail: IssueDetail | null;
  detailError: string | null;
  onSelect: (id: string | null) => void;
  onOpenScreen: (id: string) => void;
}
export const severityLabel = (s: string) => s[0]?.toUpperCase() + s.slice(1);
const SOURCES: Record<string, string> = {
  flowlens: 'FlowLens',
  axe: 'axe-core',
  lighthouse: 'Lighthouse',
};
const sourceLabel = (s: string) => SOURCES[s] ?? s;
function IssueDetails({
  item,
  detail,
  onOpenScreen,
}: {
  item: IssueListItem;
  detail: IssueDetail;
  onOpenScreen: (id: string) => void;
}) {
  const sample = detail.screens[0];
  return (
    <div className="issue-detail">
      <p>{detail.issue.description}</p>
      <dl className="props">
        <dt>Lens</dt>
        <dd>{item.lenses.length ? item.lenses.join(' and ') : '—'}</dd>
        <dt>Found by</dt>
        <dd>
          {sourceLabel(item.source)} rule {item.rule_id}
        </dd>
        <dt>Elements</dt>
        <dd>
          {item.instance_count} on {item.screen_count} screen{item.screen_count === 1 ? '' : 's'}
        </dd>
        <dt>Guidelines</dt>
        <dd>
          {detail.guidelines
            .filter((g) => g.id !== `axe:${detail.issue.rule_id}`)
            .map((g) => `${g.lens}: ${g.name === g.id ? g.id : `${g.id} ${g.name}`}`)
            .join('; ') || 'No WCAG criterion (axe-core best practice)'}
        </dd>
        <dt>Component</dt>
        <dd>{detail.component ?? 'None'}</dd>
        <dt>Status</dt>
        <dd>{detail.issue.status}</dd>
      </dl>
      {sample && (
        <>
          <h4>Example ({sample.id})</h4>
          <p className="muted">
            Selector: <code>{sample.selector}</code>
          </p>
          <pre className="html-sample">
            <code>{sample.html}</code>
          </pre>
        </>
      )}
      {detail.issue.help_url && (
        <p>
          <a href={detail.issue.help_url} target="_blank" rel="noopener noreferrer">
            How to fix: {sourceLabel(detail.issue.source)} rule {detail.issue.rule_id}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      )}
      <h4>Screens ({detail.screens.length})</h4>
      <ul className="edge-list">
        {detail.screens.map((s) => (
          <li key={s.id}>
            <button type="button" className="link-button" onClick={() => onOpenScreen(s.id)}>
              {s.id}
            </button>{' '}
            <span className="muted">
              {s.details?.length
                ? s.details.join('; ')
                : `${s.node_count} element${s.node_count === 1 ? '' : 's'}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function IssuesPanel({
  issues,
  loading = false,
  selectedId,
  detail,
  detailError,
  onSelect,
  onOpenScreen,
}: Props) {
  return (
    <section className="issues" aria-label="Issues">
      {loading ? (
        <p className="muted">Loading issues…</p>
      ) : issues.length === 0 ? (
        <p className="muted">No issues found by the checks.</p>
      ) : (
        <ul className="issue-list">
          {issues.map((i) => {
            const open = selectedId === i.id;
            return (
              <li key={i.id} className={open ? 'open' : undefined}>
                <button
                  type="button"
                  className="issue-item"
                  aria-expanded={open}
                  onClick={() => onSelect(open ? null : i.id)}
                >
                  <span className={`sev sev-${i.severity}`}>{severityLabel(i.severity)}</span>
                  <span className="issue-help">{i.help}</span>
                  <span className="issue-meta">
                    On {i.screen_count} screen{i.screen_count === 1 ? '' : 's'}
                    {i.component ? ` · in ${i.component}` : ''}
                  </span>
                </button>
                {open && detailError && <p role="alert">{detailError}</p>}
                {open && !detail && !detailError && <p className="muted">Loading issue…</p>}
                {open && detail && (
                  <IssueDetails item={i} detail={detail} onOpenScreen={onOpenScreen} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
