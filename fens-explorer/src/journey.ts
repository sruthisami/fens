import { parseArgs } from 'node:util';
import { GRAPH_NAME } from './cli/args.js';
import { connect } from './graph/client.js';
import { runTasks } from './journey/index.js';
async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { graph: { type: 'string' }, file: { type: 'string' } },
  });
  const name = values.graph;
  if (!name || !GRAPH_NAME.test(name) || !values.file) {
    throw new Error('Usage: npm run journey -- --graph <name> --file <tasks file>');
  }
  const db = await connect();
  try {
    if (!(await db.list()).includes(name)) throw new Error(`Graph ${name} does not exist.`);
    console.log(`Replaying tasks from ${values.file} on ${name}`);
    const results = await runTasks(db, name, values.file, (m) => console.log(m));
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  } finally {
    await db.close();
  }
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
