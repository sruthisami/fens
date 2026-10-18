import { readFile } from 'node:fs/promises';
export interface ExpectedRoutes {
  all: string[];
  v1: string[];
  v2: string[];
}
export async function readExpectedRoutes(flawsPath: string): Promise<ExpectedRoutes> {
  const text = await readFile(flawsPath, 'utf8');
  const section = text.split(/^## Route inventory/m)[1]?.split(/^## /m)[0];
  if (!section) throw new Error(`No "## Route inventory" section in ${flawsPath}`);
  const rows = section
    .split('\n')
    .filter((line) => /^\|\s*`\//.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()));
  const all: string[] = [];
  const v2: string[] = [];
  for (const cells of rows) {
    const route = cells[1]?.replace(/`/g, '');
    const v2Cell = cells[4] ?? '';
    if (!route) continue;
    all.push(route);
    if (!/^redirects/i.test(v2Cell)) v2.push(route);
  }
  if (all.length === 0) throw new Error(`Route inventory in ${flawsPath} has no rows`);
  return { all, v1: all, v2 };
}
export interface KnownFinding {
  rule: string;
  source: string;
  screens: string[];
  versions: string[];
}
export async function readKnownFindings(flawsPath: string): Promise<KnownFinding[]> {
  const text = await readFile(flawsPath, 'utf8');
  const section = text.split(/^## Unplanted findings/m)[1]?.split(/^## /m)[0];
  if (!section) return [];
  const strip = (cell: string) => cell.replace(/`/g, '').trim();
  return section
    .split('\n')
    .filter((line) => /^\|\s*`/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map((cells) => ({
      rule: strip(cells[1] ?? ''),
      source: strip(cells[2] ?? ''),
      screens: (cells[3] ?? '').split(',').map(strip).filter(Boolean),
      versions: (cells[4] ?? '').split(',').map(strip).filter(Boolean),
    }))
    .filter((k) => k.rule.length > 0);
}
interface ManifestItem {
  id: string;
  routes: string[];
  expected: Record<'v1' | 'v2', Record<string, number | null>>;
}
export interface Manifest {
  num(id: string, version: 'v1' | 'v2', key: string): number;
  routes(id: string): string[];
}
export async function readManifest(path: string): Promise<Manifest> {
  const data = JSON.parse(await readFile(path, 'utf8')) as {
    items: ManifestItem[];
  };
  const item = (id: string) => {
    const found = data.items.find((i) => i.id === id);
    if (!found) throw new Error(`${path} has no item ${id}`);
    return found;
  };
  return {
    num(id, version, key) {
      const v = item(id).expected[version]?.[key];
      if (typeof v !== 'number')
        throw new Error(`${path}: ${id} has no number ${key} for ${version}`);
      return v;
    },
    routes: (id) => item(id).routes,
  };
}
