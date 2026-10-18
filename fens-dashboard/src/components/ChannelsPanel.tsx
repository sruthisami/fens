import { useEffect, useState } from 'react';
import {
  CHANNEL_LABEL,
  CHANNELS,
  channelsApi,
  type Channel,
  type ChannelCheck,
  type ChannelResults,
  type ChannelRecord,
  type ChannelsPreview,
} from '../api';
import { ChannelTable } from './ChannelBadges';
interface Props {
  graph: string;
  findingId: string;
  record: ChannelRecord | undefined;
  assignee: string | null;
  onChanged: () => void;
}
const errorText = (err: unknown, what: string) =>
  err instanceof Error ? err.message : `Could not ${what}`;
function resultLines(results: ChannelResults, prefix = ''): string[] {
  return CHANNELS.filter((c) => results[c]).map((c) => {
    const r = results[c]!;
    return `${prefix}${CHANNEL_LABEL[c]}: ${r.status}${r.message ? ` (${r.message})` : ''}`;
  });
}
function checkLine(c: Channel, x: ChannelCheck): string {
  if (!x.linked) return `${CHANNEL_LABEL[c]}: not sent`;
  if (!x.checked) return `${CHANNEL_LABEL[c]}: not checked (${x.message ?? 'unavailable'})`;
  if (!x.exists) return `${CHANNEL_LABEL[c]}: missing (deleted or not visible)`;
  return `${CHANNEL_LABEL[c]}: exists, ${x.state ?? 'unknown state'}, links ${x.links_current ? 'current' : 'out of date'}`;
}
export function ChannelsPanel({ graph, findingId, record, assignee, onChanged }: Props) {
  const [preview, setPreview] = useState<ChannelsPreview | null>(null);
  const [showPayloads, setShowPayloads] = useState(false);
  const [selected, setSelected] = useState<Set<Channel>>(new Set());
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () =>
    channelsApi.preview(graph, findingId).then(
      (p) => {
        setPreview(p);
        setSelected(new Set(CHANNELS.filter((c) => p[c].available && !p[c].sent)));
      },
      (err) => setLines([errorText(err, 'load the channels')]),
    );
  useEffect(() => {
    setLines([]);
    void load();
  }, [graph, findingId]);
  const run = async (what: string, action: () => Promise<string[]>) => {
    setBusy(true);
    setLines([]);
    try {
      setLines(await action());
    } catch (err) {
      setLines([errorText(err, what)]);
    } finally {
      setBusy(false);
      await load();
      onChanged();
    }
  };
  const send = () => {
    const list = CHANNELS.filter((c) => selected.has(c));
    if (list.length === 0) return;
    const who =
      assignee && selected.has('github') ? ` The GitHub issue is assigned to @${assignee}.` : '';
    if (
      !window.confirm(
        `Send this finding to: ${list.map((c) => CHANNEL_LABEL[c]).join(', ')}? They are created in that order and link each other.${who}`,
      )
    )
      return;
    void run('send', async () => {
      const r = await channelsApi.send(graph, findingId, list, assignee ?? undefined);
      return [...resultLines(r.results), ...resultLines(r.sync, 'Links, ')];
    });
  };
  const sync = () => {
    if (
      !window.confirm(
        'Rewrite the FlowLens links block in the GitHub and Linear issues where it is out of date? Figma comments cannot be edited, so Figma gets a reply instead.',
      )
    )
      return;
    void run('sync the links', async () =>
      resultLines((await channelsApi.sync(graph, findingId)).results, 'Links, '),
    );
  };
  const check = () =>
    void run('check the channels', async () => {
      const r = await channelsApi.verify(graph, findingId);
      return CHANNELS.map((c) => checkLine(c, r.channels[c]));
    });
  const anySent = !!preview && CHANNELS.some((c) => preview[c].sent);
  return (
    <section className="channels" aria-label="Channels">
      <h4>Tracking</h4>
      <ChannelTable record={record} />
      <p className="muted">
        Status as stored by FlowLens. <em>Check live status</em> asks GitHub, Linear and Figma
        directly.
      </p>
      {preview && (
        <fieldset className="stack">
          <legend>Send to</legend>
          {CHANNELS.map((c) => {
            const item = preview[c];
            const disabled = !item.available || !!item.sent;
            return (
              <label key={c} className="check">
                <input
                  type="checkbox"
                  checked={selected.has(c) && !disabled}
                  disabled={disabled || busy}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(c);
                      else next.delete(c);
                      return next;
                    })
                  }
                />{' '}
                {CHANNEL_LABEL[c]}
                {item.sent
                  ? ' (already sent)'
                  : item.reason
                    ? ` (not available: ${item.reason})`
                    : ''}
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="button-row">
        <button type="button" onClick={() => setShowPayloads((v) => !v)} disabled={!preview}>
          {showPayloads ? 'Hide preview' : 'Preview'}
        </button>
        <button type="button" onClick={send} disabled={busy || selected.size === 0}>
          Send to selected
        </button>
        <button type="button" onClick={check} disabled={busy || !anySent}>
          Check live status
        </button>
        <button type="button" onClick={sync} disabled={busy || !anySent}>
          Update cross-links
        </button>
      </div>
      {showPayloads && preview && (
        <div className="preview">
          <p className="muted">{preview.note}</p>
          {CHANNELS.map((c) => (
            <details key={c} open={selected.has(c)}>
              <summary>
                {CHANNEL_LABEL[c]}
                {preview[c].draft ? '' : ' (no preview)'}
              </summary>
              {preview[c].reason && <p className="muted">{preview[c].reason}</p>}
              {preview[c].draft && (
                <pre className="html-sample">
                  <code>{JSON.stringify(preview[c].draft, null, 2)}</code>
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
      {lines.length > 0 && (
        <ul className="edge-list" role="status">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
