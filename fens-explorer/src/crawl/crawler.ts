import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { runChecks, type IssueDef, type IssueOccurrence } from '../checks/index.js';
import { captureSeo } from '../seo/index.js';
import type { CrawlOptions } from '../cli/args.js';
import type { ComponentNode, CrawlResult, DiscoveredVia, NavEdge, ScreenRecord } from '../types.js';
import { isSameOrigin, normalizePath, screenFileName } from './normalize.js';
import { goToPath, primeCart, settle, snapshot } from './page.js';
export const VIEWPORT = { width: 1440, height: 900 };
const NAV_TIMEOUT_MS = 15000;
const ACTION_TIMEOUT_MS = 5000;
const URL_CHANGE_TIMEOUT_MS = 2500;
const MAX_REPLAY_DEPTH = 25;
interface QueueItem {
  path: string;
  depth: number;
  via: DiscoveredVia;
  captured?: boolean;
}
interface Arrival {
  from: string;
  selector: string;
}
interface Session {
  context: BrowserContext;
  page: Page;
}
export class Crawler {
  private readonly origin: string;
  private readonly screens = new Map<string, ScreenRecord>();
  private readonly components: ComponentNode[] = [];
  private readonly edges = new Map<string, NavEdge>();
  private readonly arrivals = new Map<string, Arrival>();
  private readonly freshRedirects = new Map<string, string>();
  private readonly enqueued = new Set<string>();
  private readonly queue: QueueItem[] = [];
  private readonly stateNotes = new Set<string>();
  private readonly issues = new Map<string, IssueDef>();
  private readonly occurrences = new Map<string, IssueOccurrence>();
  private readonly cookies = new Map<string, string>();
  private browser: Browser | null = null;
  constructor(
    private readonly opts: CrawlOptions,
    private readonly artifactsDir: string,
    private readonly log: (msg: string) => void,
  ) {
    this.origin = opts.url.origin;
  }
  async run(): Promise<CrawlResult> {
    await mkdir(join(this.artifactsDir, 'screens'), { recursive: true });
    this.browser = await chromium.launch({ headless: !this.opts.headed });
    try {
      const start = normalizePath(this.opts.url.href, this.origin) ?? '/';
      this.enqueue(start, 0, 'start');
      for (const seed of this.opts.seeds) this.enqueue(seed, 0, 'seed');
      let skipped = 0;
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) break;
        if (!item.captured && this.screens.size >= this.opts.maxScreens) {
          skipped++;
          continue;
        }
        await this.visit(item);
      }
      if (skipped > 0) {
        this.log(`Stopped at --max-screens ${this.opts.maxScreens}; ${skipped} paths not visited.`);
      }
      await this.markStateRequired();
    } finally {
      await this.browser.close();
    }
    return this.result();
  }
  private enqueue(path: string, depth: number, via: DiscoveredVia): void {
    if (this.enqueued.has(path) || depth > this.opts.maxDepth) return;
    this.enqueued.add(path);
    this.queue.push({ path, depth, via });
  }
  private async freshSession(path: string): Promise<Session> {
    if (!this.browser) throw new Error('Browser not started');
    const context = await this.browser.newContext({
      viewport: VIEWPORT,
      storageState: this.opts.storageState ?? undefined,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.on('dialog', (d) => void d.dismiss());
    await page.goto(this.origin + '/', { waitUntil: 'domcontentloaded' });
    await settle(page);
    const note = await primeCart(page).catch(() => null);
    if (note) this.stateNotes.add(note);
    await goToPath(page, this.origin, path);
    return { context, page };
  }
  private async visit(item: QueueItem): Promise<void> {
    if (item.captured) {
      await this.clickButtons(item.path);
      return;
    }
    const { context, page } = await this.freshSession(item.path);
    let id: string | null;
    try {
      id = normalizePath(page.url(), this.origin);
      if (!id) {
        this.log(`  skip ${item.path}: left the origin`);
        return;
      }
      if (id !== item.path) this.freshRedirects.set(item.path, id);
      if (this.screens.has(id)) return;
      this.enqueued.add(id);
      await this.capture(page, id, item.depth, item.via);
    } finally {
      await context.close();
    }
    await this.clickButtons(id);
  }
  private async capture(page: Page, id: string, depth: number, via: DiscoveredVia): Promise<void> {
    const snap = await snapshot(page);
    const file = join('artifacts', this.opts.graph, 'screens', `${screenFileName(id)}.png`);
    await page.screenshot({
      path: join(this.artifactsDir, 'screens', `${screenFileName(id)}.png`),
      fullPage: true,
    });
    this.screens.set(id, {
      id,
      path: id,
      url: this.origin + id,
      title: snap.title,
      fingerprint: snap.fingerprint,
      screenshot: file,
      discovered_via: via,
      depth,
      instances: 1,
      instance_paths: [id],
      crawled_at: new Date().toISOString(),
      state_required: false,
      elements: [...snap.links, ...snap.buttons],
    });
    if (this.opts.checks) {
      try {
        const found = await runChecks(page, id);
        for (const issue of found.issues)
          if (!this.issues.has(issue.id)) this.issues.set(issue.id, issue);
        for (const o of found.occurrences) this.occurrences.set(`${o.issue}|${o.screen}`, o);
      } catch (err) {
        this.log(`  checks failed on ${id}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    if (this.opts.seo) {
      const screen = this.screens.get(id);
      try {
        if (screen) screen.seo = await captureSeo(page, this.origin + id);
      } catch (err) {
        this.log(`  seo capture failed on ${id}: ${(err as Error).message.split('\n')[0]}`);
      }
      const cookies = await page.context().cookies(this.origin);
      if (cookies.length)
        this.cookies.set(id, cookies.map((c) => `${c.name}=${c.value}`).join('; '));
    }
    snap.components.forEach((c, i) => {
      this.components.push({
        id: `${id}#${c.name}#${i}`,
        screen: id,
        name: c.name,
        selector: c.selector,
        text: c.text,
      });
    });
    const how = this.arrivals.has(id) ? ', captured on arrival' : '';
    this.log(
      `  [${this.screens.size}] ${id} (depth ${depth}, ${via}${how}) links=${snap.links.length} buttons=${snap.buttons.length}`,
    );
    for (const link of snap.links) {
      if (!isSameOrigin(link.href, this.origin)) continue;
      const target = normalizePath(link.href, this.origin);
      if (!target || target === id) continue;
      this.addEdge({
        from: id,
        to: target,
        action: link.text || link.href,
        via: 'link',
        selector: link.selector,
      });
      this.enqueue(target, depth + 1, 'link');
    }
  }
  private async clickButtons(id: string): Promise<void> {
    const screen = this.screens.get(id);
    if (!screen) return;
    const done = new Set<string>();
    for (const button of screen.elements.filter((e) => e.kind === 'button')) {
      if (done.has(button.selector)) continue;
      done.add(button.selector);
      const target = await this.clickOutcome(screen, button.selector);
      if (!target || target === id) continue;
      this.addEdge({
        from: id,
        to: target,
        action: button.text || button.selector,
        via: 'js',
        selector: button.selector,
      });
    }
  }
  private async reach(id: string, depth = 0): Promise<Session | null> {
    const arrival = this.arrivals.get(id);
    if (!arrival || depth > MAX_REPLAY_DEPTH) {
      const session = await this.freshSession(id);
      if (normalizePath(session.page.url(), this.origin) === id) return session;
      await session.context.close();
      return null;
    }
    const session = await this.reach(arrival.from, depth + 1);
    if (!session) return null;
    try {
      await this.clickAndWait(session.page, arrival.from, arrival.selector);
      if (normalizePath(session.page.url(), this.origin) === id) return session;
    } catch {}
    await session.context.close();
    return null;
  }
  private async clickAndWait(page: Page, from: string, selector: string): Promise<string | null> {
    await page.locator(selector).first().click();
    await page
      .waitForURL((u) => normalizePath(u.href, this.origin) !== from, {
        timeout: URL_CHANGE_TIMEOUT_MS,
      })
      .catch(() => {});
    await settle(page);
    return normalizePath(page.url(), this.origin);
  }
  private async clickOutcome(screen: ScreenRecord, selector: string): Promise<string | null> {
    const session = await this.reach(screen.id);
    if (!session) {
      this.log(`  cannot reopen ${screen.id} to click ${selector}`);
      return null;
    }
    try {
      const target = await this.clickAndWait(session.page, screen.id, selector);
      const depth = screen.depth + 1;
      if (
        target &&
        target !== screen.id &&
        !this.screens.has(target) &&
        this.screens.size < this.opts.maxScreens &&
        depth <= this.opts.maxDepth
      ) {
        this.arrivals.set(target, { from: screen.id, selector });
        this.enqueued.add(target);
        await this.capture(session.page, target, depth, 'js');
        this.queue.push({ path: target, depth, via: 'js', captured: true });
      }
      return target;
    } catch (err) {
      this.log(
        `  click failed on ${screen.id} ${selector}: ${(err as Error).message.split('\n')[0]}`,
      );
      return null;
    } finally {
      await session.context.close();
    }
  }
  private async markStateRequired(): Promise<void> {
    for (const id of this.arrivals.keys()) {
      const screen = this.screens.get(id);
      if (!screen) continue;
      let landed = this.freshRedirects.get(id);
      if (!landed) {
        const { context, page } = await this.freshSession(id);
        const end = normalizePath(page.url(), this.origin);
        await context.close();
        if (end && end !== id) {
          landed = end;
          this.freshRedirects.set(id, end);
        }
      }
      if (landed) {
        screen.state_required = true;
        this.log(`  state-required: ${id} (a fresh session lands on ${landed})`);
      }
    }
  }
  private addEdge(edge: NavEdge): void {
    const key = `${edge.from}|${edge.to}|${edge.action}`;
    if (!this.edges.has(key)) this.edges.set(key, edge);
  }
  private result(): CrawlResult {
    const resolved = new Map<string, NavEdge>();
    let dropped = 0;
    for (const edge of this.edges.values()) {
      let to = edge.to;
      let redirects_to: string | null = null;
      if (this.screens.has(to)) {
        if (edge.via === 'link') redirects_to = this.freshRedirects.get(to) ?? null;
      } else {
        to = this.freshRedirects.get(to) ?? to;
      }
      if (!this.screens.has(to) || to === edge.from) {
        if (to !== edge.from) dropped++;
        continue;
      }
      const e: NavEdge = { ...edge, to, redirects_to };
      resolved.set(`${e.from}|${e.to}|${e.action}`, e);
    }
    return {
      screens: [...this.screens.values()],
      edges: [...resolved.values()],
      components: this.components,
      redirects: Object.fromEntries(this.freshRedirects),
      droppedEdges: dropped,
      stateNotes: [...this.stateNotes],
      issues: [...this.issues.values()],
      occurrences: [...this.occurrences.values()],
      sessionCookies: Object.fromEntries(this.cookies),
    };
  }
}
