import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowLensMcpServer } from '../mcp/server.js';
import { assertGraphAccess, currentContext, type Ctx } from '../tenancy/context.js';
export const OFFICIAL_ALLOWLIST = [
  'get_graph_schema',
  'get_node_schema',
  'get_relationship_schema',
  'query_graph_readonly',
] as const;
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface McpClientLike {
  listTools(): Promise<{
    tools: ToolInfo[];
  }>;
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}
export class ToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`Tool "${tool}" is not allowed for the agent`);
  }
}
export class ToolCallError extends Error {}
export class GraphNotAllowedError extends Error {
  constructor(readonly graph: string) {
    super(`Graph "${graph}" is not available to this agent`);
  }
}
const GRAPH_ARGS = ['graph', 'graphName'];
function withoutGraphParam(
  schema: Record<string, unknown>,
  param: string,
): Record<string, unknown> {
  const props = { ...((schema.properties as Record<string, unknown>) ?? {}) };
  delete props[param];
  const required = ((schema.required as string[]) ?? []).filter((r) => r !== param);
  return { ...schema, properties: props, required };
}
export function toModelSchema(schema: unknown): Record<string, unknown> {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean).filter((v) => v !== undefined);
    if (!node || typeof node !== 'object') return node;
    const obj = node as Record<string, unknown>;
    if ('$ref' in obj) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const unsupported = ['$schema', '$id', 'definitions', '$defs', 'propertyNames', 'default'];
      if ([...unsupported, 'minItems', 'maxItems'].includes(k)) continue;
      if (k === 'format' && !['date-time', 'date', 'time', 'enum'].includes(String(v))) continue;
      if (
        k === 'additionalProperties' &&
        v &&
        typeof v === 'object' &&
        Object.keys(v).length === 0
      ) {
        continue;
      }
      const c = clean(v);
      if (c !== undefined) out[k] = c;
    }
    if (out.type === 'object' && !('properties' in out)) out.properties = {};
    return out;
  };
  return (clean(schema) as Record<string, unknown>) ?? { type: 'object' };
}
function parseResult(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    content?: {
      type: string;
      text?: string;
    }[];
  };
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (r.isError) throw new ToolCallError(text || 'Tool returned an error');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
export interface Toolset {
  ours: readonly string[] | null;
  official: boolean;
}
const ALL_TOOLS: Toolset = { ours: null, official: true };
export class ToolRouter {
  private ourTools: ToolInfo[] = [];
  private officialTools: ToolInfo[] = [];
  constructor(
    private readonly ours: McpClientLike,
    private readonly official: McpClientLike | null,
    readonly graph: string,
    private readonly toolset: Toolset = ALL_TOOLS,
    private readonly ctx: Ctx = currentContext(),
  ) {
    assertGraphAccess(graph, ctx);
  }
  static async open(
    graph: string,
    note: (m: string) => void = () => {},
    toolset: Toolset = ALL_TOOLS,
    ctx: Ctx = currentContext(),
  ): Promise<ToolRouter> {
    assertGraphAccess(graph, ctx);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createFlowLensMcpServer(ctx).connect(serverSide);
    const ours = new Client({ name: 'flowlens-agent', version: '0.1.0' });
    await ours.connect(clientSide);
    let official: Client | null = null;
    if (toolset.official)
      try {
        official = new Client({ name: 'flowlens-agent-falkordb', version: '0.1.0' });
        await official.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [resolve('dist/mcp/falkordb.js')],
            env: process.env as Record<string, string>,
            stderr: 'ignore',
          }),
        );
      } catch (err) {
        official = null;
        note(
          `FalkorDB MCP server unavailable (${(err as Error).message}); continuing with FlowLens tools only`,
        );
      }
    const router = new ToolRouter(
      ours as unknown as McpClientLike,
      official as unknown as McpClientLike | null,
      graph,
      toolset,
      ctx,
    );
    await router.load();
    return router;
  }
  async load(): Promise<void> {
    const allowed = this.toolset.ours;
    this.ourTools = (await this.ours.listTools()).tools.filter(
      (t) => !allowed || allowed.includes(t.name),
    );
    const officialAll =
      this.official && this.toolset.official ? (await this.official.listTools()).tools : [];
    this.officialTools = officialAll.filter((t) =>
      (OFFICIAL_ALLOWLIST as readonly string[]).includes(t.name),
    );
  }
  tools(): ToolInfo[] {
    return [
      ...this.ourTools.map((t) => ({
        ...t,
        inputSchema: toModelSchema(withoutGraphParam(t.inputSchema, 'graph')),
      })),
      ...this.officialTools.map((t) => ({
        ...t,
        inputSchema: toModelSchema(withoutGraphParam(t.inputSchema, 'graphName')),
      })),
    ];
  }
  has(name: string): boolean {
    return (
      this.ourTools.some((t) => t.name === name) || this.officialTools.some((t) => t.name === name)
    );
  }
  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    for (const k of GRAPH_ARGS) {
      const g = args[k];
      if (g !== undefined && g !== this.graph) throw new GraphNotAllowedError(String(g));
    }
    assertGraphAccess(this.graph, this.ctx);
    if (this.ourTools.some((t) => t.name === name)) {
      return parseResult(
        await this.ours.callTool({ name, arguments: { ...args, graph: this.graph } }),
      );
    }
    const allowed = (OFFICIAL_ALLOWLIST as readonly string[]).includes(name);
    if (allowed && this.official && this.officialTools.some((t) => t.name === name)) {
      return parseResult(
        await this.official.callTool({ name, arguments: { ...args, graphName: this.graph } }),
      );
    }
    throw new ToolNotAllowedError(name);
  }
  async close(): Promise<void> {
    await this.ours.close().catch(() => {});
    await this.official?.close().catch(() => {});
  }
}
