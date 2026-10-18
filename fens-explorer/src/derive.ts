import { parseArgs } from 'node:util';
import { GRAPH_NAME } from './cli/args.js';
import { connect } from './graph/client.js';
import { derive } from './graph/derive.js';
async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { graph: { type: 'string' } },
  });
  const name = values.graph;
  if (!name || !GRAPH_NAME.test(name)) {
    throw new Error('Usage: npm run derive -- --graph <name>');
  }
  const db = await connect();
  try {
    if (!(await db.list()).includes(name)) throw new Error(`Graph ${name} does not exist.`);
    const r = await derive(db, name);
    console.log(
      `Derived ${name}: ${r.edges} NAVIGATES_TO edges, ${r.shared} shared, ${r.flows} FLOWS_TO edges (${r.promoted.length} promoted: ${r.promoted.join(', ') || 'none'}), ${r.removedFlows} stale FLOWS_TO removed`,
    );
    console.log(
      `Crawlable: ${r.hrefs} HREF_TO edges; not reachable by links from the start: ${r.unreachableByLinks.join(', ') || 'none'}`,
    );
  } finally {
    await db.close();
  }
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
