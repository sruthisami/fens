export interface ChannelRecord {
  github: {
    url: string;
    number: number | null;
    created_at: string | null;
    closed_at: string | null;
  } | null;
  linear: {
    url: string;
    identifier: string | null;
    created_at: string | null;
    closed_at: string | null;
  } | null;
  figma: {
    id: string | null;
    url: string;
    created_at: string | null;
    closed_at: string | null;
  } | null;
  closed_in: string | null;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
export function githubNumber(url: string): number | null {
  const m = /\/issues\/(\d+)$/.exec(url);
  return m ? Number(m[1]) : null;
}
export function linearIdentifier(url: string): string | null {
  return /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z0-9]+-\d+)(?:\/|$)/.exec(url)?.[1] ?? null;
}
export function recordOf(p: Record<string, unknown>): ChannelRecord {
  const gh = str(p.github_issue_url);
  const ln = str(p.linear_issue_url);
  const fg = str(p.figma_comment_url);
  const ghNumber = typeof p.github_issue_number === 'number' ? p.github_issue_number : null;
  return {
    github: gh
      ? {
          url: gh,
          number: ghNumber ?? githubNumber(gh),
          created_at: str(p.github_created_at),
          closed_at: str(p.github_closed_at) ?? str(p.closed_at),
        }
      : null,
    linear: ln
      ? {
          url: ln,
          identifier: str(p.linear_issue_identifier) ?? linearIdentifier(ln),
          created_at: str(p.linear_created_at),
          closed_at: str(p.linear_closed_at),
        }
      : null,
    figma: fg
      ? {
          id: str(p.figma_comment_id),
          url: fg,
          created_at: str(p.figma_created_at),
          closed_at: str(p.figma_closed_at),
        }
      : null,
    closed_in: str(p.closed_in) ?? str(p.linear_closed_in),
  };
}
export function channelStatus(rec: ChannelRecord): {
  github: string;
  linear: string;
  figma: string;
} {
  return {
    github: rec.github
      ? `GitHub${rec.github.number ? ` #${rec.github.number}` : ' issue'} ${rec.github.closed_at ? 'closed' : 'open'}`
      : 'GitHub: not sent',
    linear: rec.linear
      ? `Linear ${rec.linear.identifier ?? 'issue'} ${rec.linear.closed_at ? 'done' : 'open'}`
      : 'Linear: not sent',
    figma: rec.figma
      ? rec.figma.closed_at
        ? 'Figma comment posted, resolved reply posted'
        : 'Figma comment posted'
      : 'Figma: not sent',
  };
}
