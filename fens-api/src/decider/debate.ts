import { GoogleGenAI } from '@google/genai';
import { listProposals, type StoredProposal } from '../agent/proposals.js';
import { env } from '../config/env.js';
import type { ReadOnlyGraph } from '../graph/db.js';
import { notFound } from '../http/errors.js';
import type { DecisionRecord, SimSummary } from './decide.js';
import { CHANGE_PATTERN, PLAYBOOKS } from './playbooks.js';

export type Lens = 'ux' | 'seo';
export interface GuidelineRef {
  id: string;
  name: string;
}
export interface Conflict {
  seo: GuidelineRef;
  ux: GuidelineRef;
  reason: string;
}
export interface Argument {
  agent: Lens;
  stance: 'for' | 'against' | 'no objection';
  headline: string;
  points: string[];
  text: string | null;
}
export interface Debate {
  decision_id: string;
  proposal_id: string;
  title: string;
  change_type: string;
  outcome: DecisionRecord['outcome'];
  contested: boolean;
  conflict: Conflict | null;
  for: Argument;
  against: Argument;
  compromise: {
    playbook: { id: string; name: string; description: string };
    points: string[];
  } | null;
  tried_playbooks: string[];
  mode: 'rules' | 'llm';
  note: string | null;
}
export interface DebateFacts {
  decision: DecisionRecord;
  proposal: Pick<StoredProposal, 'id' | 'agent' | 'title' | 'rationale' | 'change'>;
  issues: { key: string; help: string }[];
  conflict: Conflict | null;
}

const LENS: Record<Lens, string> = { ux: 'UX', seo: 'SEO' };
const AGENT: Record<Lens, string> = { ux: 'UX agent', seo: 'SEO agent' };

export function isContested(d: Pick<DecisionRecord, 'simulations' | 'outcome'>): boolean {
  const first = d.simulations[0];
  if (!first) return d.outcome === 'needs_human' || d.outcome === 'reconciled';
  return first.ux === 'worsens' || first.seo === 'worsens';
}

const partLine = (p: SimSummary['parts'][number]) =>
  `${p.label.includes(LENS[p.lens]) ? '' : `${LENS[p.lens]} `}${p.label}: penalty ${p.before} → ${p.after} points`;
const scoreLine = (s: SimSummary, lens: Lens) =>
  `${LENS[lens]} score ${s[`${lens}_before`]} → ${s[`${lens}_after`]} (${s[lens]})`;
const guidelineText = (g: GuidelineRef) =>
  g.name && g.name !== g.id ? `${g.id} (${g.name})` : g.id;

export function buildDebate(f: DebateFacts): Debate {
  const d = f.decision;
  const first = d.simulations[0] ?? null;
  const pro: Lens = f.proposal.agent === 'seo' ? 'seo' : 'ux';
  const con: Lens = pro === 'ux' ? 'seo' : 'ux';
  const parts = (first?.parts ?? []).filter((p) => p.delta !== 0);
  const contested = isContested(d);

  const forPoints = [
    f.proposal.rationale,
    ...(f.issues.length
      ? [
          `Fixes ${f.issues.length} open issue${f.issues.length === 1 ? '' : 's'}: ${f.issues
            .map((i) => i.help)
            .join('; ')}.`,
        ]
      : []),
    ...(first ? [`Simulated: ${scoreLine(first, pro)}.`] : []),
    ...parts.filter((p) => p.delta > 0).map((p) => `Better: ${partLine(p)}.`),
    ...(f.conflict ? [`Serves ${LENS[pro]} guideline ${guidelineText(f.conflict[pro])}.`] : []),
  ];

  const deeper = (first?.link_depth ?? []).filter(
    (x) => x.before !== null && (x.after === null || x.after > x.before),
  );
  const againstPoints = contested
    ? [
        ...(first ? [`Simulated: ${scoreLine(first, con)}.`] : []),
        ...parts
          .filter((p) => p.delta < 0)
          .map((p) =>
            p.lens === con
              ? `Worse: ${partLine(p)}.`
              : `It also costs ${LENS[pro]} itself: ${partLine(p)}.`,
          ),
        ...(con === 'seo' && deeper.length
          ? [
              `Link depth rises: ${deeper
                .map((x) => `${x.id} ${x.before} → ${x.after ?? 'unreachable by links'}`)
                .join(', ')}.`,
            ]
          : []),
        ...(f.conflict && first?.[con] === 'worsens'
          ? [
              `Breaks ${LENS[con]} guideline ${guidelineText(f.conflict[con])}: ${f.conflict.reason}.`,
            ]
          : []),
      ]
    : [
        ...(first
          ? [`Simulated: ${scoreLine(first, con)}. Nothing in ${LENS[con]} gets worse.`]
          : []),
      ];

  let compromise: Debate['compromise'] = null;
  if (d.playbook) {
    const pb = PLAYBOOKS.find((x) => x.id === d.playbook?.id);
    const sim = d.simulations.find((s) => s.playbook === d.playbook?.id);
    compromise = {
      playbook: {
        id: d.playbook.id,
        name: d.playbook.name,
        description: pb?.description ?? '',
      },
      points: sim
        ? [
            `Simulated: ${scoreLine(sim, 'ux')}, ${scoreLine(sim, 'seo')}.`,
            ...sim.parts
              .filter((p) => p.delta !== 0)
              .map((p) => `${p.delta > 0 ? 'Better' : 'Worse'}: ${partLine(p)}.`),
          ]
        : [],
    };
  }

  return {
    decision_id: d.id,
    proposal_id: f.proposal.id,
    title: f.proposal.title,
    change_type: f.proposal.change.type,
    outcome: d.outcome,
    contested,
    conflict: f.conflict,
    for: {
      agent: pro,
      stance: 'for',
      headline: `The ${AGENT[pro]} proposes it`,
      points: forPoints,
      text: null,
    },
    against: {
      agent: con,
      stance: contested ? 'against' : 'no objection',
      headline: contested ? `The ${AGENT[con]} objects` : `The ${AGENT[con]} has no objection`,
      points: againstPoints,
      text: null,
    },
    compromise,
    tried_playbooks: d.tried_playbooks,
    mode: 'rules',
    note:
      d.outcome === 'needs_human'
        ? d.tried_playbooks.length
          ? `No playbook (${d.tried_playbooks.join(', ')}) keeps both lenses from getting worse, so a person has to weigh it.`
          : 'No playbook matches this conflict, so a person has to weigh it.'
        : null,
  };
}

export async function debateFor(g: ReadOnlyGraph, d: DecisionRecord): Promise<Debate> {
  const proposal = (await listProposals(g)).find((p) => p.id === d.proposal_id);
  if (!proposal) throw notFound('The proposal behind this decision no longer exists');
  const issues = proposal.issue_keys.length
    ? await g.read<{ key: string; help: string }>(
        'MATCH (i:Issue) WHERE i.key IN $keys RETURN i.key AS key, i.help AS help ORDER BY key',
        { keys: proposal.issue_keys },
      )
    : [];
  const [from, to] = CHANGE_PATTERN[proposal.change.type].split(' -> ');
  const row = (
    await g.read<{
      sid: string;
      sname: string | null;
      uid: string;
      uname: string | null;
      reason: string | null;
    }>(
      `MATCH (a:Guideline {id: $from})-[c:CONFLICTS_WITH]->(b:Guideline {id: $to})
       RETURN a.id AS sid, a.name AS sname, b.id AS uid, b.name AS uname, c.reason AS reason`,
      { from, to },
    )
  )[0];
  const conflict = row
    ? {
        seo: { id: row.sid, name: row.sname ?? row.sid },
        ux: { id: row.uid, name: row.uname ?? row.uid },
        reason: (row.reason ?? 'the two guidelines pull against each other').replace(/\.\s*$/, ''),
      }
    : null;
  return buildDebate({ decision: d, proposal, issues, conflict });
}

export function debateFactsText(debate: Debate): string {
  const side = (a: Argument) =>
    [`${a.headline} (${a.stance}):`, ...a.points.map((p) => `- ${p}`)].join('\n');
  return [
    `Proposal: ${debate.title} (${debate.change_type}). Outcome: ${debate.outcome}.`,
    side(debate.for),
    side(debate.against),
    ...(debate.compromise
      ? [
          `Compromise playbook "${debate.compromise.playbook.name}": ${debate.compromise.playbook.description}`,
          ...debate.compromise.points.map((p) => `- ${p}`),
        ]
      : []),
    ...(debate.note ? [debate.note] : []),
  ].join('\n');
}

const NUMBER = /\d+(?:\.\d+)?/g;
export function inventedNumbers(text: string, facts: string): string[] {
  const known = new Set(facts.match(NUMBER) ?? []);
  return [...new Set(text.match(NUMBER) ?? [])].filter((n) => !known.has(n));
}

export function parseArguments(
  raw: string,
  facts: string,
): { for: string | null; against: string | null; dropped: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { for: null, against: null, dropped: ['the answer was not JSON'] };
  }
  const dropped: string[] = [];
  const pick = (key: 'for' | 'against') => {
    const v = (parsed as Record<string, unknown>)?.[key];
    if (typeof v !== 'string' || !v.trim()) {
      dropped.push(`no "${key}" text`);
      return null;
    }
    const bad = inventedNumbers(v, facts);
    if (bad.length) {
      dropped.push(`the "${key}" text cited numbers not in the facts (${bad.join(', ')})`);
      return null;
    }
    return v.trim().slice(0, 1200);
  };
  return { for: pick('for'), against: pick('against'), dropped };
}

export async function writeDebate(debate: Debate): Promise<Debate> {
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL)
    return {
      ...debate,
      note: [
        debate.note,
        'Gemini is not set up (GEMINI_API_KEY, GEMINI_MODEL); showing the arguments built from the data.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  const facts = debateFactsText(debate);
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const problems: string[] = [];
  for (const model of [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean) as string[]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: facts }] }],
        config: {
          systemInstruction: `Two agents review a proposed website change. Write each agent's argument in the first person, 2 to 4 plain sentences, using only the facts given. "for" is the ${AGENT[debate.for.agent]}, "against" is the ${AGENT[debate.against.agent]}${debate.against.stance === 'no objection' ? ', who has no objection' : ''}. Do not decide the outcome and do not use any number that is not in the facts. Answer only with JSON: {"for": string, "against": string}.`,
          responseMimeType: 'application/json',
          abortSignal: AbortSignal.timeout(20000),
        },
      });
      const out = parseArguments(res.text ?? '', facts);
      if (out.dropped.length) problems.push(`${model}: ${out.dropped.join('; ')}`);
      if (out.for || out.against)
        return {
          ...debate,
          mode: 'llm',
          for: { ...debate.for, text: out.for },
          against: { ...debate.against, text: out.against },
          note:
            [
              debate.note,
              out.dropped.length
                ? `Part of Gemini's text was dropped (${out.dropped.join('; ')}); that side shows the data only.`
                : null,
            ]
              .filter(Boolean)
              .join(' ') || null,
        };
    } catch (err) {
      problems.push(`${model}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return {
    ...debate,
    note: [
      debate.note,
      `Gemini could not write the arguments (${problems.join('; ')}); showing the data only.`,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

export function debateMarkdown(debate: Debate): string[] {
  const side = (a: Argument) => [
    `## ${a.headline}`,
    ...(a.text ? [a.text, ''] : []),
    ...a.points.map((p) => `- ${p}`),
    '',
  ];
  return [
    ...side(debate.for),
    ...side(debate.against),
    ...(debate.conflict
      ? [
          '## The guideline conflict',
          `${debate.conflict.seo.id} versus ${debate.conflict.ux.id}: ${debate.conflict.reason}.`,
          '',
        ]
      : []),
    ...(debate.compromise
      ? [
          `## Compromise: ${debate.compromise.playbook.name}`,
          debate.compromise.playbook.description,
          '',
          ...debate.compromise.points.map((p) => `- ${p}`),
          '',
        ]
      : []),
    ...(debate.note ? [`_${debate.note}_`, ''] : []),
  ];
}
