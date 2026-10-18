import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ReadOnlyGraph } from '../graph/db.js';
import { openFindingWriter } from '../graph/db.js';
import type { AgentName } from './types.js';
export const CHANGE_TYPES = [
  'table_to_cards',
  'table_responsive',
  'content_in_html',
  'remove_links',
  'add_link',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];
export const EFFECTS = ['improves', 'neutral', 'worsens'] as const;
const screenId = z.string().regex(/^\//, 'screen ids start with "/"').max(512);
const componentName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
  .optional()
  .describe('Design system component on that screen, when the change is to one component');
export const PARAMS: Record<ChangeType, z.ZodType> = {
  table_to_cards: z.object({ screen: screenId, component: componentName }),
  table_responsive: z.object({ screen: screenId, component: componentName }),
  content_in_html: z.object({ screen: screenId, component: componentName }),
  remove_links: z.object({ from: screenId, to: z.array(screenId).min(1).max(30) }),
  add_link: z.object({
    from: screenId,
    to: screenId,
    label: z.string().min(1).max(80),
    via: z.literal('link').default('link'),
  }),
};
export const modelProposalSchema = z.object({
  title: z.string().min(3).max(200),
  change: z.object({
    type: z.string().describe(`One of: ${CHANGE_TYPES.join(', ')}. Anything else is rejected.`),
    params: z
      .object({
        screen: z
          .string()
          .optional()
          .describe('table_to_cards, table_responsive, content_in_html: the screen'),
        component: z
          .string()
          .optional()
          .describe('Optional: the design system component on that screen'),
        from: z.string().optional().describe('remove_links, add_link: the screen the links are on'),
        to: z
          .array(z.string())
          .optional()
          .describe('remove_links: the target screens. add_link: one target screen'),
        label: z.string().optional().describe('add_link: the link text'),
        via: z.string().optional().describe('add_link: always "link"'),
      })
      .describe(
        'table_to_cards, table_responsive, content_in_html: { screen, component? }. remove_links: { from, to: [screens] }. add_link: { from, to: [one screen], label, via: "link" }',
      ),
  }),
  rationale: z.string().min(10).max(2000).describe('Why, citing tool results'),
  issue_keys: z
    .array(z.string().max(400))
    .max(20)
    .default([])
    .describe('Issue.key values this change resolves (from the graph)'),
  expected: z.object({
    ux: z.enum(EFFECTS).describe('Expected effect on the UX lens'),
    seo: z.enum(EFFECTS).describe('Expected effect on the SEO and AEO lens'),
  }),
});
export const proposalSchema = modelProposalSchema.extend({
  change: z.object({ type: z.string(), params: z.record(z.string(), z.unknown()) }),
});
export const submitProposalsSchema = z.object({ proposals: z.array(modelProposalSchema).max(10) });
export interface ProposalInput {
  agent: AgentName;
  title: string;
  change: {
    type: ChangeType;
    params: Record<string, unknown>;
  };
  rationale: string;
  issue_keys: string[];
  expected: {
    ux: (typeof EFFECTS)[number];
    seo: (typeof EFFECTS)[number];
  };
}
export interface StoredProposal extends ProposalInput {
  id: string;
  key: string;
  targets: {
    screens: string[];
    components: string[];
  };
  status: string;
}
export function primaryTarget(change: ProposalInput['change']): string {
  const p = change.params as {
    screen?: string;
    from?: string;
    to?: string | string[];
  };
  if (change.type === 'add_link') return String(p.to);
  if (change.type === 'remove_links') return String(p.from);
  return String(p.screen);
}
export const proposalKey = (p: Pick<ProposalInput, 'change'>) =>
  `${p.change.type}|${primaryTarget(p.change)}`;
const proposalId = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16);
export function targetsOf(change: ProposalInput['change']) {
  const p = change.params as Record<string, unknown>;
  const screens = new Set<string>();
  for (const k of ['screen', 'from', 'to']) {
    const v = p[k];
    for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string') screens.add(s);
  }
  const components = typeof p.component === 'string' ? [p.component] : [];
  return { screens: [...screens], components };
}
export interface GraphFacts {
  screens: Set<string>;
  components: Set<string>;
  issueKeys: Set<string>;
  edges: Set<string>;
  links: Set<string>;
}
export async function graphFacts(g: ReadOnlyGraph): Promise<GraphFacts> {
  const ids = (q: string) =>
    g
      .read<{
        v: string;
      }>(q)
      .then((r) => new Set(r.map((x) => x.v)));
  return {
    screens: await ids('MATCH (s:Screen) RETURN s.id AS v'),
    components: await ids('MATCH (d:DesignSystemComponent) RETURN d.name AS v'),
    issueKeys: await ids('MATCH (i:Issue) RETURN i.key AS v'),
    edges: await ids(
      "MATCH (a:Screen)-[:NAVIGATES_TO]->(b:Screen) RETURN a.id + ' -> ' + b.id AS v",
    ),
    links: await ids(
      "MATCH (a:Screen)-[e:NAVIGATES_TO]->(b:Screen) WHERE e.via = 'link' RETURN a.id + ' -> ' + b.id AS v",
    ),
  };
}
export function checkProposals(
  facts: GraphFacts,
  agent: AgentName,
  raw: unknown[],
  note: (m: string) => void = () => {},
): {
  valid: ProposalInput[];
  rejected: {
    title: string;
    reason: string;
  }[];
} {
  const valid: ProposalInput[] = [];
  const rejected: {
    title: string;
    reason: string;
  }[] = [];
  for (const item of raw) {
    const title = String(
      (
        item as {
          title?: unknown;
        }
      )?.title ?? 'untitled proposal',
    );
    const parsed = proposalSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({
        title,
        reason: `does not match the proposal schema: ${parsed.error.issues[0]?.message ?? ''}`,
      });
      continue;
    }
    const type = parsed.data.change.type;
    if (!(CHANGE_TYPES as readonly string[]).includes(type)) {
      rejected.push({
        title,
        reason: `change type "${type}" is not in the catalog (${CHANGE_TYPES.join(', ')})`,
      });
      continue;
    }
    const rawParams: Record<string, unknown> = { ...parsed.data.change.params };
    if (type === 'add_link' && Array.isArray(rawParams.to)) rawParams.to = rawParams.to[0];
    if (type === 'remove_links' && typeof rawParams.to === 'string') rawParams.to = [rawParams.to];
    for (const k of Object.keys(rawParams)) if (rawParams[k] === undefined) delete rawParams[k];
    const params = PARAMS[type as ChangeType].safeParse(rawParams);
    if (!params.success) {
      rejected.push({
        title,
        reason: `bad params for ${type}: ${params.error.issues[0]?.message ?? ''}`,
      });
      continue;
    }
    const change = { type: type as ChangeType, params: params.data as Record<string, unknown> };
    const { screens, components } = targetsOf(change);
    const missing = [
      ...screens.filter((s) => !facts.screens.has(s)),
      ...components.filter((c) => !facts.components.has(c)),
    ];
    if (missing.length) {
      rejected.push({ title, reason: `targets not in the graph: ${missing.join(', ')}` });
      continue;
    }
    const p = change.params as {
      from?: string;
      to?: string | string[];
    };
    if (type === 'remove_links') {
      const absent = (p.to as string[]).filter((t) => !facts.edges.has(`${p.from} -> ${t}`));
      if (absent.length) {
        rejected.push({ title, reason: `no link from ${p.from} to ${absent.join(', ')}` });
        continue;
      }
    }
    if (type === 'add_link' && facts.links.has(`${p.from} -> ${p.to}`)) {
      rejected.push({ title, reason: `${p.from} already has a link to ${p.to}` });
      continue;
    }
    const unknownKeys = parsed.data.issue_keys.filter((k) => !facts.issueKeys.has(k));
    if (unknownKeys.length)
      note(`proposal "${title}": dropped unknown issue keys ${unknownKeys.join(', ')}`);
    valid.push({
      agent,
      title: parsed.data.title,
      change,
      rationale: parsed.data.rationale,
      issue_keys: parsed.data.issue_keys.filter((k) => facts.issueKeys.has(k)),
      expected: parsed.data.expected,
    });
  }
  return { valid, rejected };
}
export async function saveProposals(
  graph: string,
  agent: AgentName,
  proposals: ProposalInput[],
): Promise<StoredProposal[]> {
  const w = await openFindingWriter(graph);
  const now = new Date().toISOString();
  const stored: StoredProposal[] = [];
  const seen = new Set<string>();
  for (const p of proposals) {
    const key = proposalKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    const id = proposalId(key);
    await w.write(
      `MERGE (p:Proposal {id: $id})
       ON CREATE SET p.created_at = $now, p.status = 'open'
       SET p.key = $key, p.agent = $agent, p.title = $title, p.change_type = $type,
           p.params = $params, p.rationale = $rationale, p.expected_ux = $ux,
           p.expected_seo = $seo, p.updated_at = $now
       WITH p
       OPTIONAL MATCH (p)-[old:TARGETS|RESOLVES]->()
       DELETE old`,
      {
        id,
        now,
        key,
        agent,
        title: p.title,
        type: p.change.type,
        params: JSON.stringify(p.change.params),
        rationale: p.rationale,
        ux: p.expected.ux,
        seo: p.expected.seo,
      },
    );
    const targets = targetsOf(p.change);
    await w.write(
      `MATCH (p:Proposal {id: $id})
       UNWIND $screens AS sid MATCH (s:Screen {id: sid}) MERGE (p)-[:TARGETS]->(s)`,
      { id, screens: targets.screens },
    );
    if (targets.components.length)
      await w.write(
        `MATCH (p:Proposal {id: $id})
         UNWIND $names AS n MATCH (d:DesignSystemComponent {name: n}) MERGE (p)-[:TARGETS]->(d)`,
        { id, names: targets.components },
      );
    if (p.issue_keys.length)
      await w.write(
        `MATCH (p:Proposal {id: $id})
         UNWIND $keys AS k MATCH (i:Issue {key: k}) MERGE (p)-[:RESOLVES]->(i)`,
        { id, keys: p.issue_keys },
      );
    stored.push({ ...p, id, key, targets, status: 'open' });
  }
  await w.write('MATCH (p:Proposal {agent: $agent}) WHERE NOT p.id IN $ids DETACH DELETE p', {
    agent,
    ids: stored.map((s) => s.id),
  });
  return stored;
}
export async function listProposals(g: ReadOnlyGraph): Promise<StoredProposal[]> {
  const rows = await g.read<{
    p: Record<string, unknown>;
    screens: string[];
    components: string[];
    issues: string[];
  }>(`MATCH (p:Proposal)
     OPTIONAL MATCH (p)-[:TARGETS]->(s:Screen)
     WITH p, collect(DISTINCT s.id) AS screens
     OPTIONAL MATCH (p)-[:TARGETS]->(d:DesignSystemComponent)
     WITH p, screens, collect(DISTINCT d.name) AS components
     OPTIONAL MATCH (p)-[:RESOLVES]->(i:Issue)
     RETURN properties(p) AS p, screens, components, collect(DISTINCT i.key) AS issues`);
  return rows
    .map(({ p, screens, components, issues }) => {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(String(p.params ?? '{}')) as Record<string, unknown>;
      } catch {
        params = {};
      }
      return {
        id: String(p.id),
        key: String(p.key),
        agent: p.agent as AgentName,
        title: String(p.title),
        change: { type: p.change_type as ChangeType, params },
        rationale: String(p.rationale),
        issue_keys: issues.filter(Boolean).sort(),
        expected: {
          ux: p.expected_ux as ProposalInput['expected']['ux'],
          seo: p.expected_seo as ProposalInput['expected']['seo'],
        },
        targets: {
          screens: screens.filter(Boolean).sort(),
          components: components.filter(Boolean),
        },
        status: String(p.status ?? 'open'),
      };
    })
    .sort((a, b) => a.agent.localeCompare(b.agent) || a.key.localeCompare(b.key));
}
