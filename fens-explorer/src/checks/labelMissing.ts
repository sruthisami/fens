import type { Page } from 'playwright';
import { wcag } from './guidelines.js';
import type { CheckFinding } from './types.js';
export const LABEL_MISSING = 'flowlens/label-missing';
export async function labelMissing(page: Page): Promise<CheckFinding[]> {
  const nodes = await page.evaluate(() => {
    const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
    const hasText = (el: Element | null) => !!el && (el.textContent ?? '').trim().length > 0;
    const cssPath = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      for (
        let node: Element | null = el;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const parent: Element | null = node.parentElement;
        const tag = node.tagName.toLowerCase();
        const same = parent ? [...parent.children].filter((c) => c.tagName === node?.tagName) : [];
        parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
      }
      return parts.join(' > ');
    };
    return [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => !(el instanceof HTMLInputElement && SKIP.has(el.type)))
      .filter((el) => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      .filter((el) => {
        const field = el as HTMLInputElement;
        const byLabel = [...(field.labels ?? [])].some(hasText);
        const byAria = (el.getAttribute('aria-label') ?? '').trim().length > 0;
        const byLabelledBy = (el.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .some((id) => hasText(document.getElementById(id)));
        return !(byLabel || byAria || byLabelledBy);
      })
      .map((el) => ({
        selector: cssPath(el),
        html: el.outerHTML.slice(0, 300),
        component: el.closest('[data-component]')?.getAttribute('data-component') ?? null,
      }));
  });
  if (nodes.length === 0) return [];
  return [
    {
      source: 'flowlens',
      ruleId: LABEL_MISSING,
      severity: 'serious',
      help: 'Form fields must have a label; a placeholder is not a label',
      description:
        'A visible input, select or textarea has no label from <label>, aria-label or aria-labelledby. Placeholder text disappears while typing and is not a reliable label.',
      helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
      guidelines: [wcag('3.3.2')],
      nodes,
    },
  ];
}
