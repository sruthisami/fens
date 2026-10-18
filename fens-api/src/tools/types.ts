import { z } from 'zod';
import type { ReadOnlyGraph } from '../graph/db.js';
export const edgeSet = z
  .enum(['all', 'flow', 'href'])
  .describe(
    '"all" = every link and button (NAVIGATES_TO). "flow" = without shared header/footer links (FLOWS_TO), better for structure. "href" = plain <a href> links only (HREF_TO), what a crawler without JavaScript can follow.',
  );
export const REL = { all: 'NAVIGATES_TO', flow: 'FLOWS_TO', href: 'HREF_TO' } as const;
export type EdgeSet = z.infer<typeof edgeSet>;
export const screenId = z
  .string()
  .regex(/^\//, 'screen ids are paths that start with "/"')
  .max(512)
  .describe('Screen id: the normalised path, e.g. "/" or "/checkout/confirmation"');
export const topN = z.coerce
  .number()
  .int()
  .min(1)
  .max(50)
  .describe('How many screens to return, 1-50');
export interface ToolResult<R = unknown> {
  tool: string;
  graph: string;
  result: R;
  screens: string[];
  edges: string[];
}
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  run: (
    g: ReadOnlyGraph,
    args: z.infer<z.ZodObject<S>>,
    ctx: {
      graph: string;
    },
  ) => Promise<Omit<ToolResult, 'tool' | 'graph'>>;
}
export const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> => def;
export const edgeId = (from: string, to: string) => `${from} -> ${to}`;
