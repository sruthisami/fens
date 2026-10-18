import type { FalkorDB } from 'falkordb';
import { chromium } from 'playwright';
import { runJourney, type JourneyResult } from './run.js';
import { readTasks } from './tasks.js';
import { writeTask } from './write.js';
export async function runTasks(
  db: FalkorDB,
  graphName: string,
  file: string,
  log: (msg: string) => void,
  origin?: string,
): Promise<JourneyResult[]> {
  const tasks = await readTasks(file);
  const graph = db.selectGraph(graphName);
  const results: JourneyResult[] = [];
  const browser = await chromium.launch();
  try {
    for (const task of tasks) {
      let base = origin;
      if (!base) {
        const url = (
          await graph.roQuery<{
            url: string;
          }>('MATCH (s:Screen {id: $id}) RETURN s.url AS url', {
            params: { id: task.start } as never,
          })
        ).data?.[0]?.url;
        if (!url) throw new Error(`Start screen ${task.start} is not in graph ${graphName}`);
        base = new URL(url).origin;
      }
      const result = await runJourney(browser, base, task);
      results.push(result);
      const path = [task.start, ...result.steps.map((s) => s.to)].join(' > ');
      if (result.ok) {
        await writeTask(db, graphName, result);
        log(`  task ${task.id}: ${result.clicks} clicks, ${path}`);
      } else {
        log(
          `  task ${task.id}: FAILED after ${result.clicks} clicks (${result.error}). Not written.`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
