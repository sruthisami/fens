import { currentContext } from '../tenancy/context.js';
import { creditPlaybook, playbookStats, successRate, writeEpisode } from '../memory/memory.js';
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { listProposals, type StoredProposal } from '../agent/proposals.js';
import { env } from '../config/env.js';
import { openFindingWriter, openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { MAX_LINK_DEPTH } from './scores.js';
import { PLAYBOOKS, playbookChange, playbooksFor, type Playbook } from './playbooks.js';
import { simulate, type Change, type Simulation } from './simulate.js';
export const OUTCOMES = ['approved', 'reconciled', 'rejected', 'needs_human'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type DecideMode = 'rules' | 'llm';
export const MIN_CHANGE = 2;
export type Effect = 'improves' | 'unchanged' | 'worsens';
export const effect = (delta: number): Effect =>
  delta >= MIN_CHANGE ? 'improves' : delta <= -MIN_CHANGE ? 'worsens' : 'unchanged';
export interface SimSummary {
  label: string;
  playbook: string | null;
  change: Change;
  ux_before: number;
  ux_after: number;
  seo_before: number;
  seo_after: number;
  ux: Effect;
  seo: Effect;
  parts: Simulation['parts'];
  link_depth: Simulation['link_depth'];
}
export interface DecisionRecord {
  id: string;
  proposal_id: string;
  proposal_key: string;
  proposal_title: string;
  agent: string;
  change_type: string;
  outcome: Outcome;
  ux_before: number;
  ux_after: number;
  seo_before: number;
  seo_after: number;
  rationale: string;
  note: string | null;
  precedent: boolean;
  precedent_id: string | null;
  playbook: {
    id: string;
    name: string;
  } | null;
  tried_playbooks: string[];
  simulations: SimSummary[];
  screens: string[];
  mode: DecideMode;
  github_issue_url: string | null;
  linear_issue_url: string | null;
  created_at: string;
  updated_at: string;
}
export type DecideEvent =
  | {
      type: 'start';
      graph: string;
      mode: DecideMode;
      proposals: number;
      started_at: string;
    }
  | {
      type: 'precedent';
      proposal_id: string;
      decision_id: string;
      outcome: string;
      playbook: string | null;
    }
  | {
      type: 'simulating';
      proposal_id: string;
      label: string;
      change: Change;
    }
  | {
      type: 'result';
      proposal_id: string;
      simulation: SimSummary;
    }
  | {
      type: 'decision';
      decision: DecisionRecord;
    }
  | {
      type: 'note';
      message: string;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'done';
      decisions: number;
      outcomes: Record<string, number>;
      ms: number;
    };
const decisionId = (proposalKey: string) =>
  createHash('sha1').update(`decision|${proposalKey}`).digest('hex').slice(0, 16);
function summary(label: string, playbook: Playbook | null, s: Simulation): SimSummary {
  return {
    label,
    playbook: playbook?.id ?? null,
    change: s.change,
    ux_before: s.before.ux.score,
    ux_after: s.after.ux.score,
    seo_before: s.before.seo.score,
    seo_after: s.after.seo.score,
    ux: effect(s.delta.ux),
    seo: effect(s.delta.seo),
    parts: s.parts,
    link_depth: s.link_depth,
  };
}
const worse = (s: SimSummary) => s.ux === 'worsens' || s.seo === 'worsens';
const better = (s: SimSummary) => s.ux === 'improves' || s.seo === 'improves';
const gain = (s: SimSummary) => s.ux_after - s.ux_before + (s.seo_after - s.seo_before);
const partText = (s: SimSummary) =>
  s.parts.length
    ? s.parts
        .map((p) => `${p.lens.toUpperCase()} ${p.label}: penalty ${p.before} to ${p.after} points`)
        .join('; ')
    : 'no part changes';
function depthNote(s: SimSummary): string | null {
  const deeper = s.link_depth.filter(
    (d) => d.before !== null && d.after !== null && d.after > d.before && d.after <= MAX_LINK_DEPTH,
  );
  if (!deeper.length) return null;
  return `Link depth rises but stays within ${MAX_LINK_DEPTH}: ${deeper.map((d) => `${d.id} ${d.before} to ${d.after}`).join(', ')}.`;
}
export function templateRationale(
  p: StoredProposal,
  outcome: Outcome,
  first: SimSummary,
  chosen: SimSummary,
  playbook: Playbook | null,
  tried: string[],
): string {
  const lens = (s: SimSummary) =>
    `UX ${s.ux_before} to ${s.ux_after} (${s.ux}), SEO ${s.seo_before} to ${s.seo_after} (${s.seo})`;
  const base = `Simulated "${p.title}" (${p.change.type}) on a copy of the graph: ${lens(first)}. ${partText(first)}.`;
  switch (outcome) {
    case 'approved':
      return `${base} No lens gets worse and at least one improves, so it is approved.`;
    case 'reconciled':
      return `${base} ${first.ux === 'worsens' && first.seo === 'worsens' ? 'UX and SEO get' : first.ux === 'worsens' ? 'UX gets' : 'SEO gets'} worse, a conflict between guidelines. The playbook "${playbook?.name}" (${chosen.change.type}) instead gives ${lens(chosen)}: no lens gets worse, so the proposal is reconciled with it.`;
    case 'rejected':
      return `${base} Neither lens moves by ${MIN_CHANGE} points or more, so the change is not worth making.`;
    case 'needs_human':
      return `${base} It is a conflict${tried.length ? `, and no playbook (${tried.join(', ')}) keeps both lenses` : ' and no playbook matches'}. A person has to weigh it.`;
  }
}
async function modelRationale(facts: string, note: (m: string) => void): Promise<string | null> {
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) {
    note('GEMINI_API_KEY or GEMINI_MODEL is not set; using the template rationale');
    return null;
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  for (const model of [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean) as string[]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: facts }] }],
        config: {
          systemInstruction:
            'You write the rationale for a decision FlowLens already made about a proposed website change. Use only the facts given, in 2 to 4 plain sentences. Do not change or question the outcome, and do not invent numbers.',
          abortSignal: AbortSignal.timeout(20000),
        },
      });
      const text = res.text?.trim();
      if (text) return text.slice(0, 1500);
    } catch (err) {
      note(
        `Gemini (${model}) could not write the rationale: ${(err as Error).message.slice(0, 120)}`,
      );
    }
  }
  return null;
}
async function seedPlaybooks(graph: string): Promise<void> {
  const w = await openFindingWriter(graph);
  await w.write(
    `UNWIND $rows AS r
     MERGE (p:Playbook {id: r.id})
     ON CREATE SET p.success_count = 0, p.fail_count = 0
     SET p.name = r.name, p.pattern = r.pattern, p.change_type = r.change_type, p.description = r.description`,
    { rows: PLAYBOOKS },
  );
}
async function recountPlaybooks(graph: string, g: ReadOnlyGraph): Promise<void> {
  const decisions = await g.read<{
    outcome: string;
    used: string | null;
    tried: string[] | null;
  }>(`MATCH (d:Decision) OPTIONAL MATCH (d)-[:USED]->(p:Playbook)
     RETURN d.outcome AS outcome, p.id AS used, d.tried_playbooks AS tried`);
  const w = await openFindingWriter(graph);
  for (const pb of PLAYBOOKS) {
    const success = decisions.filter((d) => d.used === pb.id && d.outcome === 'reconciled').length;
    const fail = decisions.filter(
      (d) => (d.tried ?? []).includes(pb.id) && d.used !== pb.id,
    ).length;
    await w.write('MATCH (p:Playbook {id: $id}) SET p.success_count = $s, p.fail_count = $f', {
      id: pb.id,
      s: success,
      f: fail,
    });
  }
}
async function rememberDecision(
  graph: string,
  d: DecisionRecord,
  used: Playbook | null,
  tried: string[],
  note: (message: string) => void,
): Promise<void> {
  const ctx = currentContext();
  try {
    await writeEpisode(ctx, {
      type: 'decision',
      agent: 'decider',
      summary: `${d.outcome} ${d.proposal_key} on ${graph}: UX ${d.ux_before} to ${d.ux_after}, SEO ${d.seo_before} to ${d.seo_after}${used ? `, with playbook ${used.id}` : ''}${d.precedent ? ', following a precedent' : ''}.`,
      graph,
      ref_key: d.proposal_key,
    });
    const key = `${graph}|${d.id}`;
    for (const id of tried) {
      const pb = PLAYBOOKS.find((x) => x.id === id);
      if (!pb) continue;
      await creditPlaybook(ctx, pb, key, used?.id === id ? 'success' : 'fail');
    }
  } catch (err) {
    note(`Could not write decision memory: ${(err as Error).message}`);
  }
}
export async function decide(
  graph: string,
  mode: DecideMode,
  emit: (e: DecideEvent) => void,
): Promise<DecisionRecord[]> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const note = (message: string) => emit({ type: 'note', message });
  const g = await openGraph(graph);
  await seedPlaybooks(graph);
  const ctx = currentContext();
  const stats = ctx.system ? [] : await playbookStats(ctx).catch(() => []);
  const rateOf = (id: string) => {
    const s = stats.find((x) => x.id === id);
    return successRate(s?.success_count ?? 0, s?.fail_count ?? 0);
  };
  const statText = (id: string) => {
    const s = stats.find((x) => x.id === id);
    return s && s.success_count + s.fail_count > 0
      ? `${id} ${s.success_count} of ${s.success_count + s.fail_count}`
      : `${id} not used yet`;
  };
  const proposals = (await listProposals(g)).filter((p) => p.status === 'open');
  emit({ type: 'start', graph, mode, proposals: proposals.length, started_at: startedAt });
  const decisions: DecisionRecord[] = [];
  try {
    for (const p of proposals) {
      const precedent = (
        await g.read<{
          id: string;
          outcome: string;
          playbook: string | null;
          same: boolean;
        }>(
          `MATCH (d:Decision)-[:RULES_ON]->(pr:Proposal {change_type: $type})
           WHERE d.outcome IN ['approved', 'reconciled'] AND d.created_at < $started
           OPTIONAL MATCH (d)-[:USED]->(pb:Playbook)
           RETURN d.id AS id, d.outcome AS outcome, pb.id AS playbook, pr.key = $key AS same
           ORDER BY same DESC, d.created_at DESC LIMIT 1`,
          { type: p.change.type, started: startedAt, key: p.key },
        )
      )[0];
      if (precedent)
        emit({
          type: 'precedent',
          proposal_id: p.id,
          decision_id: precedent.id,
          outcome: precedent.outcome,
          playbook: precedent.playbook,
        });
      const run = async (label: string, playbook: Playbook | null, change: Change) => {
        emit({ type: 'simulating', proposal_id: p.id, label, change });
        const s = summary(label, playbook, await simulate(graph, change));
        emit({ type: 'result', proposal_id: p.id, simulation: s });
        return s;
      };
      const first = await run('proposal', null, p.change as Change);
      const sims = [first];
      let outcome: Outcome;
      let chosen = first;
      let used: Playbook | null = null;
      const tried: string[] = [];
      let ranking = '';
      if (!worse(first)) {
        outcome = better(first) ? 'approved' : 'rejected';
      } else {
        const candidates = (await playbooksFor(g, p.change.type)).sort(
          (a, b) =>
            Number(b.id === precedent?.playbook) - Number(a.id === precedent?.playbook) ||
            rateOf(b.id) - rateOf(a.id),
        );
        if (candidates.length)
          ranking = `Playbooks were tried in order of success rate in team memory: ${candidates.map((c) => statText(c.id)).join(', ')}.`;
        let best: {
          s: SimSummary;
          pb: Playbook;
        } | null = null;
        for (const pb of candidates) {
          const change = await playbookChange(g, pb, p.change as Change);
          if (!change) continue;
          tried.push(pb.id);
          const s = await run(`playbook ${pb.name}`, pb, change);
          sims.push(s);
          if (worse(s)) continue;
          const rank = (x: SimSummary) => [Number(better(x)), gain(x)] as const;
          const [b1, g1] = rank(s);
          const [b2, g2] = best ? rank(best.s) : [-1, -Infinity];
          if (b1 > b2 || (b1 === b2 && g1 > g2)) best = { s, pb };
        }
        if (best) {
          outcome = 'reconciled';
          chosen = best.s;
          used = best.pb;
        } else outcome = 'needs_human';
      }
      const noteText =
        outcome === 'approved' || outcome === 'reconciled' ? depthNote(chosen) : null;
      let rationale = templateRationale(p, outcome, first, chosen, used, tried);
      if (mode === 'llm') {
        const written = await modelRationale(
          `Proposal: ${p.title} (${p.agent} agent, ${p.change.type} ${JSON.stringify(p.change.params)}). Its rationale: ${p.rationale}\nOutcome (fixed): ${outcome}${used ? ` with playbook "${used.name}": ${used.description}` : ''}.\nSimulation of the proposal: UX ${first.ux_before} to ${first.ux_after}, SEO ${first.seo_before} to ${first.seo_after}; ${partText(first)}.${used ? `\nSimulation of the playbook: UX ${chosen.ux_before} to ${chosen.ux_after}, SEO ${chosen.seo_before} to ${chosen.seo_after}; ${partText(chosen)}.` : ''}${noteText ? `\nNote: ${noteText}` : ''}${precedent ? `\nPrecedent: an earlier ${precedent.outcome} decision on the same change type.` : ''}`,
          note,
        );
        if (written) rationale = written;
      }
      if (noteText) rationale = `${rationale} ${noteText}`;
      if (ranking) rationale = `${rationale} ${ranking}`;
      const id = decisionId(p.key);
      const now = new Date().toISOString();
      const screens = [
        ...new Set([...p.targets.screens, ...sims.flatMap((s) => s.link_depth.map((d) => d.id))]),
      ].sort();
      const w = await openFindingWriter(graph);
      await w.write(
        `MERGE (d:Decision {id: $id})
         ON CREATE SET d.created_at = $now
         SET d.outcome = $outcome, d.ux_before = $uxb, d.ux_after = $uxa, d.seo_before = $seob,
             d.seo_after = $seoa, d.rationale = $rationale, d.note = $note, d.precedent = $precedent,
             d.precedent_id = $precedent_id, d.tried_playbooks = $tried, d.simulations = $sims,
             d.screens = $screens, d.mode = $mode, d.proposal_key = $key, d.updated_at = $now
         WITH d
         OPTIONAL MATCH (d)-[old:RULES_ON|USED]->()
         DELETE old`,
        {
          id,
          now,
          outcome,
          uxb: chosen.ux_before,
          uxa: chosen.ux_after,
          seob: chosen.seo_before,
          seoa: chosen.seo_after,
          rationale,
          note: noteText,
          precedent: !!precedent,
          precedent_id: precedent?.id ?? null,
          tried,
          sims: JSON.stringify(sims),
          screens,
          mode,
          key: p.key,
        },
      );
      await w.write(
        'MATCH (d:Decision {id: $id}), (p:Proposal {id: $pid}) MERGE (d)-[:RULES_ON]->(p)',
        {
          id,
          pid: p.id,
        },
      );
      if (used)
        await w.write(
          'MATCH (d:Decision {id: $id}), (pb:Playbook {id: $pb}) MERGE (d)-[:USED]->(pb)',
          {
            id,
            pb: used.id,
          },
        );
      const record = (await listDecisions(g)).find((d) => d.id === id);
      if (record) {
        decisions.push(record);
        emit({ type: 'decision', decision: record });
        if (!ctx.system) await rememberDecision(graph, record, used, tried, note);
      }
    }
    await recountPlaybooks(graph, g);
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  }
  const outcomes: Record<string, number> = {};
  for (const d of decisions) outcomes[d.outcome] = (outcomes[d.outcome] ?? 0) + 1;
  emit({ type: 'done', decisions: decisions.length, outcomes, ms: Date.now() - t0 });
  return decisions;
}
export async function listDecisions(g: ReadOnlyGraph): Promise<DecisionRecord[]> {
  const rows = await g.read<{
    d: Record<string, unknown>;
    p: Record<string, unknown> | null;
    pb: Record<string, unknown> | null;
  }>(`MATCH (d:Decision)
     OPTIONAL MATCH (d)-[:RULES_ON]->(p:Proposal)
     OPTIONAL MATCH (d)-[:USED]->(pb:Playbook)
     RETURN properties(d) AS d, properties(p) AS p, properties(pb) AS pb`);
  return rows
    .map(({ d, p, pb }) => {
      let simulations: SimSummary[] = [];
      try {
        simulations = JSON.parse(String(d.simulations ?? '[]')) as SimSummary[];
      } catch {
        simulations = [];
      }
      return {
        id: String(d.id),
        proposal_id: p ? String(p.id) : '',
        proposal_key: String(d.proposal_key ?? p?.key ?? ''),
        proposal_title: p ? String(p.title) : '(proposal no longer exists)',
        agent: p ? String(p.agent) : '',
        change_type: p ? String(p.change_type) : '',
        outcome: d.outcome as Outcome,
        ux_before: Number(d.ux_before),
        ux_after: Number(d.ux_after),
        seo_before: Number(d.seo_before),
        seo_after: Number(d.seo_after),
        rationale: String(d.rationale ?? ''),
        note: (d.note as string) ?? null,
        precedent: d.precedent === true,
        precedent_id: (d.precedent_id as string) ?? null,
        playbook: pb ? { id: String(pb.id), name: String(pb.name) } : null,
        tried_playbooks: (d.tried_playbooks as string[]) ?? [],
        simulations,
        screens: (d.screens as string[]) ?? [],
        mode: (d.mode as DecideMode) ?? 'rules',
        github_issue_url: (d.github_issue_url as string) ?? null,
        linear_issue_url: (d.linear_issue_url as string) ?? null,
        created_at: String(d.created_at),
        updated_at: String(d.updated_at ?? d.created_at),
      };
    })
    .sort((a, b) => a.proposal_key.localeCompare(b.proposal_key));
}
export async function listPlaybooks(g: ReadOnlyGraph) {
  return g.read<{
    id: string;
    name: string;
    pattern: string;
    change_type: string;
    success_count: number;
    fail_count: number;
  }>(`MATCH (p:Playbook) RETURN p.id AS id, p.name AS name, p.pattern AS pattern,
            p.change_type AS change_type, p.success_count AS success_count, p.fail_count AS fail_count
     ORDER BY id`);
}
