import { parseArgs } from 'node:util';
import { z } from 'zod';
import { normalizePath } from '../crawl/normalize.js';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
export const GRAPH_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export interface CrawlOptions {
  graph: string;
  url: URL;
  seeds: string[];
  maxScreens: number;
  maxDepth: number;
  collapseTemplates: boolean;
  headed: boolean;
  reset: boolean;
  checks: boolean;
  seo: boolean;
  lighthouse: boolean;
  tasks: string | null;
  storageState: string | null;
}
export const CRAWL_USAGE = `Usage: npm run crawl -- --graph <name> [--url <url>] [--seed <path> ...]
       [--max-screens 60] [--max-depth 8] [--collapse-templates] [--headed] [--reset] [--no-checks] [--no-seo] [--no-lighthouse] [--tasks <file>] [--storage-state <file>] [--allow-remote]`;
const schema = z.object({
  graph: z.string().regex(GRAPH_NAME, 'graph must be letters, digits, "-" or "_" (max 64)'),
  url: z.url(),
  seed: z.array(z.string().startsWith('/', 'seed paths must start with "/"')),
  maxScreens: z.coerce.number().int().min(1).max(1000),
  maxDepth: z.coerce.number().int().min(0).max(50),
});
export function parseCrawlArgs(argv: string[], defaultUrl: string): CrawlOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      graph: { type: 'string' },
      url: { type: 'string' },
      seed: { type: 'string', multiple: true },
      'max-screens': { type: 'string' },
      'max-depth': { type: 'string' },
      'collapse-templates': { type: 'boolean', default: false },
      headed: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      'allow-remote': { type: 'boolean', default: false },
      'no-checks': { type: 'boolean', default: false },
      'no-seo': { type: 'boolean', default: false },
      'no-lighthouse': { type: 'boolean', default: false },
      tasks: { type: 'string' },
      'storage-state': { type: 'string' },
    },
  });
  const parsed = schema.safeParse({
    graph: values.graph,
    url: values.url ?? defaultUrl,
    seed: values.seed ?? [],
    maxScreens: values['max-screens'] ?? 60,
    maxDepth: values['max-depth'] ?? 8,
  });
  if (!parsed.success) {
    throw new Error(`${z.prettifyError(parsed.error)}\n${CRAWL_USAGE}`);
  }
  const url = new URL(parsed.data.url);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Only http(s) URLs can be crawled, got ${url.protocol}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname) && !values['allow-remote']) {
    throw new Error(
      `Refusing to crawl ${url.hostname}: only localhost and 127.0.0.1 are allowed. Pass --allow-remote to override.`,
    );
  }
  const seeds = parsed.data.seed.map((s) => normalizePath(s, url.origin));
  return {
    graph: parsed.data.graph,
    url,
    seeds: [...new Set(seeds.filter((s): s is string => s !== null))],
    maxScreens: parsed.data.maxScreens,
    maxDepth: parsed.data.maxDepth,
    collapseTemplates: values['collapse-templates'] ?? false,
    headed: values.headed ?? false,
    reset: values.reset ?? false,
    checks: !(values['no-checks'] ?? false),
    seo: !(values['no-seo'] ?? false),
    lighthouse: !(values['no-seo'] ?? false) && !(values['no-lighthouse'] ?? false),
    tasks: values.tasks ?? null,
    storageState: values['storage-state'] ?? null,
  };
}
