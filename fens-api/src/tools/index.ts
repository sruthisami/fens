import { z } from 'zod';
import { openGraph } from '../graph/db.js';
import { badRequest } from '../http/errors.js';
import {
  betweenness,
  communities,
  compareTask,
  componentFanout,
  findDeadEnds,
  findOrphans,
  issuesByComponent,
  pagerank,
  shortestPath,
} from './graphTools.js';
import { lensScoresTool, simulateChange } from './deciderTools.js';
import { suggestAssigneeTool } from './historyTools.js';
import { iaMismatch, similarScreens, stableCommunities } from './contentTools.js';
import { diffReleases } from './releaseTools.js';
import {
  crawlDepth,
  jsOnlyContent,
  lensSummary,
  checkResults,
  mobileOverflowScreens,
  screenLinks,
  sitemapGaps,
  unreachableByLinks,
} from './seoTools.js';
import type { ToolDef, ToolResult } from './types.js';
export type { ToolDef, ToolResult } from './types.js';
export const TOOLS: ToolDef[] = [
  shortestPath,
  findOrphans,
  findDeadEnds,
  betweenness,
  pagerank,
  communities,
  componentFanout,
  issuesByComponent,
  compareTask,
  diffReleases,
  crawlDepth,
  unreachableByLinks,
  jsOnlyContent,
  mobileOverflowScreens,
  sitemapGaps,
  lensSummary,
  checkResults,
  screenLinks,
  lensScoresTool,
  simulateChange,
  suggestAssigneeTool,
  similarScreens,
  iaMismatch,
  stableCommunities,
] as unknown as ToolDef[];
export const GRAPH_NAME = /^[a-z0-9][a-z0-9_-]*$/;
export const graphArg = z
  .string()
  .max(64)
  .regex(GRAPH_NAME, 'graph names are lowercase letters, digits, "-" and "_"')
  .describe('Crawl graph name, e.g. "demo-shop-v1"');
export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
export async function runTool(tool: ToolDef, graph: string, rawArgs: unknown): Promise<ToolResult> {
  const name = graphArg.safeParse(graph);
  if (!name.success) throw badRequest(z.prettifyError(name.error));
  const args = z
    .object(tool.input)
    .strict()
    .safeParse(rawArgs ?? {});
  if (!args.success) throw badRequest(z.prettifyError(args.error));
  const g = await openGraph(name.data);
  const out = await tool.run(g, args.data as never, { graph: name.data });
  return { tool: tool.name, graph: name.data, ...out };
}
