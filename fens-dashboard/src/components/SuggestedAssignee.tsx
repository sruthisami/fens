import { useEffect, useState } from 'react';
import { api, type AssigneeSuggestion } from '../api';
interface Props {
  graph: string;
  finding_id?: string;
  decision_id?: string;
  onConfirm: (login: string | null) => void;
}
export function SuggestedAssignee({ graph, finding_id, decision_id, onConfirm }: Props) {
  const [s, setS] = useState<AssigneeSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    onConfirm(null);
    api
      .tool<AssigneeSuggestion>(
        graph,
        'suggest_assignee',
        finding_id ? { finding_id } : { decision_id: decision_id ?? '' },
      )
      .then((r) => !cancelled && setS(r.result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [graph, finding_id, decision_id]);
  if (error) return <p className="muted">Suggested assignee unavailable: {error}</p>;
  if (!s) return <p className="muted">Looking for a suggested assignee…</p>;
  const top = s.ranking[0];
  if (!top)
    return (
      <p className="muted">Suggested assignee: none ({s.note ?? 'no similar resolved issues'}).</p>
    );
  const id = `assign-${finding_id ?? decision_id}`;
  return (
    <div className="suggestion">
      <p>
        <strong>Suggested assignee (confirm):</strong> {top.person}
        {top.team ? ` (${top.team})` : ''}, {top.similar} similar resolved issue
        {top.similar === 1 ? '' : 's'}
      </p>
      <ul className="edge-list">
        {top.evidence.slice(0, 3).map((e) => (
          <li key={e.title} className="muted">
            “{e.title}” ({e.closed_at.slice(0, 10)}): {e.matched.join(', ')}
          </li>
        ))}
      </ul>
      {top.github ? (
        <label className="checkbox" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked);
              onConfirm(e.target.checked ? top.github : null);
            }}
          />
          Assign {top.person} (@{top.github}) on the GitHub issue I create
        </label>
      ) : (
        <p className="muted">
          No GitHub login on record for {top.person}, so the issue only mentions the suggestion.
        </p>
      )}
    </div>
  );
}
