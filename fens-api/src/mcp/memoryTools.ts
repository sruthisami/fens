import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getPreferences,
  recall,
  recallEpisodes,
  rememberFact,
  EPISODE_TYPES,
} from '../memory/memory.js';
import { AGENT_NAMES, claimHandoff, completeHandoff, listHandoffs } from '../coord/handoffs.js';
import { runWithContext, type Ctx } from '../tenancy/context.js';
export const MEMORY_TOOL_NAMES = [
  'remember_fact',
  'recall',
  'recall_episodes',
  'get_preferences',
] as const;
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });
const fail = (err: unknown) => ({
  isError: true,
  content: [
    { type: 'text' as const, text: err instanceof Error ? err.message : 'Memory tool failed' },
  ],
});
export function registerMemoryTools(server: McpServer, ctx: Ctx): void {
  const run = (fn: () => Promise<unknown>) => runWithContext(ctx, fn).then(text, fail);
  server.registerTool(
    'remember_fact',
    {
      title: 'Remember a fact',
      description:
        'Store a fact (team memory) or a user preference (kind "preference", the user\'s memory) as subject, predicate, object. A fact that contradicts a current one (same subject and predicate, another object) supersedes it; the old one is kept as history.',
      inputSchema: {
        subject: z
          .string()
          .min(1)
          .max(200)
          .describe('What it is about, e.g. "component:SignInButton" or "rule:heading-order"'),
        predicate: z
          .string()
          .min(1)
          .max(200)
          .describe('e.g. "has color-contrast finding" or "flag"'),
        object: z.string().min(1).max(500).describe('e.g. "fixed in demo-shop-v2" or "no"'),
        kind: z.enum(['fact', 'preference']).optional(),
        confidence: z.number().min(0).max(1).optional(),
      },
    },
    async (args) => run(() => rememberFact(ctx, args)),
  );
  server.registerTool(
    'recall',
    {
      title: 'Recall facts',
      description:
        'Facts from team and user memory by exact subject or by keyword (in subject, predicate or object). Only current facts unless include_history is true; history shows what superseded what.',
      inputSchema: {
        subject: z.string().max(200).optional(),
        keyword: z.string().max(100).optional(),
        include_history: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => run(async () => ({ facts: await recall(ctx, args) })),
  );
  server.registerTool(
    'recall_episodes',
    {
      title: 'Recall episodes',
      description:
        'Past runs, decisions, release comparisons, handoffs and chat sessions of this team, newest first.',
      inputSchema: {
        agent: z.string().max(64).optional(),
        type: z.enum(EPISODE_TYPES).optional(),
        since: z.string().max(40).optional().describe('ISO time'),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) =>
      run(async () => ({ episodes: await recallEpisodes(ctx, { ...args, scope: 'both' }) })),
  );
  server.registerTool(
    'get_preferences',
    {
      title: 'Get preferences',
      description:
        "The current user's preferences, e.g. a rule they asked not to be flagged. Respect and cite them.",
      inputSchema: {},
    },
    async () => run(async () => ({ preferences: await getPreferences(ctx) })),
  );
  const claimer = `mcp:${ctx.user.id}`;
  server.registerTool(
    'list_handoffs',
    {
      title: 'List handoffs',
      description:
        "This team's handoffs between agents, newest first, optionally by status or receiving agent.",
      inputSchema: {
        status: z.enum(['pending', 'claimed', 'done', 'failed']).optional(),
        to_agent: z.enum(AGENT_NAMES).optional(),
        run_id: z.string().max(64).optional(),
      },
    },
    async (args) => run(async () => ({ handoffs: await listHandoffs(ctx, args) })),
  );
  server.registerTool(
    'claim_handoff',
    {
      title: 'Claim a handoff',
      description:
        'Claims the oldest pending handoff for an agent. Returns it with its version, or null when none is pending.',
      inputSchema: { agent: z.enum(AGENT_NAMES) },
    },
    async ({ agent }) => run(async () => ({ handoff: await claimHandoff(ctx, agent, claimer) })),
  );
  server.registerTool(
    'complete_handoff',
    {
      title: 'Complete a handoff',
      description:
        'Marks a handoff you claimed as done. Pass the version claim_handoff returned; a stale claim is refused.',
      inputSchema: {
        id: z.string().max(200),
        version: z.number().int().min(1),
        result: z.string().max(2000).optional(),
      },
    },
    async ({ id, version, result }) =>
      run(async () => {
        const h = await completeHandoff(ctx, id, claimer, version, result ?? '');
        if (!h)
          throw new Error('Not completed: the handoff is not claimed by you at that version.');
        return { handoff: h };
      }),
  );
}
