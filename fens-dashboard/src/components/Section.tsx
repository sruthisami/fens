import type { ReactNode } from 'react';

export function Section({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="section" open={defaultOpen || undefined}>
      <summary>
        <span className="section-text">
          <h3>{title}</h3>
          {hint && <span className="section-hint">{hint}</span>}
        </span>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
