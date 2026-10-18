import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HttpError } from '../http/errors.js';
import { runWithContext, type Ctx } from '../tenancy/context.js';
import { registerMemoryTools } from './memoryTools.js';
import { graphArg, runTool, TOOLS } from '../tools/index.js';
export function createFlowLensMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: 'flowlens', version: '0.1.0' });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: { graph: graphArg, ...tool.input },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        const { graph, ...rest } = args;
        try {
          const out = await runWithContext(ctx, () => runTool(tool, String(graph ?? ''), rest));
          return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
        } catch (err) {
          const message =
            err instanceof HttpError ? err.message : 'Internal error while running the tool';
          if (!(err instanceof HttpError)) console.error(err);
          return { isError: true, content: [{ type: 'text' as const, text: message }] };
        }
      },
    );
  }
  if (!ctx.system) registerMemoryTools(server, ctx);
  return server;
}
