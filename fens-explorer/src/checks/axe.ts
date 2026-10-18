import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';
import { guidelinesFromAxe } from './guidelines.js';
import type { CheckFinding, Severity } from './types.js';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const SEVERITIES: Severity[] = ['minor', 'moderate', 'serious', 'critical'];
export async function axeChecks(page: Page): Promise<CheckFinding[]> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const selectors = result.violations.flatMap((v) =>
    v.nodes.map((n) => String(n.target[n.target.length - 1] ?? '')),
  );
  const components = await page.evaluate(
    (list) =>
      list.map((sel) => {
        try {
          return (
            document
              .querySelector(sel)
              ?.closest('[data-component]')
              ?.getAttribute('data-component') ?? null
          );
        } catch {
          return null;
        }
      }),
    selectors,
  );
  let k = 0;
  return result.violations.map((v) => ({
    source: 'axe' as const,
    ruleId: v.id,
    severity: SEVERITIES.includes(v.impact as Severity) ? (v.impact as Severity) : 'moderate',
    help: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    guidelines: guidelinesFromAxe(v.id, v.tags, v.help),
    nodes: v.nodes.map((n) => ({
      selector: selectors[k] ?? '',
      html: n.html.slice(0, 300),
      component: components[k++] ?? null,
    })),
  }));
}
