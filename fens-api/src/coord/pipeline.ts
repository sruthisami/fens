import { investigate } from '../agent/investigate.js';
import { listFindings } from '../agent/findings.js';
import type { AgentEvent } from '../agent/types.js';
import { decide, listDecisions } from '../decider/decide.js';
import { decisionIssuePreview } from '../decider/github.js';
import { openGraph } from '../graph/db.js';
import { rememberComparison, type ComparisonLike } from '../memory/findingFacts.js';
import { writeEpisode } from '../memory/memory.js';
import type { Ctx } from '../tenancy/context.js';
import { findTool, runTool } from '../tools/index.js';
import { createHandoff, newRunId, type Handoff } from './handoffs.js';
import { releaseFlag, takeFlag, updateState } from './state.js';
export const SCAN_AGENTS = ['ux', 'seo'] as const;
export interface RunState {
  graph: string;
  started_at: string;
  done: string[];
  compare_with: string | null;
}
export async function startPipeline(ctx: Ctx, graph: string, compareWith?: string | null) {
  const run = newRunId();
  await updateState<RunState>(ctx, `run:${run}`, () => ({
    graph,
    started_at: new Date().toISOString(),
    done: [],
    compare_with: compareWith ?? null,
  }));
  const handoffs: Handoff[] = [];
  for (const agent of SCAN_AGENTS)
    handoffs.push(
      await createHandoff(ctx, {
        id: `${run}|scan|${agent}`,
        kind: 'scan_requested',
        from_agent: 'pipeline',
        to_agent: agent,
        payload_key: graph,
        run_id: run,
        graph,
      }),
    );
  if (compareWith) {
    const tool = findTool('diff_releases');
    const diff = (await runTool(tool!, graph, { from_graph: compareWith }))
      .result as ComparisonLike;
    const memory = await rememberComparison(ctx, compareWith, graph, diff);
    if (diff.findings.resolved.length)
      handoffs.push(
        await createHandoff(ctx, {
          id: `${run}|release`,
          kind: 'release_resolved',
          from_agent: 'release-diff',
          to_agent: 'closer',
          payload_key: `${compareWith}->${graph}`,
          run_id: run,
          graph,
        }),
      );
    return { run_id: run, handoffs, comparison: memory.episode.summary };
  }
  return { run_id: run, handoffs, comparison: null };
}
export async function handle(
  ctx: Ctx,
  agent: string,
  h: Handoff,
  claimer: string,
): Promise<string> {
  const graph = h.graph ?? h.payload_key;
  if ((agent === 'ux' || agent === 'seo') && h.kind === 'scan_requested') {
    let done: Extract<
      AgentEvent,
      {
        type: 'done';
      }
    > | null = null;
    let error: string | null = null;
    await investigate(graph, 'rules', agent, (e) => {
      if (e.type === 'done') done = e;
      if (e.type === 'error') error = e.message;
    });
    if (error) throw new Error(error);
    const d = done as Extract<
      AgentEvent,
      {
        type: 'done';
      }
    > | null;
    const state = await updateState<RunState>(ctx, `run:${h.run_id}`, (cur) => ({
      ...(cur ?? { graph, started_at: new Date().toISOString(), compare_with: null, done: [] }),
      done: [...new Set([...(cur?.done ?? []), agent])],
    }));
    const ready = SCAN_AGENTS.every((a) => state.value.done.includes(a));
    if (ready)
      await createHandoff(ctx, {
        id: `${h.run_id}|proposals_ready`,
        kind: 'proposals_ready',
        from_agent: 'ux+seo',
        to_agent: 'decider',
        payload_key: graph,
        run_id: h.run_id,
        graph,
      });
    return `${d?.findings ?? 0} findings, ${d?.proposals ?? 0} proposals${ready ? '; both scans done: proposals_ready for the decider' : '; waiting for the other scan'}`;
  }
  if (agent === 'decider' && h.kind === 'proposals_ready') {
    let held = false;
    for (let i = 0; i < 60 && !held; i++) {
      held = await takeFlag(ctx, 'arbitration running', claimer);
      if (!held) await new Promise((r) => setTimeout(r, 500));
    }
    if (!held) throw new Error('arbitration is running elsewhere');
    try {
      const decisions = await decide(graph, 'rules', () => {});
      const outcomes: Record<string, number> = {};
      for (const d of decisions) {
        outcomes[d.outcome] = (outcomes[d.outcome] ?? 0) + 1;
        if (d.outcome === 'approved' || d.outcome === 'reconciled')
          await createHandoff(ctx, {
            id: `${h.run_id}|decision|${d.id}`,
            kind: 'decision_ready',
            from_agent: 'decider',
            to_agent: 'channels',
            payload_key: d.id,
            run_id: h.run_id,
            graph,
          });
        else if (d.outcome === 'needs_human')
          await createHandoff(ctx, {
            id: `${h.run_id}|human|${d.id}`,
            kind: 'needs_human',
            from_agent: 'decider',
            to_agent: 'human',
            payload_key: d.id,
            run_id: h.run_id,
            graph,
          });
      }
      return `${decisions.length} decisions: ${Object.entries(outcomes)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')}`;
    } finally {
      await releaseFlag(ctx, 'arbitration running', claimer);
    }
  }
  if (agent === 'channels' && h.kind === 'decision_ready') {
    const g = await openGraph(graph);
    const d = (await listDecisions(g)).find((x) => x.id === h.payload_key);
    if (!d) throw new Error(`decision ${h.payload_key} not found`);
    const preview = await decisionIssuePreview(g, d);
    return `GitHub issue preview ready: "${preview.title}" (${preview.labels.join(', ')}). Nothing sent: creating it needs the confirm step in the dashboard.`;
  }
  if (agent === 'closer' && h.kind === 'release_resolved') {
    const [from, to] = h.payload_key.split('->');
    const findings = await listFindings(await openGraph(from as string));
    const withChannels = findings.filter(
      (f) => f.channels.github || f.channels.linear || f.channels.figma,
    );
    await updateState(ctx, 'last scan release', () => ({ from, to, at: new Date().toISOString() }));
    return `${to} resolved findings from ${from}; ${withChannels.length} have GitHub, Linear or Figma items to close. Close previews only: "Resolve everywhere" needs the confirm step.`;
  }
  throw new Error(`${agent} cannot handle ${h.kind}`);
}
export async function recordHandoffEpisode(
  ctx: Ctx,
  agent: string,
  h: Handoff,
  result: string,
  ms: number,
) {
  await writeEpisode(ctx, {
    type: 'handoff',
    agent,
    summary: `${agent} finished ${h.kind} (${h.id}) for ${h.graph ?? h.payload_key} in ${(ms / 1000).toFixed(1)} s: ${result}`,
    graph: h.graph,
    ref_key: h.id,
  });
}
