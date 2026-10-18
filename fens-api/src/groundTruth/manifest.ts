import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const status = z.enum(['present', 'fixed', 'persisting']);
const version = z.enum(['v1', 'v2']);
const numbers = z.record(z.string(), z.number().nullable());
const itemSchema = z.object({
  id: z.string().regex(/^[FCU]\d+$/),
  kind: z.enum(['flaw', 'conflict', 'unplanted']),
  title: z.string(),
  routes: z.array(z.string()),
  status: z.object({ v1: status, v2: status }),
  detection: z.object({
    issues: z.array(
      z.object({
        source: z.string(),
        rule_id: z.string(),
        component: z.string().nullable(),
        guideline: z.string().nullable(),
      }),
    ),
    tools: z.array(z.string()),
    findings: z.array(z.string()),
    category: z.string(),
  }),
  expected: z.object({ v1: numbers, v2: numbers }),
  proposal: z
    .object({
      agent: z.string(),
      change_type: z.string(),
      target: z.string(),
      versions: z.array(version),
    })
    .nullable(),
  decision: z
    .object({ outcome: z.string(), playbook: z.string().nullable(), versions: z.array(version) })
    .nullable(),
  figma_routes: z.array(z.string()),
  notes: z.string().optional(),
});
const versionTotals = z.object({
  graph: z.string(),
  port: z.number(),
  screens: z.number(),
  orphans: z.number(),
  dead_ends: z.number(),
  health: z.number(),
  ux_score: z.number(),
  seo_score: z.number(),
});
export const manifestSchema = z.object({
  measured_on: z.string(),
  versions: z.object({ v1: versionTotals, v2: versionTotals }),
  items: z.array(itemSchema).min(1),
});
export type Manifest = z.infer<typeof manifestSchema>;
export type Item = Manifest['items'][number];
export type Version = z.infer<typeof version>;
export const VERSIONS: Version[] = ['v1', 'v2'];
export async function loadManifest(path: string): Promise<Manifest> {
  const parsed = manifestSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!parsed.success)
    throw new Error(`${path} is not a valid manifest:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
export const isPresent = (i: Item, v: Version) => i.status[v] !== 'fixed';
export const SHOP_ONLY = new Set([
  'contrast_ratio',
  'axe_label_violations',
  'document_width_px',
  'raw_answers',
  'rendered_answers',
]);
