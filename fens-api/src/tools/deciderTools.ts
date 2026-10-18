import { z } from 'zod';
import { listProposals, CHANGE_TYPES } from '../agent/proposals.js';
import { lensScores } from '../decider/scores.js';
import { simulate } from '../decider/simulate.js';
import { badRequest, notFound } from '../http/errors.js';
import { defineTool } from './types.js';
export const lensScoresTool = defineTool({
  name: 'lens_scores',
  title: 'UX and SEO lens scores',
  description:
    'Two scores, 100 minus penalties each (floor 0), with the parts behind them. UX: open UX issues by severity, orphans, dead ends, task detour, screens wider than a phone, links on the home page above 12. SEO (ignoring screens robots.txt disallows): open SEO and AEO issues by severity, screens unreachable by links, link depth above 3, JavaScript-only screens, lost semantic tables.',
  input: {},
  async run(g) {
    return { result: await lensScores(g), screens: [], edges: [] };
  },
});
export const simulateChange = defineTool({
  name: 'simulate_change',
  title: 'What-if: simulate a proposed change',
  description:
    'Copies the graph to a temporary sim- graph (GRAPH.COPY), applies one change from the proposal catalog there, and returns both lens scores before and after with per-part deltas and link-depth changes. The copy is always deleted; the crawl graph is never written. Give proposal_id, or change_type with params as a JSON string.',
  input: {
    proposal_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional()
      .describe('A stored Proposal id'),
    change_type: z
      .enum(CHANGE_TYPES)
      .optional()
      .describe('A catalog change type, when there is no proposal_id'),
    params: z
      .string()
      .max(2000)
      .optional()
      .describe('The change params as JSON, e.g. {"screen":"/faq"}'),
  },
  async run(g, args, ctx) {
    let change: {
      type: (typeof CHANGE_TYPES)[number];
      params: Record<string, unknown>;
    };
    if (args.proposal_id) {
      const p = (await listProposals(g)).find((x) => x.id === args.proposal_id);
      if (!p) throw notFound(`Unknown proposal: ${args.proposal_id}`);
      change = p.change;
    } else if (args.change_type) {
      let params: Record<string, unknown>;
      try {
        params = JSON.parse(args.params ?? '{}') as Record<string, unknown>;
      } catch {
        throw badRequest('params must be JSON');
      }
      change = { type: args.change_type, params };
    } else throw badRequest('Give proposal_id, or change_type and params');
    const s = await simulate(ctx.graph, change);
    return {
      result: s,
      screens: [...new Set(s.link_depth.map((d) => d.id))],
      edges: [],
    };
  },
});
