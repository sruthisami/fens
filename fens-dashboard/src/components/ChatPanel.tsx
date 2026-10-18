import { useEffect, useRef, useState } from 'react';
import { ApiError, chatApi, type ChatMessage, type ChatSession, type Remembered } from '../api';
interface Props {
  graph: string;
}
const SUGGESTIONS = [
  'What is open?',
  'What changed since the last release?',
  'Why was the size guide table decided like that?',
  'Who should fix the sign in contrast finding?',
  'What did we decide last time about the FAQ?',
  'Do not flag heading-order',
];
export function ChatPanel({ graph }: Props) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [remembered, setRemembered] = useState<Remembered | null>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'rules' | 'llm'>('rules');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const fail = (err: unknown, what: string) =>
    setNote(err instanceof ApiError ? err.message : `Could not ${what}`);
  useEffect(() => {
    chatApi.sessions().then(
      async (r) => {
        setRemembered(r.remembered);
        const open = r.sessions.find((s) => s.status === 'open');
        if (open) {
          const full = await chatApi.session(open.id);
          setSession(full.session);
          setMessages(full.messages);
        }
      },
      (err: unknown) => fail(err, 'load your sessions'),
    );
  }, []);
  const start = async () => {
    setNote(null);
    try {
      const r = await chatApi.start();
      setSession(r.session);
      setRemembered(r.remembered);
      setMessages([]);
      input.current?.focus();
    } catch (err) {
      fail(err, 'start a session');
    }
  };
  const send = async (q: string) => {
    if (!session || !q.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await chatApi.send(session.id, q.trim(), graph, mode);
      setMessages((m) => [...m, r.question, r.reply]);
      setText('');
      if (r.note) setNote(r.note);
    } catch (err) {
      fail(err, 'send the question');
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (!session) return;
    try {
      const r = await chatApi.close(session.id);
      setNote(
        `Session closed. Summary saved${r.preferences.length ? ` with ${r.preferences.length} preference(s)` : ''}.`,
      );
      setSession(null);
      setMessages([]);
      setRemembered((await chatApi.sessions()).remembered);
    } catch (err) {
      fail(err, 'close the session');
    }
  };
  return (
    <div className="tools">
      <section className="tool" aria-labelledby="ask-title">
        <h3 id="ask-title">Ask FlowLens</h3>
        <p className="muted">
          Answers come from the graph tools and memory of {graph}. Sessions are kept in your memory
          and survive a restart.
        </p>
        {remembered && (
          <div className="preview" aria-label="What I remember">
            <h4>What I remember</h4>
            <p>
              {remembered.summary ? `Last time: ${remembered.summary}` : 'No earlier conversation.'}
            </p>
            <p>
              {remembered.preferences.length
                ? `Your preferences: ${remembered.preferences.map((p) => `${p.subject} ${p.predicate} ${p.object} (${p.id})`).join('; ')}.`
                : 'No preferences yet.'}
            </p>
            {remembered.facts.length > 0 && (
              <ul className="edge-list">
                {remembered.facts.map((f) => (
                  <li key={f.id}>
                    {f.subject} {f.predicate}: {f.object}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!session ? (
          <button type="button" onClick={() => void start()}>
            New session
          </button>
        ) : (
          <>
            <ol className="chat" aria-label="Conversation" aria-live="polite">
              {messages.map((m) => (
                <li key={m.id} className={`chat-${m.role}`}>
                  <span className="chat-role">{m.role === 'user' ? 'You' : 'FlowLens'}:</span>{' '}
                  <span className="chat-text">{m.text}</span>
                  {m.tool_calls.length > 0 && (
                    <span className="muted">
                      {' '}
                      (tools: {m.tool_calls.map((t) => t.tool).join(', ')})
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <label htmlFor="ask-input">Your question</label>
              <input
                id="ask-input"
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
                placeholder="What is open?"
              />
              <label htmlFor="ask-mode">Answer with</label>
              <select
                id="ask-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'rules' | 'llm')}
              >
                <option value="rules">Templates (no AI)</option>
                <option value="llm">Gemini (templates as fallback)</option>
              </select>
              <div className="button-row">
                <button type="submit" disabled={busy || !text.trim()}>
                  {busy ? 'Answering…' : 'Ask'}
                </button>
                <button type="button" onClick={() => void close()}>
                  Close session
                </button>
              </div>
            </form>
            <p className="muted">Try:</p>
            <div className="button-row">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="link-button"
                  onClick={() => void send(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {note && <p role="status">{note}</p>}
      </section>
    </div>
  );
}
