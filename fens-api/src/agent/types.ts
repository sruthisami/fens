import type { Comparison } from './compare.js';
import { z } from 'zod';
export const SEVERITIES = ['high', 'medium', 'low'] as const;
export const CATEGORIES = [
  'flow',
  'structure',
  'component',
  'accessibility',
  'content',
  'seo',
  'aeo',
] as const;
export const AGENTS = ['ux', 'seo'] as const;
export type AgentName = (typeof AGENTS)[number];
export const AGENT_CHOICES = ['ux', 'seo', 'both'] as const;
export type AgentChoice = (typeof AGENT_CHOICES)[number];
export const MODES = ['llm', 'rules', 'replay'] as const;
export type Mode = (typeof MODES)[number];
export const ORIGINS = ['rules', 'ai', 'ai-enriched'] as const;
export type FindingOrigin = (typeof ORIGINS)[number];
export const evidenceSchema = z.object({
  tool: z.string().min(1).max(64).describe('Name of the tool whose result supports this'),
  args: z
    .record(z.string(), z.unknown())
    .default({})
    .describe('Arguments that tool was called with'),
  screens: z
    .array(z.string().max(512))
    .max(200)
    .default([])
    .describe('Screen ids from that result'),
  path: z
    .array(z.string().max(512))
    .max(100)
    .default([])
    .describe('Ordered screen ids of a path, when the evidence is a path'),
});
export const findingSchema = z.object({
  title: z.string().min(3).max(200),
  severity: z.enum(SEVERITIES).describe('high, medium or low, by how many users are affected'),
  category: z.enum(CATEGORIES),
  explanation: z
    .string()
    .min(10)
    .max(3000)
    .describe('What is wrong and why it matters, citing tool results'),
  evidence: z.array(evidenceSchema).min(1).max(10),
  recommendation: z.string().min(5).max(2000),
  target: z.object({
    type: z.enum(['screen', 'component', 'task']),
    id: z.string().min(1).max(200).describe('Screen id, design system component name or task id'),
  }),
  rule_id: z.string().optional().describe('Rule id if based on a check or baseline finding'),
  replaces_keys: z
    .array(z.string())
    .optional()
    .describe('Keys of baseline findings this replaces or merges'),
});
export const submitSchema = z.object({ findings: z.array(findingSchema).max(20) });
export type { ProposalInput, StoredProposal } from './proposals.js';
export type Evidence = z.infer<typeof evidenceSchema>;
export type FindingInput = z.infer<typeof findingSchema> & {
  rule_id?: string;
  issue_ids?: string[];
  origin?: FindingOrigin;
  agent?: AgentName;
};
export interface StoredFinding extends FindingInput {
  id: string;
  key: string;
  mode: Mode;
  origin: FindingOrigin;
}
export type AgentEvent =
  | {
      type: 'start';
      graph: string;
      mode: Mode;
      agent?: AgentChoice;
      started_at: string;
      replay_of?: string;
    }
  | {
      type: 'agent';
      agent: AgentName;
    }
  | {
      type: 'note';
      message: string;
    }
  | {
      type: 'tool_call';
      n: number;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      n: number;
      tool: string;
      ok: boolean;
      summary: string;
    }
  | {
      type: 'finding';
      finding: StoredFinding;
    }
  | {
      type: 'rejected';
      title: string;
      reason: string;
    }
  | {
      type: 'proposal';
      proposal: import('./proposals.js').StoredProposal;
    }
  | {
      type: 'proposal_rejected';
      agent: AgentName;
      title: string;
      reason: string;
    }
  | {
      type: 'comparison';
      comparison: Comparison;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'done';
      mode: Mode;
      findings: number;
      proposals?: number;
      rejected: number;
      tool_calls: number;
      ms: number;
      stopped?: string;
    };
