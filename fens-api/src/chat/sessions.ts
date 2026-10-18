import { randomBytes } from 'node:crypto';
import { memoryGraph } from '../graph/db.js';
import {
  getPreferences,
  recall,
  recallEpisodes,
  rememberFact,
  writeEpisode,
  type Fact,
} from '../memory/memory.js';
import { parsePreference } from '../memory/suppress.js';
import type { Ctx } from '../tenancy/context.js';
export const IDLE_MS = 30 * 60000;
export interface Message {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  tool_calls: {
    tool: string;
    args: Record<string, unknown>;
  }[];
}
export interface Session {
  id: string;
  user: string;
  started_at: string;
  last_at: string;
  status: 'open' | 'closed';
  closed_at?: string | null;
  summary?: string | null;
}
export interface Remembered {
  summary: string | null;
  summary_at: string | null;
  preferences: Fact[];
  facts: Fact[];
}
const nowIso = () => new Date().toISOString();
const sid = () => `s-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const toSession = (p: Record<string, unknown>): Session => ({
  id: String(p.id),
  user: String(p.user),
  started_at: String(p.started_at),
  last_at: String(p.last_at),
  status: p.status === 'closed' ? 'closed' : 'open',
  closed_at: (p.closed_at as string) ?? null,
  summary: (p.summary as string) ?? null,
});
export async function whatIRemember(ctx: Ctx): Promise<Remembered> {
  const [last] = await recallEpisodes(ctx, { type: 'chat', scope: 'user', limit: 1 });
  const preferences = await getPreferences(ctx);
  const facts = (await recall(ctx, { limit: 40 }))
    .filter((f) => f.kind === 'fact')
    .sort((a, b) => b.confidence - a.confidence || b.valid_from.localeCompare(a.valid_from))
    .slice(0, 6);
  return { summary: last?.summary ?? null, summary_at: last?.at ?? null, preferences, facts };
}
export async function listSessions(ctx: Ctx): Promise<Session[]> {
  const m = await memoryGraph(ctx, 'user');
  const rows = await m.read<{
    s: Record<string, unknown>;
  }>('MATCH (s:Session) RETURN properties(s) AS s ORDER BY s.last_at DESC LIMIT 50');
  return rows.map((r) => toSession(r.s));
}
export async function getSession(
  ctx: Ctx,
  id: string,
): Promise<{
  session: Session;
  messages: Message[];
} | null> {
  const m = await memoryGraph(ctx, 'user');
  const rows = await m.read<{
    s: Record<string, unknown>;
    msgs: Record<string, unknown>[];
  }>(
    `MATCH (s:Session {id: $id})
     OPTIONAL MATCH (s)-[:HAS]->(m:Message)
     WITH s, m ORDER BY m.seq
     RETURN properties(s) AS s, collect(properties(m)) AS msgs`,
    { id },
  );
  const r = rows[0];
  if (!r) return null;
  return {
    session: toSession(r.s),
    messages: r.msgs
      .filter((x) => x && x.id)
      .map((x) => ({
        id: String(x.id),
        seq: Number(x.seq),
        role: x.role === 'assistant' ? 'assistant' : 'user',
        text: String(x.text),
        at: String(x.at),
        tool_calls: JSON.parse(String(x.tool_calls ?? '[]')) as Message['tool_calls'],
      })),
  };
}
export async function closeIdle(ctx: Ctx, now = Date.now()): Promise<string[]> {
  const m = await memoryGraph(ctx, 'user');
  const idle = await m.read<{
    id: string;
  }>("MATCH (s:Session {status: 'open'}) WHERE s.last_at < $cutoff RETURN s.id AS id", {
    cutoff: new Date(now - IDLE_MS).toISOString(),
  });
  for (const s of idle) await closeSession(ctx, s.id, 'idle');
  return idle.map((s) => s.id);
}
export async function startSession(ctx: Ctx): Promise<{
  session: Session;
  remembered: Remembered;
  closed_idle: string[];
}> {
  const closed = await closeIdle(ctx);
  const m = await memoryGraph(ctx, 'user');
  const now = nowIso();
  const session: Session = {
    id: sid(),
    user: ctx.user.id,
    started_at: now,
    last_at: now,
    status: 'open',
  };
  await m.write('CREATE (s:Session) SET s = $s, s.seq = 0', { s: session });
  return { session, remembered: await whatIRemember(ctx), closed_idle: closed };
}
export async function addMessage(
  ctx: Ctx,
  sessionId: string,
  role: Message['role'],
  text: string,
  toolCalls: Message['tool_calls'] = [],
): Promise<Message> {
  const m = await memoryGraph(ctx, 'user');
  const msg = {
    id: `m-${randomBytes(5).toString('hex')}`,
    role,
    text: text.slice(0, 8000),
    at: nowIso(),
    tool_calls: JSON.stringify(toolCalls),
  };
  const rows = await m.write<{
    seq: number;
  }>(
    `MATCH (s:Session {id: $sid}) WHERE s.status = 'open'
     SET s.seq = s.seq + 1, s.last_at = $at
     CREATE (s)-[:HAS]->(m:Message)
     SET m = $m, m.seq = s.seq
     RETURN m.seq AS seq`,
    { sid: sessionId, at: msg.at, m: msg },
  );
  if (!rows[0]) throw new Error('The session does not exist or is closed.');
  return { ...msg, seq: rows[0].seq, tool_calls: toolCalls };
}
export async function closeSession(
  ctx: Ctx,
  sessionId: string,
  reason: 'closed' | 'idle' = 'closed',
): Promise<{
  session: Session;
  episode: string | null;
  preferences: string[];
} | null> {
  const found = await getSession(ctx, sessionId);
  if (!found) return null;
  if (found.session.status === 'closed')
    return { session: found.session, episode: null, preferences: [] };
  const userMsgs = found.messages.filter((x) => x.role === 'user');
  const stated = userMsgs
    .map((x) => parsePreference(x.text))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const topics = userMsgs.map((x) => x.text.replace(/\s+/g, ' ').slice(0, 80));
  const summary =
    userMsgs.length === 0
      ? `Empty session (${reason}).`
      : `${userMsgs.length} question(s) (${reason}): ${topics.slice(0, 6).join(' | ')}${topics.length > 6 ? ' | ...' : ''}.${stated.length ? ` Stated preferences: ${stated.map((p) => `${p.subject} ${p.predicate} ${p.object}`).join('; ')}.` : ''}`;
  const episode = await writeEpisode(
    ctx,
    { type: 'chat', agent: 'ask-flowlens', summary, ref_key: sessionId },
    'user',
  );
  const prefs: string[] = [];
  for (const p of stated)
    prefs.push(
      (
        await rememberFact(ctx, {
          ...p,
          kind: 'preference',
          confidence: 1,
          source_episode: episode.id,
        })
      ).fact.id,
    );
  const m = await memoryGraph(ctx, 'user');
  await m.write(
    "MATCH (s:Session {id: $id}) SET s.status = 'closed', s.closed_at = $now, s.summary = $summary, s.close_reason = $reason",
    { id: sessionId, now: nowIso(), summary, reason },
  );
  return {
    session: { ...found.session, status: 'closed', summary },
    episode: episode.id,
    preferences: prefs,
  };
}
