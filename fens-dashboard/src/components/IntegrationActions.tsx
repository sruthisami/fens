import { useState } from 'react';
import type { CreatedLinearIssue, FigmaPreview, LinearPreview } from '../api';
interface Props {
  linear?: {
    url: string | null;
    preview: () => Promise<LinearPreview>;
    create: () => Promise<CreatedLinearIssue>;
    onCreated: (url: string) => void;
    confirmText?: string;
  };
  figma?: {
    url: string | null;
    preview: () => Promise<FigmaPreview>;
    post: () => Promise<{
      url: string;
    }>;
    onPosted: (url: string) => void;
  };
}
export function IntegrationActions({ linear, figma }: Props) {
  const [linearPreview, setLinearPreview] = useState<LinearPreview | null>(null);
  const [figmaPreview, setFigmaPreview] = useState<FigmaPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fail = (err: unknown, what: string) =>
    setMessage(err instanceof Error ? err.message : `Could not ${what}`);
  return (
    <div className="integrations">
      {linear && (
        <div className="button-row">
          <button
            type="button"
            onClick={() => void linear.preview().then(setLinearPreview, (e) => fail(e, 'preview'))}
          >
            Preview Linear issue
          </button>
          {linear.url ? (
            <a href={linear.url} target="_blank" rel="noopener noreferrer">
              Open Linear issue<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    linear.confirmText ?? 'Create a Linear issue for this non-code work?',
                  )
                )
                  return;
                linear.create().then(
                  (r) => {
                    linear.onCreated(r.url);
                    setMessage(
                      `Linear issue ${r.identifier} created: ${r.url}${r.note ? `. ${r.note}` : ''}`,
                    );
                  },
                  (e) => fail(e, 'create the Linear issue'),
                );
              }}
            >
              Create Linear issue
            </button>
          )}
        </div>
      )}
      {linearPreview && (
        <div className="preview">
          <h4>{linearPreview.title}</h4>
          <p className="muted">
            {linearPreview.configured
              ? `Team ${linearPreview.team_id}`
              : 'Dry run: LINEAR_API_KEY and LINEAR_TEAM_ID are not set in fens-api/.env'}
          </p>
          <p className="muted">
            Priority {linearPreview.priority_name} ({linearPreview.priority}) · Labels{' '}
            {linearPreview.labels.join(', ')} · Not assigned to anyone
          </p>
          <pre className="html-sample">
            <code>{linearPreview.description}</code>
          </pre>
        </div>
      )}
      {figma && (
        <div className="button-row">
          <button
            type="button"
            onClick={() => void figma.preview().then(setFigmaPreview, (e) => fail(e, 'preview'))}
          >
            Preview Figma comment
          </button>
          {figma.url ? (
            <a href={figma.url} target="_blank" rel="noopener noreferrer">
              Open Figma frame<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : (
            <button
              type="button"
              disabled={!figmaPreview || figmaPreview.dry_run}
              title={figmaPreview?.dry_run ? 'Dry run only; see the preview' : undefined}
              onClick={() => {
                if (!window.confirm('Post this comment on the Figma frame?')) return;
                figma.post().then(
                  (r) => {
                    figma.onPosted(r.url);
                    setMessage(`Figma comment posted: ${r.url}`);
                  },
                  (e) => fail(e, 'post the Figma comment'),
                );
              }}
            >
              Post Figma comment
            </button>
          )}
        </div>
      )}
      {figmaPreview && (
        <div className="preview">
          <h4>
            Figma comment on {figmaPreview.screen ?? 'no screen'}
            {figmaPreview.dry_run ? ' (dry run)' : ''}
          </h4>
          {figmaPreview.dry_run && (
            <ul className="edge-list">
              {figmaPreview.reasons.map((r) => (
                <li key={r} className="muted">
                  {r}
                </li>
              ))}
            </ul>
          )}
          <pre className="html-sample">
            <code>{JSON.stringify(figmaPreview.request, null, 2)}</code>
          </pre>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
