import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCrawlArgs } from './cli/args.js';
import { env } from './config/env.js';
import { collapseTemplates } from './crawl/collapse.js';
import { Crawler } from './crawl/crawler.js';
import { summarize } from './crawl/summary.js';
import { connect } from './graph/client.js';
import { derive } from './graph/derive.js';
import { runTasks } from './journey/index.js';
import { deleteGraph, graphCounts, writeConflicts, writeCrawl } from './graph/writer.js';
import { finishSeo, type SeoSummary } from './seo/index.js';
async function main(): Promise<void> {
  const opts = parseCrawlArgs(process.argv.slice(2), env.TARGET_URL);
  const started = Date.now();
  const artifactsDir = resolve('artifacts', opts.graph);
  const log = (msg: string) => console.log(msg);
  const db = await connect();
  try {
    if (opts.reset) {
      const deleted = await deleteGraph(db, opts.graph);
      log(deleted ? `Deleted graph ${opts.graph}.` : `Graph ${opts.graph} did not exist.`);
    }
    log(`Crawling ${opts.url.href} into graph ${opts.graph}`);
    let result = await new Crawler(opts, artifactsDir, log).run();
    const seo: SeoSummary | null = opts.seo
      ? await finishSeo(result, opts.url.origin, opts.lighthouse, log)
      : null;
    if (opts.collapseTemplates) result = collapseTemplates(result);
    await writeCrawl(db, opts.graph, result);
    const conflicts = opts.seo ? await writeConflicts(db, opts.graph) : 0;
    const derived = await derive(db, opts.graph);
    const journeys = opts.tasks
      ? await runTasks(db, opts.graph, opts.tasks, log, opts.url.origin)
      : [];
    const counts = await graphCounts(db, opts.graph);
    const summary = summarize(result);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    await writeFile(
      join(artifactsDir, 'crawl.json'),
      JSON.stringify(
        {
          graph: opts.graph,
          url: opts.url.href,
          options: { ...opts, url: opts.url.href },
          crawledAt: new Date(started).toISOString(),
          durationSeconds: Number(seconds),
          summary,
          ...result,
          sessionCookies: undefined,
        },
        null,
        2,
      ) + '\n',
    );
    log('');
    log(`Summary for ${opts.graph} (${seconds}s)`);
    log(`  screens:     ${summary.screens}`);
    log(`  edges:       ${summary.edges} (${summary.linkEdges} link, ${summary.jsEdges} js)`);
    log(`  components:  ${summary.components}`);
    log(`  orphans:     ${summary.orphans.length} ${summary.orphans.join(', ')}`);
    log(`  dead ends:   ${summary.deadEnds.length} ${summary.deadEnds.join(', ')}`);
    log(
      `  redirects:   ${
        Object.entries(result.redirects)
          .map(([a, b]) => `${a} -> ${b}`)
          .join(', ') || 'none'
      }`,
    );
    const fmt = (o: Record<string, number>) =>
      Object.entries(o)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') || 'none';
    log(
      opts.checks
        ? `  issues:      ${summary.issues.total} on ${summary.issues.occurrences} screen occurrences (source: ${fmt(summary.issues.bySource)}; severity: ${fmt(summary.issues.bySeverity)})`
        : '  issues:      checks skipped (--no-checks)',
    );
    log(
      `  derived:     ${derived.shared} shared NAVIGATES_TO edges, ${derived.flows} FLOWS_TO edges (${derived.promoted.length} promoted: ${derived.promoted.join(', ') || 'none'})`,
    );
    log(
      `  crawlable:   ${derived.hrefs} HREF_TO edges; not reachable by links from the start: ${derived.unreachableByLinks.join(', ') || 'none'}`,
    );
    if (seo) {
      log(
        `  seo:         js-only content on ${seo.jsOnly.join(', ') || 'none'}; mobile overflow on ${seo.mobileOverflow.join(', ') || 'none'}`,
      );
      log(
        `  robots:      ${seo.robots.found ? `${seo.robots.disallowed.length} crawled screens disallowed (${seo.robots.disallowed.join(', ') || 'none'})` : 'no robots.txt'}`,
      );
      log(
        `  sitemap:     ${seo.sitemap ? `${seo.sitemap.listed} URLs, ${seo.sitemap.gaps} gap issue(s)` : 'none found'}; ${conflicts} guideline conflicts seeded`,
      );
      log(
        `  lighthouse:  ${seo.lighthouse ? `${seo.lighthouse.audited.length} screens in ${seo.lighthouse.seconds}s (${seo.lighthouse.audited.join(', ')}), ${seo.lighthouse.failedAudits} failed audit(s)` : 'skipped (--no-lighthouse)'}`,
      );
    } else {
      log('  seo:         skipped (--no-seo)');
    }
    if (opts.tasks) {
      log(
        `  tasks:       ${journeys.filter((j) => j.ok).length} of ${journeys.length} replayed (${journeys.map((j) => `${j.task.id} ${j.ok ? `${j.clicks} clicks` : 'FAILED'}`).join(', ')})`,
      );
      if (journeys.some((j) => !j.ok)) process.exitCode = 1;
    }
    log(`  state:       ${result.stateNotes.join('; ') || 'no state priming'}`);
    log(
      `  state-required: ${
        result.screens
          .filter((x) => x.state_required)
          .map((x) => x.id)
          .join(', ') || 'none'
      }`,
    );
    if (result.droppedEdges > 0)
      log(`  dropped:     ${result.droppedEdges} edges to screens past the limits`);
    log(
      `  in FalkorDB: ${counts.screens} screens, ${counts.edges} edges, ${counts.components} components, ${counts.designSystem} design system components, ${counts.issues} issues on ${counts.foundOn} screen occurrences`,
    );
    log(`  artifacts:   artifacts/${opts.graph}/crawl.json and screens/`);
  } finally {
    await db.close();
  }
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
