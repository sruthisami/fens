import { currentContext } from '../tenancy/context.js';
import { rememberFindings } from '../memory/findingFacts.js';
import { useProcedure, writeEpisode } from '../memory/memory.js';
import { openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { agentsFor, type AgentDef } from './agents.js';
import { comparisonFromModel, comparisonFromTemplates, type DiffLike } from './compare.js';
import { reconcileFindings } from './hybrid.js';
import { runLlm } from './llm.js';
import {
  checkProposals,
  graphFacts,
  proposalKey,
  saveProposals,
  type ProposalInput,
} from './proposals.js';
import { ToolRouter } from './router.js';
import { loadRuns, saveFindings, saveRun, type InvestigationRun } from './store.js';
import { summarize } from './summarize.js';
import type { AgentChoice, AgentEvent, FindingInput, Mode } from './types.js';
import { validateFindings } from './validate.js';
const running = new Set<string>();
export function isRunning(graph: string): boolean {
  return running.has(graph);
}
export function reconcileProposals(
  baseline: ProposalInput[],
  model: ProposalInput[],
): ProposalInput[] {
  const byKey = new Map(baseline.map((b) => [proposalKey(b), b]));
  const merged = model.map((m) => {
    const b = byKey.get(proposalKey(m));
    return b && m.issue_keys.length === 0 ? { ...m, issue_keys: b.issue_keys } : m;
  });
  const keys = new Set(model.map(proposalKey));
  return [...merged, ...baseline.filter((b) => !keys.has(proposalKey(b)))];
}
export async function investigate(
  graph: string,
  mode: Mode,
  agentChoice: AgentChoice,
  emit: (e: AgentEvent) => void,
  compareWith?: string,
): Promise<void> {
  if (mode === 'replay') return replay(graph, agentChoice, emit);
  running.add(graph);
  const started = Date.now();
  const events: AgentEvent[] = [];
  const send = (e: AgentEvent) => {
    events.push(e);
    emit(e);
  };
  let toolCalls = 0;
  const run: InvestigationRun = {
    graph,
    mode,
    agent: agentChoice,
    started_at: new Date(started).toISOString(),
    ms: 0,
    tool_calls: 0,
    events,
    findings: [],
    proposals: [],
    rejected: [],
  };
  let stopped: string | undefined;
  try {
    send({ type: 'start', graph, mode, agent: agentChoice, started_at: run.started_at });
    const g = await openGraph(graph);
    for (const agent of agentsFor(agentChoice)) {
      send({ type: 'agent', agent: agent.name });
      const router = await ToolRouter.open(
        graph,
        (message) => send({ type: 'note', message }),
        agent.toolset,
      );
      try {
        const call = async (tool: string, args: Record<string, unknown> = {}) => {
          const n = ++toolCalls;
          send({ type: 'tool_call', n, tool, args });
          try {
            const out = await router.call(tool, args);
            send({ type: 'tool_result', n, tool, ok: true, summary: summarize(tool, out) });
            return out;
          } catch (err) {
            send({ type: 'tool_result', n, tool, ok: false, summary: (err as Error).message });
            throw err;
          }
        };
        const memory = await recallForRun(agent.name, call, send);
        const outcome = await runAgent(agent, mode, g, router, call, send);
        await rememberRun(graph, mode, agent.name, outcome, memory, send);
        stopped = stopped ?? outcome.stopped;
        run.findings.push(...outcome.findings);
        run.proposals?.push(...outcome.proposals);
        run.rejected.push(...outcome.rejected);
        if (compareWith && !run.comparison) {
          send({ type: 'note', message: `Comparing with ${compareWith}...` });
          const diff = (await call('diff_releases', { from_graph: compareWith })) as {
            result: DiffLike;
          };
          const comparison =
            mode === 'llm'
              ? await comparisonFromModel(diff.result, (message) => send({ type: 'note', message }))
              : comparisonFromTemplates(diff.result);
          send({ type: 'comparison', comparison });
          run.comparison = comparison;
        }
      } finally {
        await router.close();
      }
    }
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
    stopped = stopped ?? 'error';
  } finally {
    run.ms = Date.now() - started;
    run.tool_calls = toolCalls;
    send({
      type: 'done',
      mode,
      findings: run.findings.length,
      proposals: run.proposals?.length ?? 0,
      rejected: run.rejected.length,
      tool_calls: toolCalls,
      ms: run.ms,
      ...(stopped ? { stopped } : {}),
    });
    await saveRun(run).catch((err: unknown) => console.error('Could not save the run:', err));
    running.delete(graph);
  }
}
interface RunMemory {
  preferences: {
    id: string;
    subject: string;
    predicate: string;
    object: string;
  }[];
  facts: {
    id: string;
    subject: string;
    predicate: string;
    object: string;
  }[];
  tools: string[];
}
async function recallForRun(
  agent: string,
  call: (tool: string, args?: Record<string, unknown>) => Promise<unknown>,
  send: (e: AgentEvent) => void,
): Promise<RunMemory | null> {
  if (currentContext().system) return null;
  try {
    const prefs = (
      (await call('get_preferences')) as {
        preferences: RunMemory['preferences'];
      }
    ).preferences;
    const facts = (
      (await call('recall', { limit: 30 })) as {
        facts: RunMemory['facts'];
      }
    ).facts;
    const cite = (f: RunMemory['facts'][number]) =>
      `${f.id} (${f.subject} ${f.predicate}: ${f.object})`;
    send({
      type: 'note',
      message: `[${agent}] Memory used: ${prefs.length} preference(s)${prefs.length ? ` ${prefs.map(cite).join('; ')}` : ''}; ${facts.length} fact(s) recalled${facts.length ? `, e.g. ${facts.slice(0, 3).map(cite).join('; ')}` : ''}.`,
    });
    return { preferences: prefs, facts, tools: [] };
  } catch (err) {
    send({ type: 'note', message: `[${agent}] Memory unavailable: ${(err as Error).message}` });
    return null;
  }
}
async function rememberRun(
  graph: string,
  mode: Mode,
  agent: string,
  outcome: {
    findings: {
      key: string;
      category: string;
    }[];
    proposals: {
      key: string;
    }[];
  },
  memory: RunMemory | null,
  send: (e: AgentEvent) => void,
): Promise<void> {
  const ctx = currentContext();
  if (ctx.system) return;
  try {
    const used = memory ? [...memory.preferences, ...memory.facts].map((f) => f.id) : [];
    const episode = await writeEpisode(ctx, {
      type: 'run',
      agent,
      summary: `${mode} run of the ${agent} agent on ${graph}: ${outcome.findings.length} findings, ${outcome.proposals.length} proposals.${used.length ? ` Memory used: ${used.slice(0, 12).join(', ')}${used.length > 12 ? ', ...' : ''}.` : ''}`,
      graph,
      ref_key: graph,
    });
    await useProcedure(
      ctx,
      agent,
      `${agent.toUpperCase()} investigation`,
      RULES_STEPS[agent] ?? [],
    );
    const facts = await rememberFindings(ctx, graph, outcome.findings, episode);
    send({
      type: 'note',
      message: `[${agent}] Remembered: episode ${episode.id}, ${facts.length} finding fact(s).`,
    });
  } catch (err) {
    send({ type: 'note', message: `[${agent}] Could not write memory: ${(err as Error).message}` });
  }
}
const RULES_STEPS: Record<string, string[]> = {
  ux: [
    'get_preferences',
    'recall',
    'issues_by_component',
    'find_orphans',
    'find_dead_ends',
    'compare_task',
    'betweenness',
    'pagerank',
    'component_fanout',
    'ia_mismatch',
    'screen_links',
    'mobile_overflow_screens',
  ],
  seo: [
    'get_preferences',
    'recall',
    'crawl_depth',
    'unreachable_by_links',
    'js_only_content',
    'mobile_overflow_screens',
    'sitemap_gaps',
    'lens_summary',
    'screen_links',
  ],
};
async function runAgent(
  agent: AgentDef,
  mode: Mode,
  g: ReadOnlyGraph,
  router: ToolRouter,
  call: (tool: string, args?: Record<string, unknown>) => Promise<unknown>,
  send: (e: AgentEvent) => void,
) {
  const note = (message: string) => send({ type: 'note', message: `[${agent.name}] ${message}` });
  const facts = await graphFacts(g);
  const tag = (list: unknown[]) =>
    list.map((f) => ({ ...(f as FindingInput), agent: agent.name }) as FindingInput);
  const base = await agent.rules(router, call);
  const baseline = await validateFindings(g, tag(base.findings), note);
  for (const b of baseline.valid) b.origin = 'rules';
  const baseProposals = checkProposals(facts, agent.name, base.proposals, note);
  let findings = baseline.valid;
  let proposals = baseProposals.valid;
  const rejected = [...baseline.rejected];
  const proposalRejected = [...baseProposals.rejected];
  let stopped: string | undefined;
  if (mode === 'llm') {
    note(`Baseline: ${findings.length} findings, ${proposals.length} proposals`);
    let llmCalls = 0;
    const llmCall = async (tool: string, args: Record<string, unknown> = {}) => {
      llmCalls++;
      return call(tool, args);
    };
    let modelFindings: unknown[] = [];
    let modelProposals: unknown[] = [];
    try {
      const outcome = await runLlm(
        agent,
        router,
        llmCall,
        () => llmCalls,
        note,
        baseline.valid,
        baseProposals.valid.map((p) => ({ ...p, agent: undefined })),
      );
      modelFindings = outcome.findings;
      modelProposals = outcome.proposals;
      stopped = outcome.stopped;
    } catch (err) {
      note(`LLM error: ${(err as Error).message}. Keeping the baseline.`);
      stopped = 'llm_error';
    }
    const model = await validateFindings(g, tag(modelFindings), note);
    rejected.push(...model.rejected);
    findings = reconcileFindings(baseline.valid, model.valid).map((f) => ({
      ...f,
      agent: agent.name,
    }));
    const checked = checkProposals(facts, agent.name, modelProposals, note);
    proposalRejected.push(...checked.rejected);
    proposals = reconcileProposals(baseProposals.valid, checked.valid);
  }
  for (const r of rejected) send({ type: 'rejected', ...r });
  for (const r of proposalRejected) send({ type: 'proposal_rejected', agent: agent.name, ...r });
  const storedFindings = await saveFindings(router.graph, findings, mode, agent.name);
  for (const finding of storedFindings) send({ type: 'finding', finding });
  const storedProposals = await saveProposals(router.graph, agent.name, proposals);
  for (const proposal of storedProposals) send({ type: 'proposal', proposal });
  return {
    findings: storedFindings,
    proposals: storedProposals,
    rejected: [...rejected, ...proposalRejected],
    stopped,
  };
}
async function replay(
  graph: string,
  agentChoice: AgentChoice,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const runs = (await loadRuns(graph)).filter((r) => !r.events.some((e) => e.type === 'error'));
  const last = [...runs].reverse().find((r) => (r.agent ?? 'ux') === agentChoice) ?? runs.at(-1);
  if (!last) {
    emit({ type: 'error', message: `No stored run for ${graph}. Run rules or AI mode first.` });
    emit({
      type: 'done',
      mode: 'replay',
      findings: 0,
      rejected: 0,
      tool_calls: 0,
      ms: 0,
      stopped: 'nothing to replay',
    });
    return;
  }
  for (const e of last.events) {
    if (e.type === 'start')
      emit({
        ...e,
        mode: 'replay',
        replay_of: `${last.mode} run (${last.agent ?? 'ux'} agent) at ${last.started_at}`,
      });
    else if (e.type === 'done') emit({ ...e, mode: 'replay' });
    else emit(e);
  }
}
