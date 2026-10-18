import { FunctionCallingConfigMode, GoogleGenAI, type Content, type Part } from '@google/genai';
import { z } from 'zod';
import { env } from '../config/env.js';
import { toModelSchema, type ToolRouter } from './router.js';
import { findingKey } from './store.js';
import type { AgentDef } from './agents.js';
import { submitProposalsSchema } from './proposals.js';
import { submitSchema, type FindingInput } from './types.js';
export const LIMITS = { toolCalls: 12, ms: 90000 };
const MAX_RESULT_CHARS = 8000;
const RETRYABLE = /"code":\s*(503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED/;
const RETRY_WAITS_MS = [2000, 5000, 10000];
export interface LlmOutcome {
  findings: unknown[];
  proposals: unknown[];
  stopped?: string;
}
export async function runLlm(
  agent: AgentDef,
  router: ToolRouter,
  call: (tool: string, args?: Record<string, unknown>) => Promise<unknown>,
  counter: () => number,
  note: (message: string) => void = () => {},
  baseline: FindingInput[] = [],
  baselineProposals: unknown[] = [],
): Promise<LlmOutcome> {
  if (process.env.FLOWLENS_MOCK_LLM === 'true') {
    note('Running with mocked LLM review response');
    return runMockLlm(agent, baseline, baselineProposals, call);
  }
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set in fens-api/.env');
  if (!env.GEMINI_MODEL) throw new Error('GEMINI_MODEL is not set in fens-api/.env');
  let model = env.GEMINI_MODEL;
  const fallback = env.GEMINI_FALLBACK_MODEL;
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const declarations = [
    ...router.tools().map((t) => ({
      name: t.name,
      description: t.description ?? t.name,
      parametersJsonSchema: t.inputSchema,
    })),
    {
      name: 'submit_findings',
      description: 'Submit the final, evidenced findings. Call exactly once, at the end.',
      parametersJsonSchema: toModelSchema(z.toJSONSchema(submitSchema)),
    },
    {
      name: 'submit_proposals',
      description:
        'Submit the proposed changes, each one type from the fixed catalog. Call exactly once, at the end.',
      parametersJsonSchema: toModelSchema(z.toJSONSchema(submitProposalsSchema)),
    },
  ];
  const deadline = Date.now() + LIMITS.ms;
  const baselineSummary = baseline.map((b) => ({
    key: findingKey(b),
    category: b.category,
    target: b.target,
    rule_id: b.rule_id,
    severity: b.severity,
    title: b.title,
    explanation: b.explanation,
    recommendation: b.recommendation,
    evidence: b.evidence,
  }));
  const userPrompt = `Investigate the crawl graph "${router.graph}" as the ${agent.title}.\n\nA rule-based pre-scan found ${baseline.length} baseline findings:\n${JSON.stringify(baselineSummary, null, 2)}\n\nand ${baselineProposals.length} baseline proposals:\n${JSON.stringify(baselineProposals, null, 2)}\n\nReview them: you may adjust severity, rewrite explanations, recommendations and rationales, merge duplicates, and add findings and proposals supported by tool evidence. Call tools to inspect the graph as needed, then finish by calling submit_findings and submit_proposals.`;
  const contents: Content[] = [
    {
      role: 'user',
      parts: [{ text: userPrompt }],
    },
  ];
  let findings: unknown[] | null = null;
  let proposals: unknown[] | null = null;
  const outcome = (stopped?: string): LlmOutcome => ({
    findings: findings ?? [],
    proposals: proposals ?? [],
    ...(stopped ? { stopped } : {}),
  });
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return outcome('time limit reached before both submit calls');
    const pending: string[] = [
      ...(findings === null ? ['submit_findings'] : []),
      ...(proposals === null ? ['submit_proposals'] : []),
    ];
    const mustSubmit = counter() >= LIMITS.toolCalls || remaining < 15000 || pending.length < 2;
    const request = () =>
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: agent.systemPrompt,
          tools: [{ functionDeclarations: declarations }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              ...(mustSubmit ? { allowedFunctionNames: pending } : {}),
            },
          },
          abortSignal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
        },
      });
    let response: Awaited<ReturnType<typeof request>> | null = null;
    for (let attempt = 0; response === null; attempt++) {
      try {
        response = await request();
      } catch (err) {
        const wait = RETRY_WAITS_MS[attempt];
        const message = (err as Error).message;
        if (!RETRYABLE.test(message)) throw err;
        if (wait === undefined || Date.now() + wait > deadline - 5000) {
          if (fallback && model !== fallback) {
            note(`${model} is still busy; switching to the fallback model ${fallback}`);
            model = fallback;
            attempt = -1;
            continue;
          }
          throw err;
        }
        note(
          `Gemini is busy (${message.includes('429') ? 'rate limit' : 'overloaded'}); retrying in ${wait / 1000} s`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return outcome('the model returned no function call');
    contents.push(
      response.candidates?.[0]?.content ?? {
        role: 'model',
        parts: calls.map((c) => ({ functionCall: c })),
      },
    );
    const replies: Part[] = [];
    for (const fc of calls) {
      const name = fc.name ?? '';
      if (name === 'submit_findings' || name === 'submit_proposals') {
        if (name === 'submit_findings')
          findings = (
            (
              fc.args as
                | {
                    findings?: unknown[];
                  }
                | undefined
            )?.findings ?? []
          ).slice(0, 20);
        else
          proposals = (
            (
              fc.args as
                | {
                    proposals?: unknown[];
                  }
                | undefined
            )?.proposals ?? []
          ).slice(0, 10);
        replies.push({ functionResponse: { id: fc.id, name, response: { output: 'received' } } });
        continue;
      }
      let response: Record<string, unknown>;
      if (counter() >= LIMITS.toolCalls) {
        response = { error: 'Tool budget used up. Call submit_findings now.' };
      } else {
        try {
          const out = await call(name, (fc.args as Record<string, unknown>) ?? {});
          const text = JSON.stringify(out);
          response = {
            output:
              text.length > MAX_RESULT_CHARS
                ? `${text.slice(0, MAX_RESULT_CHARS)}...(truncated)`
                : out,
          };
        } catch (err) {
          response = { error: (err as Error).message };
        }
      }
      replies.push({ functionResponse: { id: fc.id, name, response } });
    }
    if (findings !== null && proposals !== null) return outcome();
    contents.push({ role: 'user', parts: replies });
  }
}
async function runMockLlm(
  agent: AgentDef,
  baseline: FindingInput[],
  baselineProposals: unknown[],
  call: (tool: string, args?: Record<string, unknown>) => Promise<unknown>,
): Promise<LlmOutcome> {
  const outside = {
    title: 'Hide the size table on phones',
    change: { type: 'hide_on_mobile', params: { screen: '/size-guide' } },
    rationale: 'Mock model: a change type that is not in the catalog.',
    issue_keys: [],
    expected: { ux: 'improves', seo: 'worsens' },
  };
  if (agent.name === 'seo') {
    await call('crawl_depth');
    return { findings: [], proposals: [...baselineProposals, outside] };
  }
  await call('betweenness', { edge_set: 'flow', top: 3 });
  const reviewed: FindingInput[] = [];
  for (const b of baseline) {
    if (b.target.type === 'component' && b.target.id === 'SignInButton') {
      const allScreens = b.evidence[0]?.screens ?? [];
      reviewed.push({
        ...b,
        severity: 'high',
        explanation: `AI Review: The SignInButton component has severe color contrast issues across ${allScreens.length} screens. Users with low vision cannot read the Sign In button.`,
        recommendation: `AI Recommendation: Update SignInButton background color to #c62f1e to achieve at least 4.5:1 contrast ratio.`,
        evidence: [
          {
            tool: 'component_fanout',
            args: { component: 'SignInButton' },
            screens: allScreens,
            path: allScreens,
          },
        ],
      });
    } else if (b.target.type === 'task') {
      reviewed.push({
        ...b,
        title: `Task "${b.target.id}" has an unnecessary detour`,
        explanation: `AI Review: The user checkout journey forces 10 clicks when a 3-click shortcut is available.`,
        recommendation: `AI Recommendation: Streamline the checkout funnel by merging shipping and address steps.`,
      });
    } else if (b.target.type === 'screen' && b.target.id === '/reset-sent') {
      reviewed.push({
        ...b,
        explanation: `AI Review: /reset-sent traps users with 0 outbound links. Back button is the only exit.`,
        recommendation: `AI Recommendation: Include the global header and footer on /reset-sent.`,
      });
    }
  }
  reviewed.push({
    title: 'Screen /accessories has product categorization issues',
    severity: 'low',
    category: 'content',
    explanation:
      'The accessories category page primarily displays bag items rather than accessory items.',
    recommendation:
      'Update product categorization so that /accessories shows belts and scarves instead of tote bags.',
    target: { type: 'screen', id: '/accessories' },
    evidence: [
      {
        tool: 'shortest_path',
        args: { from: '/', to: '/accessories', edge_set: 'all' },
        screens: ['/', '/accessories'],
        path: ['/', '/accessories'],
      },
    ],
  });
  return { findings: reviewed, proposals: [...baselineProposals, outside] };
}
