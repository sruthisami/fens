import { GoogleGenAI } from '@google/genai';
import { listFindings } from '../agent/findings.js';
import { env } from '../config/env.js';
import { listDecisions } from '../decider/decide.js';
import { openGraph } from '../graph/db.js';
import { suggestAssignee, suggestTarget } from '../history/suggest.js';
import { getPreferences, recall, recallEpisodes } from '../memory/memory.js';
import { parsePreference, suppressedBy } from '../memory/suppress.js';
import type { Ctx } from '../tenancy/context.js';
import { findTool, runTool } from '../tools/index.js';
import type { Message } from './sessions.js';
export type ChatMode = 'rules' | 'llm';
export interface Answer {
  text: string;
  intent: string;
  tool_calls: Message['tool_calls'];
  mode: ChatMode;
  note?: string;
}
const STOP = new Set(
  'the a an is are was were what why who how did do does we you i me my our of on in to for and or about last time since release finding findings decision decisions decided open changed change suggested suggest assign assigned there any this that with from it its be been has have which show tell please new'.split(
    ' ',
  ),
);
const words = (s: string) =>
  (s.toLowerCase().match(/[a-z0-9/_-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const score = (q: string[], text: string) => {
  const t = text.toLowerCase();
  return q.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
};
export function intentOf(text: string): string {
  const t = text.toLowerCase();
  if (parsePreference(text)) return 'preference';
  if (/what do you remember|what you remember|remember about me/.test(t)) return 'remember';
  if (/\bwho\b.*\b(suggest|assign|fix|own|should)/.test(t)) return 'assignee';
  if (/last time|decided before|previously|what did we decide/.test(t)) return 'last_time';
  if (/\bwhy\b/.test(t)) return 'why_decision';
  if (/changed|since the last|since last|compare|regress|improv/.test(t)) return 'changed';
  if (/\bopen\b|outstanding|to do|todo|what.*(issues|findings|problems)/.test(t)) return 'open';
  return 'help';
}
function previousRelease(ctx: Ctx, graph: string): string | null {
  const i = ctx.tenant.graphs.indexOf(graph);
  return i > 0 ? (ctx.tenant.graphs[i - 1] ?? null) : null;
}
export async function rulesAnswer(
  ctx: Ctx,
  graph: string,
  text: string,
): Promise<
  Answer & {
    context: unknown;
  }
> {
  const intent = intentOf(text);
  const calls: Message['tool_calls'] = [];
  const tool = async <T>(name: string, args: Record<string, unknown> = {}) => {
    calls.push({ tool: name, args });
    const def = findTool(name);
    if (!def) throw new Error(`No tool ${name}`);
    return (await runTool(def, graph, args)).result as T;
  };
  const q = words(text);
  const done = (t: string, context: unknown = null) => ({
    text: t,
    intent,
    tool_calls: calls,
    mode: 'rules' as const,
    context,
  });
  if (intent === 'preference') {
    const p = parsePreference(text)!;
    return done(
      `Noted: ${p.subject} ${p.predicate} = ${p.object}. I will remember it as your preference when this session closes; from then on matching findings are shown as suppressed by that preference (never dropped).`,
      p,
    );
  }
  if (intent === 'remember') {
    calls.push({ tool: 'get_preferences', args: {} }, { tool: 'recall', args: { limit: 10 } });
    const prefs = await getPreferences(ctx);
    const facts = (await recall(ctx, { limit: 10 })).filter((f) => f.kind === 'fact');
    const [last] = await recallEpisodes(ctx, { type: 'chat', scope: 'user', limit: 1 });
    return done(
      [
        last
          ? `Last conversation (${last.at.slice(0, 16).replace('T', ' ')}): ${last.summary}`
          : 'No earlier conversation.',
        prefs.length
          ? `Your preferences: ${prefs.map((p) => `${p.subject} ${p.predicate} ${p.object} (${p.id})`).join('; ')}.`
          : 'No preferences yet.',
        facts.length
          ? `Team facts: ${facts
              .slice(0, 6)
              .map((f) => `${f.subject} ${f.predicate}: ${f.object}`)
              .join('; ')}.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      { prefs, facts, last },
    );
  }
  const g = await openGraph(graph);
  if (intent === 'open') {
    calls.push({ tool: 'list_findings', args: {} });
    const prefs = await getPreferences(ctx);
    const all = (await listFindings(g)).filter((f) => !f.stale);
    const shown = all.filter((f) => !suppressedBy(f, prefs));
    const hidden = all.filter((f) => suppressedBy(f, prefs));
    const by = (s: string) => shown.filter((f) => f.severity === s);
    const lines = ['high', 'medium', 'low']
      .filter((s) => by(s).length)
      .map(
        (s) =>
          `${s[0]?.toUpperCase()}${s.slice(1)}: ${by(s)
            .map((f) => f.title)
            .join('; ')}`,
      );
    return done(
      `${shown.length} open finding(s) on ${graph}.\n${lines.join('\n')}${hidden.length ? `\nSuppressed by your preferences: ${hidden.map((f) => `${f.title} (${suppressedBy(f, prefs)?.id})`).join('; ')}.` : ''}`,
      { shown, hidden },
    );
  }
  if (intent === 'changed') {
    const prev = previousRelease(ctx, graph);
    if (!prev)
      return done(
        `${graph} is the first release of ${ctx.tenant.name}; there is no earlier one to compare with.`,
      );
    const d = await tool<{
      health: {
        from: {
          score: number;
        };
        to: {
          score: number;
        };
        delta: number;
      };
      issues: {
        fixed: {
          help: string;
        }[];
        new: {
          help: string;
        }[];
      };
      findings: {
        resolved: {
          title: string;
        }[];
        new: {
          title: string;
        }[];
        persisting: {
          title: string;
        }[];
      };
    }>('diff_releases', { from_graph: prev });
    return done(
      [
        `${prev} to ${graph}: health ${d.health.from.score} to ${d.health.to.score} (${d.health.delta >= 0 ? '+' : ''}${d.health.delta}).`,
        d.findings.resolved.length
          ? `Resolved: ${d.findings.resolved.map((f) => f.title).join('; ')}.`
          : 'Nothing resolved.',
        d.findings.new.length
          ? `New: ${d.findings.new.map((f) => f.title).join('; ')}.`
          : 'Nothing new.',
        `${d.findings.persisting.length} finding(s) persist; ${d.issues.fixed.length} issue(s) fixed, ${d.issues.new.length} new.`,
      ].join('\n'),
      d,
    );
  }
  if (intent === 'why_decision') {
    calls.push({ tool: 'list_decisions', args: {} });
    const decisions = await listDecisions(g);
    if (!decisions.length) return done(`No decisions on ${graph} yet. Run arbitration first.`);
    const best = [...decisions].sort(
      (a, b) =>
        score(q, `${b.proposal_key} ${b.proposal_title}`) -
        score(q, `${a.proposal_key} ${a.proposal_title}`),
    )[0]!;
    if (score(q, `${best.proposal_key} ${best.proposal_title}`) === 0)
      return done(
        `Which decision? On ${graph}: ${decisions.map((d) => `${d.proposal_title} (${d.outcome})`).join('; ')}.`,
        decisions,
      );
    return done(
      [
        `${best.proposal_title}: ${best.outcome}${best.playbook ? ` with the playbook "${best.playbook.name}"` : ''}.`,
        `Simulated: UX ${best.ux_before} to ${best.ux_after}, SEO ${best.seo_before} to ${best.seo_after}.`,
        best.precedent
          ? `It followed a precedent (${best.precedent_id}).`
          : 'No precedent was used.',
        best.rationale,
      ].join('\n'),
      best,
    );
  }
  if (intent === 'assignee') {
    calls.push({ tool: 'list_findings', args: {} });
    const findings = (await listFindings(g)).filter((f) => !f.stale);
    const f = [...findings].sort(
      (a, b) => score(q, `${b.title} ${b.key}`) - score(q, `${a.title} ${a.key}`),
    )[0];
    if (!f || score(q, `${f.title} ${f.key}`) === 0)
      return done(`Which finding? Open on ${graph}: ${findings.map((x) => x.title).join('; ')}.`);
    calls.push({ tool: 'suggest_assignee', args: { finding_id: f.id } });
    const s = await suggestAssignee(await suggestTarget(g, { finding_id: f.id }));
    if (!s.ranking.length)
      return done(`No suggestion for "${f.title}": ${s.note ?? 'no similar resolved issues'}.`, s);
    return done(
      `For "${f.title}": ${s.ranking
        .slice(0, 3)
        .map(
          (r) =>
            `${r.person}${r.team ? ` (${r.team})` : ''}, score ${r.score.toFixed(2)}, ${r.similar} similar resolved issue(s)`,
        )
        .join('; ')}. This is a suggestion only; nobody is assigned.`,
      s,
    );
  }
  if (intent === 'last_time') {
    calls.push(
      { tool: 'recall_episodes', args: { type: 'decision' } },
      { tool: 'recall', args: { keyword: q[0] ?? '' } },
    );
    const eps = (await recallEpisodes(ctx, { type: 'decision', limit: 200 })).filter(
      (e) => score(q, `${e.summary} ${e.ref_key}`) > 0,
    );
    const facts = q.length ? (await recall(ctx, { keyword: q[0] })).slice(0, 5) : [];
    if (!eps.length && !facts.length)
      return done(`I have no memory of a decision about ${q.join(' ') || 'that'}.`);
    return done(
      [
        ...eps.slice(0, 4).map((e) => `${e.at.slice(0, 10)}: ${e.summary}`),
        ...(facts.length
          ? [`Facts: ${facts.map((f) => `${f.subject} ${f.predicate}: ${f.object}`).join('; ')}.`]
          : []),
      ].join('\n'),
      { eps, facts },
    );
  }
  return done(
    'I can answer: what is open; what changed since the last release; why a decision was made (name it, e.g. "why was the size guide table decided"); who is suggested for a finding; what we decided last time about something; what I remember. You can also say "do not flag heading-order".',
  );
}
export async function answer(
  ctx: Ctx,
  graph: string,
  text: string,
  mode: ChatMode,
): Promise<Answer> {
  const base = await rulesAnswer(ctx, graph, text);
  const { context, ...rules } = base;
  if (mode === 'rules' || base.intent === 'preference') return rules;
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL)
    return {
      ...rules,
      mode: 'rules',
      note: 'GEMINI_API_KEY or GEMINI_MODEL is not set; rules answer.',
    };
  const prefs = await getPreferences(ctx).catch(() => []);
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  for (const model of [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean) as string[]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Question about ${graph}: ${text}\n\nTool results (JSON): ${JSON.stringify(context ?? null).slice(0, 12000)}\n\nTemplate answer: ${rules.text}\n\nUser preferences: ${prefs.map((p) => `${p.id} ${p.subject} ${p.predicate} ${p.object}`).join('; ') || 'none'}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            'You are Ask FlowLens. Answer the question in plain words using only the tool results and the template answer given. Do not invent numbers, people or decisions. Respect the preferences and mention when a finding is suppressed by one. Keep it short.',
          abortSignal: AbortSignal.timeout(20000),
        },
      });
      const out = res.text?.trim();
      if (out) return { ...rules, text: out.slice(0, 4000), mode: 'llm' };
    } catch (err) {
      return {
        ...rules,
        mode: 'rules',
        note: `Gemini (${model}) failed: ${(err as Error).message.slice(0, 120)}; rules answer.`,
      };
    }
  }
  return { ...rules, mode: 'rules', note: 'Gemini returned nothing; rules answer.' };
}
