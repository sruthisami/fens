import { useEffect, useState } from 'react';
import { Section } from './Section';
import {
  ApiError,
  chatApi,
  memoryApi,
  type ChatSession,
  type Episode,
  type Fact,
  type PlaybookStat,
  type Procedure,
} from '../api';
interface Props {
  active: boolean;
}
const day = (iso: string) => iso.slice(0, 10);
const time = (iso: string) => iso.slice(11, 16);
export function MemoryPanel({ active }: Props) {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [history, setHistory] = useState(false);
  const [prefs, setPrefs] = useState<Fact[]>([]);
  const [procs, setProcs] = useState<Procedure[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookStat[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const load = () =>
    Promise.all([
      memoryApi.episodes(),
      memoryApi.facts(history),
      memoryApi.preferences(),
      memoryApi.procedures(),
      chatApi.sessions(),
    ]).then(
      ([e, f, p, pr, s]) => {
        setEpisodes(e);
        setFacts(f);
        setPrefs(p);
        setProcs(pr.procedures);
        setPlaybooks(pr.playbooks);
        setSessions(s.sessions);
        setError(null);
      },
      (err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load memory'),
    );
  useEffect(() => {
    if (active) void load();
  }, [active, history]);
  const addPreference = async () => {
    const value = rule.trim();
    if (!value) return;
    const subject = /^(rule|category|component|screen):/.test(value) ? value : `rule:${value}`;
    try {
      const r = await memoryApi.remember({
        subject,
        predicate: 'flag',
        object: 'no',
        kind: 'preference',
      });
      setMessage(
        `Remembered ${r.fact.id}: ${subject} flag no (${r.status}). Matching findings now show as suppressed.`,
      );
      setRule('');
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save the preference');
    }
  };
  const days = [...new Set(episodes.map((e) => day(e.at)))];
  return (
    <div className="tools">
      {error && <p role="alert">{error}</p>}

      <Section
        title={`Your preferences (${prefs.length})`}
        hint="Rules you don't want flagged. Matching findings are hidden by default."
        defaultOpen
      >
        {prefs.length === 0 ? (
          <p className="muted">
            None. A preference such as "do not flag heading-order" hides matching findings from the
            default view (they stay listed as suppressed).
          </p>
        ) : (
          <ul className="edge-list">
            {prefs.map((p) => (
              <li key={p.id}>
                {p.subject} {p.predicate}: {p.object}{' '}
                <span className="muted">
                  ({p.id}, {p.scope} memory)
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void addPreference();
          }}
        >
          <label htmlFor="pref-rule">
            Do not flag (rule id, or rule:/category:/component:/screen:)
          </label>
          <input
            id="pref-rule"
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            placeholder="heading-order"
          />
          <button type="submit" disabled={!rule.trim()}>
            Remember preference
          </button>
        </form>
        {message && <p role="status">{message}</p>}
      </Section>

      <Section
        title={`Facts (${facts.length})`}
        hint="What FlowLens has learned about this site and team."
      >
        <label className="check">
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />{' '}
          Include history (superseded facts)
        </label>
        <ul className="edge-list">
          {facts.map((f) => (
            <li key={f.id}>
              <strong>{f.subject}</strong> {f.predicate}: {f.object}{' '}
              <span className="muted">
                ({f.kind}, confidence {f.confidence.toFixed(2)}, {f.scope} memory, {f.id})
              </span>
              {f.valid_to ? (
                <span className="muted">
                  {' '}
                  — superseded{f.superseded_by ? ` by ${f.superseded_by}` : ''} on {day(f.valid_to)}
                </span>
              ) : (
                <span className="muted">
                  {' '}
                  — current{f.supersedes.length ? `, supersedes ${f.supersedes.join(', ')}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Procedures and playbooks"
        hint="Repeatable steps and how often each fix pattern worked."
      >
        <table className="compare-table">
          <caption className="visually-hidden">Playbook success rates</caption>
          <thead>
            <tr>
              <th scope="col">Playbook</th>
              <th scope="col">Succeeded</th>
              <th scope="col">Tried, not used</th>
              <th scope="col">Success rate</th>
            </tr>
          </thead>
          <tbody>
            {playbooks.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name} <span className="muted">({p.id})</span>
                </td>
                <td>{p.success_count}</td>
                <td>{p.fail_count}</td>
                <td>{p.rate === null ? 'not used yet' : `${Math.round(p.rate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="edge-list">
          {procs.map((p) => (
            <li key={p.id}>
              {p.name}: used {p.uses} time(s)
              {p.last_used ? `, last ${day(p.last_used)} ${time(p.last_used)}` : ''}.{' '}
              <span className="muted">Steps: {p.steps.join(' → ')}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Episodes (${episodes.length})`} hint="A day-by-day log of agent activity.">
        {days.map((d) => (
          <div key={d}>
            <h4>{d}</h4>
            <ol className="edge-list">
              {episodes
                .filter((e) => day(e.at) === d)
                .map((e) => (
                  <li key={e.id}>
                    {time(e.at)} <strong>{e.type}</strong> ({e.agent}
                    {e.scope === 'user' ? ', yours' : ''}): {e.summary}
                  </li>
                ))}
            </ol>
          </div>
        ))}
      </Section>

      <Section title={`Your sessions (${sessions.length})`} hint="Your past working sessions.">
        <ul className="edge-list">
          {sessions.map((s) => (
            <li key={s.id}>
              {s.id}: {s.status}, started {day(s.started_at)} {time(s.started_at)}
              {s.summary ? ` — ${s.summary}` : ''}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
