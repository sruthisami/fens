import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { closeDb } from '../graph/db.js';
import { runWithContext, tenantContext } from '../tenancy/context.js';
import { claimHandoff, completeHandoff, failHandoff, reapExpired } from './handoffs.js';
import { handle, recordHandoffEpisode } from './pipeline.js';
const WORKER_AGENTS = ['ux', 'seo', 'decider', 'channels', 'closer'];
const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    agent: { type: 'string' },
    tenant: { type: 'string', default: 'fence-team' },
    all: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    'hold-ms': { type: 'string', default: '0' },
    'poll-ms': { type: 'string', default: '500' },
  },
});
const log = (agent: string, m: string) =>
  console.log(`${new Date().toISOString()} [${agent}] ${m}`);
async function loop(agent: string): Promise<void> {
  const claimer = `${agent}@${process.pid}`;
  const ctx = tenantContext(values.tenant ?? 'fence-team', `worker-${agent}`);
  const hold = Number(values['hold-ms']) || 0;
  const poll = Number(values['poll-ms']) || 500;
  let stop = false;
  for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => (stop = true));
  log(agent, `worker ${claimer} for ${ctx.tenant.id}`);
  await runWithContext(ctx, async () => {
    while (!stop) {
      for (const r of await reapExpired(ctx))
        log(agent, `returned expired claim ${r.id} (${r.status}, attempts ${r.attempts})`);
      const h = await claimHandoff(ctx, agent, claimer);
      if (!h) {
        if (values.once) break;
        await new Promise((r) => setTimeout(r, poll));
        continue;
      }
      log(agent, `claimed ${h.kind} ${h.id} (version ${h.version}, attempt ${h.attempts + 1})`);
      if (hold) {
        log(agent, `holding the claim for ${hold} ms`);
        await new Promise((r) => setTimeout(r, hold));
      }
      const t0 = Date.now();
      try {
        const result = await handle(ctx, agent, h, claimer);
        const done = await completeHandoff(ctx, h.id, claimer, h.version, result);
        if (!done) {
          log(agent, `could not complete ${h.id}: the claim expired and moved on`);
          continue;
        }
        await recordHandoffEpisode(ctx, agent, h, result, Date.now() - t0);
        log(agent, `done ${h.id} in ${Date.now() - t0} ms: ${result}`);
      } catch (err) {
        const f = await failHandoff(ctx, h.id, claimer, h.version, (err as Error).message);
        log(agent, `failed ${h.id}: ${(err as Error).message} -> ${f?.status ?? 'claim lost'}`);
      }
      if (values.once) break;
    }
  });
}
async function main(): Promise<void> {
  if (values.all) {
    const children = WORKER_AGENTS.map((a) =>
      spawn(
        process.execPath,
        [process.argv[1] as string, '--agent', a, '--tenant', values.tenant ?? 'fence-team'],
        {
          stdio: 'inherit',
        },
      ),
    );
    for (const s of ['SIGINT', 'SIGTERM'] as const)
      process.on(s, () => children.forEach((c) => c.kill(s)));
    await Promise.all(children.map((c) => new Promise((r) => c.on('exit', r))));
    return;
  }
  const agent = values.agent ?? '';
  if (!WORKER_AGENTS.includes(agent))
    throw new Error(
      `Usage: npm run worker -- --agent ${WORKER_AGENTS.join('|')} [--tenant <id>] [--once]`,
    );
  await loop(agent);
}
main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
