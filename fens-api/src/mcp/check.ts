import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { tenantContext } from '../tenancy/context.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const GRAPH = 'demo-shop-v1';
interface ToolInfo {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
  };
  annotations?: {
    readOnlyHint?: boolean;
  };
}
function text(result: unknown): string {
  const content =
    (
      result as {
        content?: {
          type: string;
          text?: string;
        }[];
      }
    ).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}
async function open(name: string, script: string): Promise<Client> {
  const client = new Client({ name: `flowlens-check-${name}`, version: '0.1.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve('dist/mcp', script)],
      env: {
        ...(process.env as Record<string, string>),
        FLOWLENS_TENANT_TOKEN:
          process.env.FLOWLENS_TENANT_TOKEN ?? tenantContext('fence-team').tenant.token,
        FLOWLENS_USER: process.env.FLOWLENS_USER ?? 'ana',
      },
      stderr: 'ignore',
    }),
  );
  return client;
}
async function main(): Promise<void> {
  const ours = await open('flowlens', 'stdio.js');
  const official = await open('falkordb', 'falkordb.js');
  try {
    const ourTools = (await ours.listTools()).tools as ToolInfo[];
    const officialTools = (await official.listTools()).tools as ToolInfo[];
    console.log(
      `FlowLens MCP: ${ourTools.length} tools: ${ourTools.map((t) => t.name).join(', ')}`,
    );
    console.log(
      `FalkorDB MCP: ${officialTools.length} tools: ${officialTools
        .map((t) => `${t.name}(${Object.keys(t.inputSchema?.properties ?? {}).join(', ')})`)
        .join(', ')}`,
    );
    const graphs = await official.callTool({ name: 'list_graphs', arguments: {} });
    console.log(`\nofficial list_graphs -> ${text(graphs).replace(/\s+/g, ' ').slice(0, 300)}`);
    const schemaTool = officialTools.find((t) => t.name === 'get_graph_schema');
    const graphParam =
      Object.keys(schemaTool?.inputSchema?.properties ?? {}).find((k) => /graph/i.test(k)) ??
      'graphName';
    const schema = await official.callTool({
      name: 'get_graph_schema',
      arguments: { [graphParam]: GRAPH },
    });
    console.log(
      `official get_graph_schema(${graphParam}=${GRAPH}) -> ${text(schema).replace(/\s+/g, ' ').slice(0, 600)}`,
    );
    const path = await ours.callTool({
      name: 'shortest_path',
      arguments: { graph: GRAPH, from: '/', to: '/checkout/confirmation' },
    });
    const parsed = JSON.parse(text(path)) as {
      result: {
        length: number;
        steps: {
          from: string;
          to: string;
          action: string;
        }[];
      };
    };
    console.log(
      `\nflowlens shortest_path(/ -> /checkout/confirmation) -> ${parsed.result.length} steps: ${parsed.result.steps
        .map((s) => `${s.from} --"${s.action}"--> ${s.to}`)
        .join(', ')}`,
    );
  } finally {
    await ours.close();
    await official.close();
  }
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
