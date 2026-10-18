import { useEffect, useState } from 'react';
import { decisionsApi, type Debate, type DebateArgument, type Decision } from '../api';
import { IntegrationActions } from './IntegrationActions';

const AGENT: Record<string, string> = { ux: 'UX agent', seo: 'SEO agent' };
const STANCE: Record<DebateArgument['stance'], string> = {
  for: 'For',
  against: 'Against',
  'no objection': 'No objection',
};

export const isContested = (d: Decision) => {
  const first = d.simulations[0];
  if (!first) return d.outcome === 'needs_human' || d.outcome === 'reconciled';
  return first.ux === 'worsens' || first.seo === 'worsens';
};

function Side({ arg }: { arg: DebateArgument }) {
  return (
    <section className={`debate-side stance-${arg.stance.replace(' ', '-')}`}>
      <h5>
        <span className="debate-stance">{STANCE[arg.stance]}</span> {AGENT[arg.agent] ?? arg.agent}
      </h5>
      {arg.text ? (
        <>
          <p>{arg.text}</p>
          <details>
            <summary>Facts behind it</summary>
            <ul>
              {arg.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <ul>
          {arg.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DebatePanel({
  graph,
  decision,
  onLinearCreated,
}: {
  graph: string;
  decision: Decision | undefined;
  onLinearCreated: (url: string) => void;
}) {
  const [mode, setMode] = useState<'rules' | 'llm'>('rules');
  const [debate, setDebate] = useState<Debate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = decision?.id;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    decisionsApi
      .debate(graph, id, mode)
      .then(
        (d) => !cancelled && setDebate(d),
        (err: unknown) =>
          !cancelled && setError(err instanceof Error ? err.message : 'Could not load the debate'),
      )
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [graph, id, mode]);

  if (!decision)
    return (
      <div className="debate">
        <h4>UX vs SEO</h4>
        <p className="muted">
          Not simulated yet. Run arbitration (Arbitration tab) to test this proposal; the two
          agents' arguments are built from that simulation.
        </p>
      </div>
    );

  return (
    <div className="debate" aria-busy={busy}>
      <div className="debate-head">
        <h4>{debate?.contested === false ? 'Both agents' : 'UX vs SEO'}</h4>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={() => setMode((m) => (m === 'rules' ? 'llm' : 'rules'))}
        >
          {mode === 'rules' ? 'Write as prose (Gemini)' : 'Show the data only'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {busy && !debate && <p className="muted">Loading the arguments…</p>}
      {debate && (
        <>
          <div className="debate-sides">
            <Side arg={debate.for} />
            <Side arg={debate.against} />
          </div>
          {debate.compromise && (
            <section className="debate-compromise">
              <h5>Compromise the decider found: {debate.compromise.playbook.name}</h5>
              <p>{debate.compromise.playbook.description}</p>
              <ul>
                {debate.compromise.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </section>
          )}
          {debate.note && <p className="muted">{debate.note}</p>}
          <p className="muted">
            {debate.mode === 'llm'
              ? 'Written by Gemini from the facts listed; text citing numbers not in the facts is dropped.'
              : 'Built from the simulation, the issues the proposal fixes and the guideline conflict.'}{' '}
            Scores are illustrative.
          </p>
          {debate.contested && (
            <div className="debate-linear">
              <p>
                <strong>Discuss it with the team:</strong> a Linear issue carries both arguments
                {debate.compromise ? ' and the compromise' : ''}, with a link back here.
              </p>
              <IntegrationActions
                linear={{
                  url: decision.linear_issue_url,
                  preview: () => decisionsApi.linearPreview(graph, decision.id),
                  create: () => decisionsApi.createLinear(graph, decision.id),
                  onCreated: onLinearCreated,
                  confirmText: `Create a Linear issue to discuss "${decision.proposal_title}" (UX vs SEO)?`,
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
