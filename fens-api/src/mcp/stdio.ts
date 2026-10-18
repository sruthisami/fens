import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeDb } from '../graph/db.js';
import { resolveContext } from '../tenancy/context.js';
import { createFlowLensMcpServer } from './server.js';
let ctx;
try {
  ctx = resolveContext(process.env.FLOWLENS_TENANT_TOKEN, process.env.FLOWLENS_USER);
} catch (err) {
  console.error(
    `flowlens MCP server: set FLOWLENS_TENANT_TOKEN and FLOWLENS_USER (${(err as Error).message})`,
  );
  process.exit(1);
}
const server = createFlowLensMcpServer(ctx);
await server.connect(new StdioServerTransport());
console.error('flowlens MCP server ready on stdio');
const shutdown = async () => {
  await server.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
