import { HISTORY_GRAPH, hasGraph, openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { currentContext } from '../tenancy/context.js';
import { notFound } from '../http/errors.js';
export const MATCH_WEIGHTS = { component: 3, guideline: 2, lens: 1 } as const;
export const HALF_LIFE_DAYS = 180;
const CATEGORY_LENS: Record<string, string> = {
  accessibility: 'UX',
  structure: 'UX',
  flow: 'UX',
  component: 'UX',
  content: 'UX',
  seo: 'SEO',
  aeo: 'AEO',
};
const CATEGORY_GUIDELINE: Record<string, string> = { content: 'ux:information-architecture' };
export interface SuggestTarget {
  from: string;
  components: string[];
  guidelines: string[];
  lenses: string[];
}
export interface Suggestion {
  rank: number;
  person: string;
  team: string | null;
  github: string | null;
  score: number;
  similar: number;
  evidence: {
    title: string;
    closed_at: string;
    matched: string[];
    weight: number;
    path: string[];
  }[];
}
const uniq = (xs: (string | null | undefined)[]) => [
  ...new Set(xs.filter((x): x is string => !!x)),
];
async function issueFacts(g: ReadOnlyGraph, where: string, params: Record<string, unknown>) {
  const rows = await g.read<{
    components: string[];
    guidelines: string[];
    lenses: string[];
  }>(
    `MATCH ${where}
     OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
     OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
     RETURN collect(DISTINCT d.name) AS components, collect(DISTINCT gl.id) AS guidelines,
            collect(DISTINCT gl.lens) AS lenses`,
    params,
  );
  return rows[0] ?? { components: [], guidelines: [], lenses: [] };
}
export async function suggestTarget(
  g: ReadOnlyGraph,
  ref: {
    finding_id?: string;
    issue_key?: string;
    decision_id?: string;
  },
): Promise<SuggestTarget> {
  if (ref.issue_key) {
    const exists = await g.read<{
      n: number;
    }>('MATCH (i:Issue {key: $k}) RETURN count(i) AS n', {
      k: ref.issue_key,
    });
    if (!exists[0]?.n) throw notFound(`Unknown issue key: ${ref.issue_key}`);
    const f = await issueFacts(g, '(i:Issue {key: $k})', { k: ref.issue_key });
    return { from: `issue ${ref.issue_key}`, ...f };
  }
  if (ref.finding_id) {
    const rows = await g.read<{
      category: string;
      agent: string | null;
      about: string | null;
      label: string | null;
    }>(
      `MATCH (f:Finding {id: $id}) OPTIONAL MATCH (f)-[:ABOUT]->(t)
       RETURN f.category AS category, f.agent AS agent, coalesce(t.name, t.id) AS about, labels(t)[0] AS label`,
      { id: ref.finding_id },
    );
    const f = rows[0];
    if (!f) throw notFound(`Unknown finding: ${ref.finding_id}`);
    const facts = await issueFacts(g, '(:Finding {id: $id})-[:BASED_ON]->(i:Issue)', {
      id: ref.finding_id,
    });
    return {
      from: `finding ${ref.finding_id}`,
      components: uniq([...facts.components, f.label === 'DesignSystemComponent' ? f.about : null]),
      guidelines: uniq([
        ...facts.guidelines,
        facts.guidelines.length ? null : CATEGORY_GUIDELINE[f.category],
      ]),
      lenses: uniq([...facts.lenses, facts.lenses.length ? null : CATEGORY_LENS[f.category]]),
    };
  }
  if (ref.decision_id) {
    const rows = await g.read<{
      agent: string | null;
      components: string[];
    }>(
      `MATCH (:Decision {id: $id})-[:RULES_ON]->(p:Proposal)
       OPTIONAL MATCH (p)-[:TARGETS]->(d:DesignSystemComponent)
       RETURN p.agent AS agent, collect(DISTINCT d.name) AS components`,
      { id: ref.decision_id },
    );
    const d = rows[0];
    if (!d) throw notFound(`Unknown decision (or its proposal is gone): ${ref.decision_id}`);
    const facts = await issueFacts(
      g,
      '(:Decision {id: $id})-[:RULES_ON]->(:Proposal)-[:RESOLVES]->(i:Issue)',
      {
        id: ref.decision_id,
      },
    );
    return {
      from: `decision ${ref.decision_id}`,
      components: uniq([...facts.components, ...d.components]),
      guidelines: uniq(facts.guidelines),
      lenses: uniq([...facts.lenses, d.agent === 'seo' ? 'SEO' : 'UX']),
    };
  }
  throw new Error('Give finding_id, issue_key or decision_id');
}
export async function suggestAssignee(
  target: SuggestTarget,
  now = new Date(),
): Promise<{
  target: SuggestTarget;
  ranking: Suggestion[];
  note?: string;
}> {
  const ctx = currentContext();
  const history = ctx.system ? HISTORY_GRAPH : ctx.tenant.history_graph;
  if (!history || !(await hasGraph(history)))
    return {
      target,
      ranking: [],
      note: history
        ? 'No issue history yet. Run npm run import:history in fens-api.'
        : `${ctx.tenant.name} has no issue history graph.`,
    };
  const h = await openGraph(history);
  const rows = await h.read<PastRow>(`MATCH (p:Person)-[:RESOLVED]->(i:PastIssue)
     OPTIONAL MATCH (p)-[:MEMBER_OF]->(t:Team)
     RETURN p.name AS person, p.github AS github, t.name AS team, i.title AS title, i.closed_at AS closed_at,
            i.component AS component, i.guideline AS guideline, i.lens AS lens`);
  return { target, ranking: rankPeople(rows, target, now) };
}
export interface PastRow {
  person: string;
  github: string | null;
  team: string | null;
  title: string;
  closed_at: string;
  component: string | null;
  guideline: string | null;
  lens: string | null;
}
export function rankPeople(rows: PastRow[], target: SuggestTarget, now: Date): Suggestion[] {
  const people = new Map<string, Suggestion>();
  for (const r of rows) {
    const matched: string[] = [];
    let similarity = 0;
    const path = [`(Person ${r.person})`, '-[:RESOLVED]->', `(PastIssue "${r.title}")`];
    if (r.component && target.components.includes(r.component)) {
      similarity += MATCH_WEIGHTS.component;
      matched.push(`component ${r.component}`);
      path.push('-[:IN_COMPONENT]->', `(DesignSystemComponent ${r.component})`);
    }
    if (r.guideline && target.guidelines.includes(r.guideline)) {
      similarity += MATCH_WEIGHTS.guideline;
      matched.push(`guideline ${r.guideline}`);
      if (matched.length === 1) path.push('-[:VIOLATES]->', `(Guideline ${r.guideline})`);
    }
    if (r.lens && target.lenses.includes(r.lens)) {
      similarity += MATCH_WEIGHTS.lens;
      matched.push(`lens ${r.lens}`);
    }
    if (similarity === 0) continue;
    const days = Math.max(0, (now.getTime() - new Date(r.closed_at).getTime()) / 86400000);
    const weight = similarity * 0.5 ** (days / HALF_LIFE_DAYS);
    const entry = people.get(r.person) ?? {
      rank: 0,
      person: r.person,
      team: r.team,
      github: r.github,
      score: 0,
      similar: 0,
      evidence: [],
    };
    entry.score += weight;
    entry.similar += 1;
    entry.evidence.push({
      title: r.title,
      closed_at: r.closed_at,
      matched,
      weight: Math.round(weight * 100) / 100,
      path,
    });
    people.set(r.person, entry);
  }
  return [...people.values()]
    .sort((a, b) => b.score - a.score || a.person.localeCompare(b.person))
    .map((p, i) => ({
      ...p,
      rank: i + 1,
      score: Math.round(p.score * 100) / 100,
      evidence: p.evidence.sort((a, b) => b.weight - a.weight),
    }));
}
export function suggestionLine(s: Awaited<ReturnType<typeof suggestAssignee>>): string {
  const top = s.ranking[0];
  if (!top) return `Suggested assignee: none (${s.note ?? 'no similar resolved issues'}).`;
  const why = top.evidence[0]?.matched.join(', ') ?? '';
  return `Suggested assignee (not assigned unless confirmed): ${top.person}${top.team ? ` (${top.team})` : ''}, ${top.similar} similar resolved issue${top.similar === 1 ? '' : 's'}${why ? `, matching ${why}` : ''}.`;
}
