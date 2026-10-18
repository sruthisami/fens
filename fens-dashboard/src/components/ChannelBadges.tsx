import { CHANNELS, type Channel, type ChannelRecord } from '../api';

export type ChannelState = 'none' | 'open' | 'closed';
export interface ChannelView {
  channel: Channel;
  name: string;
  ref: string | null;
  state: ChannelState;
  stateText: string;
  url: string | null;
  created: string | null;
  closed: string | null;
}

const NAME: Record<Channel, string> = { github: 'GitHub', linear: 'Linear', figma: 'Figma' };

export function channelView(rec: ChannelRecord | undefined, c: Channel): ChannelView {
  const base = { channel: c, name: NAME[c] };
  const none: ChannelView = {
    ...base,
    ref: null,
    state: 'none',
    stateText: 'not sent',
    url: null,
    created: null,
    closed: null,
  };
  if (!rec) return none;
  if (c === 'github' && rec.github) {
    const closed = !!rec.github.closed_at;
    return {
      ...base,
      ref: rec.github.number ? `#${rec.github.number}` : 'issue',
      state: closed ? 'closed' : 'open',
      stateText: closed ? 'closed' : 'open',
      url: rec.github.url,
      created: rec.github.created_at,
      closed: rec.github.closed_at,
    };
  }
  if (c === 'linear' && rec.linear) {
    const closed = !!rec.linear.closed_at;
    return {
      ...base,
      ref: rec.linear.identifier ?? 'issue',
      state: closed ? 'closed' : 'open',
      stateText: closed ? 'done' : 'open',
      url: rec.linear.url,
      created: rec.linear.created_at,
      closed: rec.linear.closed_at,
    };
  }
  if (c === 'figma' && rec.figma) {
    const closed = !!rec.figma.closed_at;
    return {
      ...base,
      ref: 'comment',
      state: closed ? 'closed' : 'open',
      stateText: closed ? 'resolved reply posted' : 'posted',
      url: rec.figma.url,
      created: rec.figma.created_at,
      closed: rec.figma.closed_at,
    };
  }
  return none;
}

export const channelViews = (rec: ChannelRecord | undefined) =>
  CHANNELS.map((c) => channelView(rec, c));

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

const MARK: Record<ChannelState, string> = { none: '○', open: '●', closed: '✓' };

export function chipText(v: ChannelView) {
  return `${v.name}${v.ref ? ` ${v.ref}` : ''} · ${v.stateText}`;
}

export function ChannelChips({
  record,
  links = true,
}: {
  record: ChannelRecord | undefined;
  links?: boolean;
}) {
  return (
    <span className="chips" role="list" aria-label="Tracking">
      {channelViews(record).map((v) => (
        <span key={v.channel} role="listitem" className={`chip chip-${v.state}`}>
          <span aria-hidden="true">{MARK[v.state]} </span>
          {links && v.url ? (
            <a href={v.url} target="_blank" rel="noopener noreferrer">
              {chipText(v)}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : (
            chipText(v)
          )}
        </span>
      ))}
    </span>
  );
}

export function ChannelTable({ record }: { record: ChannelRecord | undefined }) {
  return (
    <table className="compare-table channel-table">
      <caption className="visually-hidden">Where this finding is tracked</caption>
      <thead>
        <tr>
          <th scope="col">Channel</th>
          <th scope="col">Status</th>
          <th scope="col">Sent</th>
          <th scope="col">Closed</th>
        </tr>
      </thead>
      <tbody>
        {channelViews(record).map((v) => (
          <tr key={v.channel}>
            <th scope="row">{v.name}</th>
            <td>
              <span className={`chip chip-${v.state}`}>
                <span aria-hidden="true">{MARK[v.state]} </span>
                {v.url ? (
                  <a href={v.url} target="_blank" rel="noopener noreferrer">
                    {v.ref ? `${v.ref} · ` : ''}
                    {v.stateText}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                ) : (
                  v.stateText
                )}
              </span>
            </td>
            <td>{shortDate(v.created) ?? '—'}</td>
            <td>{shortDate(v.closed) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
