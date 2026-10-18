import type { Manifest } from './manifest.js';
export interface DocMismatch {
  file: string;
  line: number;
  item: string;
  found: string;
  allowed: string;
  text: string;
}
interface Rule {
  item: string;
  context: RegExp;
  pattern: RegExp;
  allowed: Set<number>;
}
const values = (m: Manifest, id: string, keys?: string[]) => {
  const item = m.items.find((i) => i.id === id);
  if (!item) return [];
  return (['v1', 'v2'] as const).flatMap((v) =>
    Object.entries(item.expected[v])
      .filter(([k, x]) => x !== null && (!keys || keys.includes(k)))
      .map(([, x]) => x as number),
  );
};
export function docRules(m: Manifest): Rule[] {
  const total = (k: 'screens' | 'health') => [m.versions.v1[k], m.versions.v2[k]];
  return [
    {
      item: 'F1',
      context: /checkout|journey|buy now|shortcut|detour|\bF1\b|buy-a-product|main flow/i,
      pattern: /\b(\d+)[ -](?:clicks?|edges?|hops?)\b/gi,
      allowed: new Set(values(m, 'F1', ['forced_clicks', 'shortest_clicks', 'detour'])),
    },
    {
      item: 'F4',
      context: /sign ?in|SignInButton|\bF4\b/i,
      pattern: /\b(\d+\.\d+):1\b/g,
      allowed: new Set([...values(m, 'F4', ['contrast_ratio']), 4.5]),
    },
    {
      item: 'F4',
      context: /sign ?in|SignInButton|\bF4\b|color-contrast/i,
      pattern: /\b(\d+)(?: of \d+)? (?:header )?(?:screens|routes)\b/gi,
      allowed: new Set([...values(m, 'F4', ['screens']), ...total('screens')].filter((n) => n > 0)),
    },
    {
      item: 'F5',
      context: /label|\bF5\b|checkout\/address/i,
      pattern: /\b(\d+) (?:nodes|inputs|fields)\b/gi,
      allowed: new Set(values(m, 'F5', ['nodes'])),
    },
    {
      item: 'F3',
      context: /\bF3\b|inbound|orphan|links? (?:points? )?to `?\/orders/i,
      pattern: /\b(\d+) (?:other )?routes\b/gi,
      allowed: new Set([...values(m, 'F3', ['inbound_routes']), m.versions.v1.screens - 1]),
    },
    {
      item: 'F6',
      context: /accessories|\bF6\b/i,
      pattern: /\b(\d+) (?:products|bags|mismatches)\b/gi,
      allowed: new Set([...values(m, 'F6'), ...values(m, 'C3', ['product_pages'])]),
    },
    {
      item: 'F7',
      context: /heading|\bF7\b/i,
      pattern: /\b(\d+) (?:category )?(?:screens|pages)\b/gi,
      allowed: new Set(values(m, 'F7', ['screens'])),
    },
    {
      item: 'C1',
      context: /SizeTable|overflow|\bC1\b/i,
      pattern: /\b(\d+) ?px\b/gi,
      allowed: new Set([...values(m, 'C1', ['document_width_px', 'element_width_px']), 375]),
    },
    {
      item: 'C2',
      context: /faq|\bC2\b/i,
      pattern: /\b(\d+)(?: of \d+)? answers\b/gi,
      allowed: new Set(values(m, 'C2', ['raw_answers', 'rendered_answers'])),
    },
    {
      item: 'C3',
      context: /product/i,
      pattern: /\blink depth (\d+)\b|\bdepth (\d+)\b/gi,
      allowed: new Set([...values(m, 'C3', ['product_link_depth']), 2]),
    },
    {
      item: 'All',
      context: /health/i,
      pattern: /health[^.\n|]*?\b(\d+) (?:→|->|to) (\d+)/gi,
      allowed: new Set(total('health')),
    },
  ];
}
const HISTORY = /\bbefore \d{1,2} \w+ 20\d\d\b/;
export function docMismatches(file: string, text: string, m: Manifest): DocMismatch[] {
  const out: DocMismatch[] = [];
  const rules = docRules(m);
  let generated = false;
  text.split('\n').forEach((line, k) => {
    if (/<!-- flaws:\w+ -->/.test(line)) generated = true;
    if (/<!-- \/flaws:\w+ -->/.test(line)) generated = false;
    if (generated || HISTORY.test(line)) return;
    for (const r of rules) {
      if (!r.context.test(line)) continue;
      for (const match of line.matchAll(r.pattern)) {
        for (const g of match.slice(1).filter((x) => x !== undefined)) {
          const n = Number(g);
          if (!r.allowed.has(n))
            out.push({
              file,
              line: k + 1,
              item: r.item,
              found: match[0],
              allowed: [...r.allowed].sort((a, b) => a - b).join(', '),
              text: line.trim().slice(0, 160),
            });
        }
      }
    }
  });
  return out;
}
