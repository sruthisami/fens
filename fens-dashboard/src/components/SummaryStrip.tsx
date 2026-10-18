import { LENSES, type Lens, type Problem, type ProblemSummary } from '../api';
export type NavKind = 'orphans' | 'deadEnds' | 'unlinked';
export type FixFilter = 'with_fix' | 'verified' | 'needs_human' | 'sent';
interface Props {
  problems: Problem[] | null;
  summary: ProblemSummary | null;
  lens: Lens | null;
  onLens: (lens: Lens | null) => void;
  nav: Record<NavKind, number>;
  onHighlight: (kind: NavKind) => void;
  onFixFilter: (filter: FixFilter) => void;
}
const NAV: [NavKind, string, string, string][] = [
  ['orphans', 'Orphan screen', 'Orphan screens', 'No link leads here'],
  ['deadEnds', 'Dead-end screen', 'Dead-end screens', 'No way forward'],
  ['unlinked', 'Screen crawlers miss', 'Screens crawlers miss', 'No plain link to it'],
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function fixMatches(p: Problem, filter: FixFilter): boolean {
  if (filter === 'with_fix') return p.proposal_ids.length > 0;
  if (filter === 'verified') return p.outcome === 'approved' || p.outcome === 'reconciled';
  if (filter === 'needs_human') return p.outcome === 'needs_human';
  return p.stage === 'sent' || p.stage === 'resolved';
}

export function SummaryStrip({
  problems,
  summary,
  lens,
  onLens,
  nav,
  onHighlight,
  onFixFilter,
}: Props) {
  const shown = (problems ?? []).filter((p) => !lens || p.lenses.includes(lens));
  const bySeverity = (s: Problem['severity']) => shown.filter((p) => p.severity === s).length;
  const fixes: [FixFilter, number, string, string][] = [
    [
      'with_fix',
      shown.filter((p) => fixMatches(p, 'with_fix')).length,
      'With a suggested fix',
      'Proposed by an agent',
    ],
    [
      'verified',
      shown.filter((p) => fixMatches(p, 'verified')).length,
      'Fix checked as safe',
      'Approved or reconciled',
    ],
    [
      'sent',
      shown.filter((p) => fixMatches(p, 'sent')).length,
      'Sent to the team',
      'GitHub, Linear, Figma',
    ],
  ];
  const needsHuman = shown.filter((p) => fixMatches(p, 'needs_human')).length;
  return (
    <section className="overview" aria-label="Overview">
      <div className="ov-card ov-issues">
        <h2 className="ov-title">{lens ? `${lens} problems` : 'Problems'}</h2>
        {summary ? (
          <>
            <div className="ov-head">
              <p className="ov-big">
                {shown.length}
                <span className="ov-unit"> {shown.length === 1 ? 'problem' : 'problems'}</span>
              </p>
              <fieldset className="segmented" aria-label="Lens filter for problems">
                <legend className="visually-hidden">Lens</legend>
                {([null, ...LENSES] as (Lens | null)[]).map((l) => (
                  <label
                    key={l ?? 'all'}
                    title={l ? 'A problem can belong to more than one lens' : undefined}
                  >
                    <input
                      type="radio"
                      name="lens"
                      value={l ?? 'all'}
                      checked={lens === l}
                      onChange={() => onLens(l)}
                    />
                    <span>
                      {l ?? 'All'}
                      {l ? ` ${summary.by_lens[l] ?? 0}` : ''}
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
            <p className="ov-sub">
              {bySeverity('high')} high · {bySeverity('medium')} medium · {bySeverity('low')} low
              severity.{' '}
              {summary.agents_run
                ? 'From the page checks and the agents’ review.'
                : 'From the page checks only: run the agents to find site-wide problems.'}
            </p>
          </>
        ) : (
          <p className="ov-sub">Loading problems…</p>
        )}
      </div>

      <div className="ov-card ov-nav">
        <h2 className="ov-title">Fixes</h2>
        <ul className="nav-problems">
          {fixes.map(([kind, n, text, hint]) => (
            <li key={kind}>
              <button
                type="button"
                className="nav-problem"
                onClick={() => onFixFilter(kind)}
                disabled={!summary || n === 0}
                title={`Show the ${plural(n, 'problem')}: ${text.toLowerCase()}`}
              >
                <span className="np-count">{summary ? n : '…'}</span>
                <span className="np-text">
                  {text}
                  <span className="np-hint">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {needsHuman > 0 && (
          <button type="button" className="link-button" onClick={() => onFixFilter('needs_human')}>
            {plural(needsHuman, 'fix needs', 'fixes need')} a person: the simulation made a lens
            worse
          </button>
        )}
      </div>

      <div className="ov-card ov-nav">
        <h2 className="ov-title">Site map</h2>
        <ul className="nav-problems">
          {NAV.map(([kind, one, many, hint]) => (
            <li key={kind}>
              <button
                type="button"
                data-hl={kind}
                className="nav-problem"
                onClick={() => onHighlight(kind)}
                disabled={nav[kind] === 0}
                title={`Highlight on the map: ${hint.toLowerCase()}`}
              >
                <span className="np-count">{nav[kind]}</span>
                <span className="np-text">
                  {nav[kind] === 1 ? one : many}
                  <span className="np-hint">{hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
