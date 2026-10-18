import { MEMORY_TOOL_NAMES } from '../mcp/memoryTools.js';
import { LIMITS } from './llm.js';
import { CHANGE_TYPES } from './proposals.js';
import type { Toolset, ToolRouter } from './router.js';
import { runRules } from './rules.js';
import { seoRules, uxProposals } from './proposalRules.js';
import { checkFindings } from './checkRules.js';
import type { AgentName, FindingInput } from './types.js';
type Call = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
export interface AgentDef {
  name: AgentName;
  title: string;
  systemPrompt: string;
  toolset: Toolset;
  rules: (
    router: ToolRouter,
    call: Call,
  ) => Promise<{
    findings: FindingInput[];
    proposals: unknown[];
  }>;
}
const CATALOG = `Proposals must use one change type from this fixed catalog; anything else is rejected:
- table_to_cards { screen, component? }: replace a table with div cards (has_table and mobile_overflow become false)
- table_responsive { screen, component? }: keep the semantic table, stack it as cards on mobile with CSS (has_table stays true, mobile_overflow becomes false)
- content_in_html { screen, component? }: put hidden answers in the HTML with details/summary (js_only_ratio becomes 0)
- remove_links { from, to: [screens] }: remove those links from a screen
- add_link { from, to, label, via: "link" }: add a plain link
Each proposal gives a title, the change, a rationale citing tool results, the Issue keys it resolves, and the expected effect on each lens (ux and seo: improves, neutral or worsens).`;
const SHARED = `In this hybrid investigation, rules mode has already produced baseline findings and proposals. Review and enrich them:
- You may adjust severity, rewrite explanations and recommendations, merge duplicates, and add findings or proposals supported by tool evidence.
- Every finding needs evidence from tools: tool name, arguments, and screens/path. A path must be a real walk of linked screens.
- Baseline findings and proposals you do not resubmit are kept as they are by the server.
- You have at most ${LIMITS.toolCalls} tool calls. Finish by calling submit_findings once and submit_proposals once.
- Memory: the user's preferences and the team's facts were recalled at the start of this run (get_preferences, recall; see the notes). Cite the fact ids you rely on. A preference such as "do not flag heading-order" does not remove a finding: keep reporting it, the view marks it as suppressed by that preference.

${CATALOG}`;
const UX_TOOLS = [
  'shortest_path',
  'find_orphans',
  'find_dead_ends',
  'betweenness',
  'pagerank',
  'communities',
  'component_fanout',
  'issues_by_component',
  'compare_task',
  'diff_releases',
  'screen_links',
  'mobile_overflow_screens',
  'ia_mismatch',
  'similar_screens',
  'check_results',
  ...MEMORY_TOOL_NAMES,
];
const SEO_TOOLS = [
  'crawl_depth',
  'unreachable_by_links',
  'js_only_content',
  'mobile_overflow_screens',
  'sitemap_gaps',
  'lens_summary',
  'check_results',
  'screen_links',
  'shortest_path',
  'find_orphans',
  'issues_by_component',
  'component_fanout',
  'diff_releases',
  ...MEMORY_TOOL_NAMES,
];
export const AGENT_DEFS: Record<AgentName, AgentDef> = {
  ux: {
    name: 'ux',
    title: 'UX agent',
    systemPrompt: `You are the FlowLens UX agent. You investigate one crawled web app, stored as a graph: screens are nodes, clicks are edges, and check results are Issue nodes linked to guidelines of the UX, SEO and AEO lenses. You judge usability and accessibility: journeys, structure, components, reflow on phones, choice overload.\n\n${SHARED}`,
    toolset: { ours: UX_TOOLS, official: true },
    rules: async (router, call) => {
      const findings = await runRules(router, call);
      const ux = await uxProposals(call);
      const all = [...findings, ...ux.findings];
      return {
        findings: [...all, ...(await checkFindings(call, 'ux', all))],
        proposals: ux.proposals,
      };
    },
  },
  seo: {
    name: 'seo',
    title: 'SEO agent',
    systemPrompt: `You are the FlowLens SEO agent. You investigate one crawled web app, stored as a graph, for search engines and answer engines (SEO and AEO): what a crawler without JavaScript can reach by plain links (HREF_TO, link_depth), content that exists only after JavaScript, structured data, the sitemap and robots.txt, and the guideline conflicts with UX. Screens robots.txt disallows are not meant to be indexed.\n\n${SHARED}`,
    toolset: { ours: SEO_TOOLS, official: false },
    rules: async (_router, call) => {
      const seo = await seoRules(call);
      return {
        ...seo,
        findings: [...seo.findings, ...(await checkFindings(call, 'seo', seo.findings))],
      };
    },
  },
};
export const agentsFor = (choice: AgentName | 'both'): AgentDef[] =>
  choice === 'both' ? [AGENT_DEFS.ux, AGENT_DEFS.seo] : [AGENT_DEFS[choice]];
export { CHANGE_TYPES };
