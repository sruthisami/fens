import type { Browser, Page } from 'playwright';
import { normalizePath } from '../crawl/normalize.js';
import { settle } from '../crawl/page.js';
import type { TaskDef } from './tasks.js';
export interface JourneyStep {
  order: number;
  action: string;
  from: string;
  to: string;
}
export interface JourneyResult {
  task: TaskDef;
  ok: boolean;
  clicks: number;
  steps: JourneyStep[];
  error?: string;
}
async function markTarget(page: Page, label: string): Promise<boolean> {
  return page.evaluate((wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const textOf = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let out = '';
      let last: Node | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.textContent ?? '';
        if (!v.trim()) continue;
        if (last && n.parentNode !== last) out += ' ';
        out += v;
        last = n.parentNode;
      }
      return norm(out);
    };
    document
      .querySelectorAll('[data-flowlens-step]')
      .forEach((el) => el.removeAttribute('data-flowlens-step'));
    const target = [
      ...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"]'),
    ]
      .filter((el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      .find((el) => textOf(el) === wanted || norm(el.getAttribute('aria-label') ?? '') === wanted);
    target?.setAttribute('data-flowlens-step', '1');
    return !!target;
  }, label);
}
export async function runJourney(
  browser: Browser,
  origin: string,
  task: TaskDef,
): Promise<JourneyResult> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const steps: JourneyStep[] = [];
  try {
    await page.goto(origin + task.start, { waitUntil: 'domcontentloaded' });
    await settle(page);
    for (const [i, action] of task.steps.entries()) {
      const from = normalizePath(page.url(), origin) ?? '';
      if (!(await markTarget(page, action))) {
        return {
          task,
          ok: false,
          clicks: steps.length,
          steps,
          error: `Step ${i + 1}: no visible link or button "${action}" on ${from}`,
        };
      }
      await page.locator('[data-flowlens-step]').first().click();
      await page
        .waitForURL((u) => normalizePath(u.href, origin) !== from, { timeout: 2500 })
        .catch(() => {});
      await settle(page);
      steps.push({ order: i + 1, action, from, to: normalizePath(page.url(), origin) ?? '' });
    }
    const end = normalizePath(page.url(), origin);
    const ok = end === task.end;
    return {
      task,
      ok,
      clicks: steps.length,
      steps,
      ...(ok ? {} : { error: `Ended on ${end}, expected ${task.end}` }),
    };
  } finally {
    await context.close();
  }
}
