import { closeDb, copyGraph, hasGraph } from '../graph/db.js';
import { runWithContext, systemContext, tenants } from './context.js';
const COPIES: Record<string, string> = { 'acme-shop-v1': 'demo-shop-v1' };
async function main(): Promise<void> {
  for (const t of tenants()) {
    console.log(
      `${t.id} (${t.name}): users ${t.users.map((u) => u.id).join(', ')}; token ${t.dev_token ? 'dev default' : 'from env'}`,
    );
    for (const g of t.graphs) {
      if (await hasGraph(g)) {
        console.log(`  ${g}: exists`);
        continue;
      }
      const src = COPIES[g];
      if (!src) {
        console.log(`  ${g}: missing; crawl it with flowlens-explorer`);
        continue;
      }
      await copyGraph(src, g);
      console.log(`  ${g}: created with GRAPH.COPY ${src} ${g}`);
    }
  }
}
runWithContext(systemContext(), main)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
