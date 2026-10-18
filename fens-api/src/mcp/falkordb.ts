import { spawn } from 'node:child_process';
import { env } from '../config/env.js';
const url = new URL(env.FALKORDB_URL);
const child = spawn('npx', ['-y', '@falkordb/mcpserver'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    MCP_TRANSPORT: 'stdio',
    FALKORDB_HOST: url.hostname,
    FALKORDB_PORT: url.port || '6379',
    FALKORDB_DEFAULT_READONLY: 'true',
    ...(url.username ? { FALKORDB_USERNAME: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { FALKORDB_PASSWORD: decodeURIComponent(url.password) } : {}),
  },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
