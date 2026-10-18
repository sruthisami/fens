import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { openFindingWriter, openGraph } from '../graph/db.js';
import type { Comparison } from './compare.js';
import type { StoredProposal } from './proposals.js';
import type {
  AgentChoice,
  AgentEvent,
  AgentName,
  FindingInput,
  Mode,
  StoredFinding,
} from './types.js';
export function findingKey(f: FindingInput): string {
  return [
    f.agent === 'seo' ? 'seo-agent' : null,
    f.category,
    `${f.target.type}:${f.target.id}`,
    f.rule_id,
  ]
    .filter(Boolean)
    .join('|');
}
const findingId = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16);
export function stalePlan(
  existing: {
    id: string;
    channel_url: string | null;
  }[],
  current: Set<string>,
): {
  remove: string[];
  markStale: string[];
} {
  const remove: string[] = [];
  const markStale: string[] = [];
  for (const f of existing) {
    if (current.has(f.id)) continue;
    (f.channel_url ? markStale : remove).push(f.id);
  }
  return { remove, markStale };
}
export async function saveFindings(
  graph: string,
  findings: FindingInput[],
  mode: Mode,
  agent: AgentName = 'ux',
): Promise<StoredFinding[]> {
  const w = await openFindingWriter(graph);
  const now = new Date().toISOString();
  const stored: StoredFinding[] = [];
  for (const input of findings) {
    const f = { ...input, agent };
    const key = findingKey(f);
    const id = findingId(key);
    const origin = f.origin ?? (mode === 'rules' ? 'rules' : 'ai');
    await w.write(
      `MERGE (f:Finding {id: $id})
       ON CREATE SET f.created_at = $now
       SET f.key = $key, f.title = $title, f.severity = $severity, f.category = $category,
           f.explanation = $explanation, f.recommendation = $recommendation, f.mode = $mode,
           f.origin = $origin, f.agent = $agent,
           f.evidence = $evidence, f.updated_at = $now
       WITH f
       OPTIONAL MATCH (f)-[old:ABOUT|EVIDENCED_BY|BASED_ON]->()
       DELETE old`,
      {
        id,
        now,
        key,
        title: f.title,
        severity: f.severity,
        category: f.category,
        explanation: f.explanation,
        recommendation: f.recommendation,
        mode,
        origin,
        agent,
        evidence: JSON.stringify(f.evidence),
      },
    );
    const about =
      f.target.type === 'screen'
        ? 'MATCH (t:Screen {id: $target})'
        : f.target.type === 'component'
          ? 'MATCH (t:DesignSystemComponent {name: $target})'
          : 'MATCH (t:Task {id: $target})';
    await w.write(`MATCH (f:Finding {id: $id}) ${about} MERGE (f)-[:ABOUT]->(t)`, {
      id,
      target: f.target.id,
    });
    for (const e of f.evidence) {
      await w.write(
        `MATCH (f:Finding {id: $id})
         UNWIND $screens AS sid
         MATCH (s:Screen {id: sid})
         MERGE (f)-[:EVIDENCED_BY {tool: $tool}]->(s)`,
        { id, tool: e.tool, screens: [...new Set([...e.screens, ...e.path])] },
      );
    }
    if (f.issue_ids?.length) {
      await w.write(
        `MATCH (f:Finding {id: $id}) UNWIND $issues AS iid MATCH (i:Issue {id: iid}) MERGE (f)-[:BASED_ON]->(i)`,
        { id, issues: f.issue_ids },
      );
    } else if (f.target.type === 'component' && f.category === 'accessibility') {
      await w.write(
        `MATCH (f:Finding {id: $id}) MATCH (i:Issue)-[:IN_COMPONENT]->(:DesignSystemComponent {name: $target})
         MERGE (f)-[:BASED_ON]->(i)`,
        { id, target: f.target.id },
      );
    } else if (f.rule_id && f.target.type === 'screen') {
      // Page-level rules (js-only content, sitemap gaps): the Issue with that rule on the screen.
      await w.write(
        `MATCH (f:Finding {id: $id}) MATCH (i:Issue {rule_id: $rule})-[:FOUND_ON]->(:Screen {id: $target})
         MERGE (f)-[:BASED_ON]->(i)`,
        { id, rule: f.rule_id.split('|')[0], target: f.target.id },
      );
    }
    stored.push({ ...f, id, key, mode, origin });
  }
  const existing =
    (await (
      await openGraph(graph)
    ).read<{
      id: string;
      channel_url: string | null;
    }>(
      `MATCH (f:Finding) WHERE coalesce(f.agent, 'ux') = $agent
       RETURN f.id AS id, coalesce(f.github_issue_url, f.linear_issue_url, f.figma_comment_url) AS channel_url`,
      { agent },
    )) ?? [];
  const plan = stalePlan(existing, new Set(stored.map((s) => s.id)));
  if (plan.remove.length) {
    await w.write('MATCH (f:Finding) WHERE f.id IN $ids DETACH DELETE f', { ids: plan.remove });
  }
  if (plan.markStale.length) {
    await w.write('MATCH (f:Finding) WHERE f.id IN $ids SET f.stale = true', {
      ids: plan.markStale,
    });
  }
  if (stored.length) {
    await w.write('MATCH (f:Finding) WHERE f.id IN $ids SET f.stale = false', {
      ids: stored.map((s) => s.id),
    });
  }
  return stored;
}
export interface InvestigationRun {
  graph: string;
  mode: Mode;
  agent?: AgentChoice;
  proposals?: StoredProposal[];
  started_at: string;
  ms: number;
  tool_calls: number;
  events: AgentEvent[];
  findings: StoredFinding[];
  rejected: {
    title: string;
    reason: string;
  }[];
  comparison?: Comparison;
}
const cacheFile = (graph: string) => resolve('.cache', 'investigations', `${graph}.json`);
export async function saveRun(run: InvestigationRun): Promise<void> {
  const file = cacheFile(run.graph);
  const runs = await loadRuns(run.graph);
  runs.push(run);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ runs }, null, 2) + '\n');
}
export async function loadRuns(graph: string): Promise<InvestigationRun[]> {
  try {
    return (
      (
        JSON.parse(await readFile(cacheFile(graph), 'utf8')) as {
          runs: InvestigationRun[];
        }
      ).runs ?? []
    );
  } catch {
    return [];
  }
}
