import { createServer } from 'node:net';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';
import type { LighthouseResult } from './types.js';
const CATEGORIES = ['seo', 'performance'] as const;
const SCORED_MODES = new Set(['binary', 'numeric', 'metricSavings']);
export const SKIPPED_AUDITS = [
  'network-dependency-tree-insight',
  'screenshot-thumbnails',
  'final-screenshot',
  'main-thread-tasks',
  'diagnostics',
  'metrics',
  'network-requests',
  'network-rtt',
  'network-server-latency',
  'resource-summary',
  'script-treemap-data',
];
const FLAGS = {
  output: 'json' as const,
  logLevel: 'error' as const,
  onlyCategories: [...CATEGORIES],
  formFactor: 'desktop' as const,
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttlingMethod: 'simulate' as const,
  throttling: {
    rttMs: 0,
    throughputKbps: 0,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
  pauseAfterFcpMs: 100,
  pauseAfterLoadMs: 100,
  networkQuietThresholdMs: 100,
  cpuQuietThresholdMs: 100,
  disableFullPageScreenshot: true,
  skipAudits: SKIPPED_AUDITS,
};
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
}
export async function runLighthouse(
  targets: {
    id: string;
    url: string;
    cookie: string | null;
  }[],
  log: (msg: string) => void,
): Promise<Map<string, LighthouseResult>> {
  const results = new Map<string, LighthouseResult>();
  if (targets.length === 0) return results;
  const port = await freePort();
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  try {
    for (const t of targets) {
      try {
        const run = await lighthouse(t.url, {
          ...FLAGS,
          port,
          extraHeaders: t.cookie ? { Cookie: t.cookie } : undefined,
        });
        const lhr = run?.lhr;
        if (!lhr) continue;
        if (lhr.runtimeError) {
          log(`  lighthouse ${t.id}: ${lhr.runtimeError.code}`);
          continue;
        }
        const failed: LighthouseResult['failed'] = [];
        for (const category of CATEGORIES) {
          for (const ref of lhr.categories[category]?.auditRefs ?? []) {
            const a = lhr.audits[ref.id];
            if (!a || a.score === null || !SCORED_MODES.has(a.scoreDisplayMode)) continue;
            if (SKIPPED_AUDITS.includes(a.id)) continue;
            if (a.score >= (a.scoreDisplayMode === 'binary' ? 1 : 0.5)) continue;
            failed.push({
              id: a.id,
              title: a.title,
              description: a.description,
              category,
              score: a.score,
              displayValue: a.displayValue ?? '',
            });
          }
        }
        const metric = (id: string) => lhr.audits[id]?.numericValue ?? null;
        const lcp = metric('largest-contentful-paint');
        const cls = metric('cumulative-layout-shift');
        results.set(t.id, {
          lcp_ms: lcp === null ? null : Math.round(lcp),
          cls: cls === null ? null : Math.round(cls * 1000) / 1000,
          failed,
        });
      } catch (err) {
        log(`  lighthouse failed on ${t.id}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
