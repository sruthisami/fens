import type { CrawlResult, ScreenRecord } from '../types.js';
import { runLighthouse } from './lighthouse.js';
import { isAllowed, fetchRobots } from './robots.js';
import { lighthouseIssues, seoRuleIssues } from './rules.js';
import { checkSitemap } from './sitemap.js';
export { captureSeo } from './capture.js';
export { CONFLICTS } from './guidelines.js';
export const LIGHTHOUSE_SAMPLE = 8;
export interface SeoSummary {
  jsOnly: string[];
  mobileOverflow: string[];
  robots: {
    found: boolean;
    disallowed: string[];
  };
  sitemap: {
    listed: number;
    gaps: number;
  } | null;
  lighthouse: {
    audited: string[];
    failedAudits: number;
    seconds: number;
  } | null;
}
export function lighthouseSample(
  screens: ScreenRecord[],
  allowed: (s: ScreenRecord) => boolean,
  max = LIGHTHOUSE_SAMPLE,
): ScreenRecord[] {
  const order = [...screens]
    .filter((s) => !s.state_required && allowed(s))
    .sort(
      (a, b) =>
        Number(b.discovered_via === 'start') - Number(a.discovered_via === 'start') ||
        a.depth - b.depth ||
        a.id.localeCompare(b.id),
    );
  const seen = new Set<string>();
  const sample: ScreenRecord[] = [];
  for (const s of order) {
    if (sample.length >= max) break;
    if (seen.has(s.fingerprint)) continue;
    seen.add(s.fingerprint);
    sample.push(s);
  }
  return sample;
}
export async function finishSeo(
  result: CrawlResult,
  origin: string,
  lighthouse: boolean,
  log: (msg: string) => void,
): Promise<SeoSummary> {
  const robots = await fetchRobots(origin);
  const allowed = (s: ScreenRecord) => isAllowed(s.id, robots.rules);
  for (const s of result.screens) s.robots_disallowed = robots.found ? !allowed(s) : false;
  let lh: SeoSummary['lighthouse'] = null;
  if (lighthouse) {
    const started = Date.now();
    const sample = lighthouseSample(result.screens, allowed);
    log(
      `Lighthouse on ${sample.length} screens, one per page structure (seo, performance; desktop, no throttling)`,
    );
    const runs = await runLighthouse(
      sample.map((s) => ({ id: s.id, url: s.url, cookie: result.sessionCookies[s.id] ?? null })),
      log,
    );
    for (const s of result.screens) {
      const r = runs.get(s.id);
      if (r) s.lighthouse = { lcp_ms: r.lcp_ms, cls: r.cls };
    }
    const found = lighthouseIssues(runs);
    result.issues.push(...found.issues);
    result.occurrences.push(...found.occurrences);
    lh = {
      audited: [...runs.keys()],
      failedAudits: found.issues.length,
      seconds: Math.round((Date.now() - started) / 1000),
    };
  }
  const sitemap = await checkSitemap(origin);
  if (!sitemap) log('  no sitemap.xml found; sitemap-gap skipped');
  const listed = new Set(sitemap?.map((e) => e.path) ?? []);
  for (const s of result.screens) {
    if (sitemap) s.in_sitemap = s.instance_paths.some((p) => listed.has(p));
  }
  const rules = seoRuleIssues(result.screens, sitemap, robots.rules);
  result.issues.push(...rules.issues);
  result.occurrences.push(...rules.occurrences);
  const ruleScreens = (rule: string) =>
    rules.occurrences
      .filter((o) => rules.issues.some((i) => i.id === o.issue && i.rule_id === rule))
      .map((o) => o.screen);
  return {
    jsOnly: ruleScreens('flowlens/js-only-content'),
    mobileOverflow: result.screens.filter((s) => s.seo?.mobile_overflow).map((s) => s.id),
    robots: {
      found: robots.found,
      disallowed: result.screens.filter((s) => s.robots_disallowed).map((s) => s.id),
    },
    sitemap: sitemap
      ? {
          listed: sitemap.length,
          gaps: rules.issues.filter((i) => i.rule_id === 'flowlens/sitemap-gap').length,
        }
      : null,
    lighthouse: lh,
  };
}
