import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { cssString, normalizePath } from './normalize.js';
import type { InteractiveElement } from '../types.js';
export const ACTION_DELAY_MS = 200;
const IDLE_TIMEOUT_MS = 10000;
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page.waitForTimeout(ACTION_DELAY_MS);
}
export async function primeCart(page: Page): Promise<string | null> {
  const product = page.locator('a[href*="/product/"]').first();
  if ((await product.count()) === 0) return null;
  const href = await product.getAttribute('href');
  await product.click();
  await settle(page);
  const add = page.getByRole('button', { name: /add to (cart|bag|basket)/i }).first();
  if ((await add.count()) === 0) return null;
  await add.click();
  await settle(page);
  if (page.url().includes('/login')) {
    const email = page.locator('input[type="email"], input#login-email').first();
    const password = page.locator('input[type="password"], input#login-password').first();
    if ((await email.count()) > 0) {
      await email.fill('crawler@flowlens.local');
      if ((await password.count()) > 0) {
        await password.fill('password123');
      }
      const submit = page.getByRole('button', { name: /sign in|log in/i }).first();
      if ((await submit.count()) > 0) {
        await submit.click();
        await settle(page);
        const retryAdd = page.getByRole('button', { name: /add to (cart|bag|basket)/i }).first();
        if ((await retryAdd.count()) > 0) {
          await retryAdd.click();
          await settle(page);
        }
      }
    }
  }
  return `added one item to the cart from ${href}`;
}
export async function goToPath(page: Page, origin: string, path: string): Promise<void> {
  if (normalizePath(page.url(), origin) === path) return;
  await page.evaluate((target) => {
    (
      window as unknown as {
        __flBefore: string;
      }
    ).__flBefore = document.body.innerHTML;
    history.pushState({}, '', target);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await settle(page);
  const reacted = await page.evaluate(
    () =>
      document.body.innerHTML !==
      (
        window as unknown as {
          __flBefore: string;
        }
      ).__flBefore,
  );
  if (!reacted) {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await settle(page);
  }
}
interface RawLink {
  text: string;
  href: string;
  role: string;
  component: string | null;
}
interface RawButton {
  text: string;
  role: string;
  component: string | null;
}
interface RawComponent {
  name: string;
  text: string;
}
export interface PageSnapshot {
  title: string;
  fingerprint: string;
  links: (InteractiveElement & {
    href: string;
  })[];
  buttons: InteractiveElement[];
  components: {
    name: string;
    selector: string;
    text: string;
  }[];
}
export async function snapshot(page: Page): Promise<PageSnapshot> {
  const raw = await page.evaluate(() => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el: Element) =>
      el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const owner = (el: Element) =>
      el.closest('[data-component]')?.getAttribute('data-component') ?? null;
    const textOf = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let out = '';
      let lastParent: Node | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const value = n.textContent ?? '';
        if (!value.trim()) continue;
        if (lastParent && n.parentNode !== lastParent) out += ' ';
        out += value;
        lastParent = n.parentNode;
      }
      return norm(out);
    };
    const structure = [...document.body.querySelectorAll('*')]
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}|${el.getAttribute('role') ?? ''}|${el.getAttribute('data-component') ?? ''}`,
      )
      .sort();
    const links: RawLink[] = [...document.querySelectorAll('a[href]')].filter(visible).map((a) => ({
      text: textOf(a) || norm(a.getAttribute('aria-label')),
      href: a.getAttribute('href') ?? '',
      role: a.getAttribute('role') ?? 'link',
      component: owner(a),
    }));
    const buttons: RawButton[] = [
      ...document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"]',
      ),
    ]
      .filter(visible)
      .map((b) => ({
        text:
          textOf(b) || norm(b.getAttribute('aria-label')) || norm((b as HTMLInputElement).value),
        role: b.getAttribute('role') ?? 'button',
        component: owner(b),
      }));
    const components: RawComponent[] = [...document.querySelectorAll('[data-component]')].map(
      (el) => ({
        name: el.getAttribute('data-component') ?? '',
        text: textOf(el).slice(0, 160),
      }),
    );
    return { title: document.title, structure, links, buttons, components };
  });
  const fingerprint = createHash('sha1')
    .update(raw.structure.join('\n'))
    .digest('hex')
    .slice(0, 12);
  const withNth = <T>(items: T[], base: (item: T) => string) => {
    const totals = new Map<string, number>();
    items.forEach((i) => totals.set(base(i), (totals.get(base(i)) ?? 0) + 1));
    const seen = new Map<string, number>();
    return items.map((i) => {
      const b = base(i);
      const n = seen.get(b) ?? 0;
      seen.set(b, n + 1);
      return (totals.get(b) ?? 0) > 1 ? `${b} >> visible=true >> nth=${n}` : b;
    });
  };
  const linkSelectors = withNth(raw.links, (l) => `a[href="${cssString(l.href)}"]`);
  const links = raw.links.map((l, i) => ({
    kind: 'link' as const,
    role: l.role,
    text: l.text,
    href: l.href,
    selector: linkSelectors[i] ?? '',
    component: l.component,
  }));
  const buttonSelectors = withNth(raw.buttons, (b) =>
    b.text ? `role=button[name="${cssString(b.text)}" s]` : 'button',
  );
  const buttons: InteractiveElement[] = [];
  for (const [i, b] of raw.buttons.entries()) {
    let selector = buttonSelectors[i] ?? '';
    if ((await page.locator(selector).count()) === 0) {
      selector = `button >> visible=true >> nth=${i}`;
    }
    buttons.push({ kind: 'button', role: b.role, text: b.text, selector, component: b.component });
  }
  const perName = new Map<string, number>();
  const components = raw.components.map((c) => {
    const n = perName.get(c.name) ?? 0;
    perName.set(c.name, n + 1);
    return {
      name: c.name,
      selector: `[data-component="${cssString(c.name)}"] >> nth=${n}`,
      text: c.text,
    };
  });
  return { title: raw.title, fingerprint, links, buttons, components };
}
