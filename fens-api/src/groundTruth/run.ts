import { execFile } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { listFindings } from '../agent/findings.js';
import { investigate } from '../agent/investigate.js';
import { listProposals } from '../agent/proposals.js';
import { decide, listDecisions } from '../decider/decide.js';
import { closeDb, openGraph, type ReadOnlyGraph } from '../graph/db.js';
import { syncCheck } from '../figma/syncCheck.js';
import { CLASSES, routesIn } from '../figma/sync.js';
import { screensFor } from '../integrations/figma.js';
import { collectRelease, type Release } from '../releases/collect.js';
import { findTool, runTool } from '../tools/index.js';
import { diffOf } from '../tools/releaseTools.js';
import {
  decisionCell,
  diffCell,
  figmaCell,
  findingsCell,
  graphCell,
  issueKey,
  pair,
  parseVerify,
  shopCell,
  type Cell,
  type DecisionRow,
  type DiffView,
  type IssueRow,
  type VerifyLine,
} from './cells.js';
import { docMismatches, type DocMismatch } from './docs.js';
import {
  isPresent,
  loadManifest,
  SHOP_ONLY,
  VERSIONS,
  type Item,
  type Manifest,
  type Version,
} from './manifest.js';
import { runWithContext, tenantContext } from '../tenancy/context.js';
const ROOT = resolve('..');
const SHOP = join(ROOT, 'fens-demo-shop');
const EXPLORER = join(ROOT, 'fens-explorer');
const MANIFEST = join(SHOP, 'flaws.json');
const OUT = join(ROOT, 'GROUND_TRUTH.md');
const LAYERS = [
  'Shop',
  'Graph',
  'Findings',
  'Diff',
  'Decisions',
  'Figma',
  'Proto',
  'Docs',
] as const;
const exec = promisify(execFile);
async function verify(graph: string): Promise<{
  ok: boolean;
  lines: VerifyLine[];
  tail: string;
}> {
  const run = await exec('npm', ['run', '--silent', 'verify', '--', '--graph', graph], {
    cwd: EXPLORER,
    maxBuffer: 4000000,
  }).then(
    (r) => ({ ok: true, out: r.stdout }),
    (err: { stdout?: string; stderr?: string }) => ({
      ok: false,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    }),
  );
  const tail = run.out.trim().split('\n').at(-1) ?? '';
  return { ok: run.ok, lines: parseVerify(run.out), tail };
}
const tool = async <T>(graph: string, name: string, args: Record<string, unknown> = {}) => {
  const def = findTool(name);
  if (!def) throw new Error(`No tool ${name}`);
  return (await runTool(def, graph, args)).result as T;
};
async function issueRows(g: ReadOnlyGraph): Promise<IssueRow[]> {
  return g.read<IssueRow>(`MATCH (i:Issue)
     OPTIONAL MATCH (i)-[f:FOUND_ON]->(s:Screen)
     WITH i, collect(s.id) AS screens, sum(coalesce(f.node_count, 0)) AS nodes
     OPTIONAL MATCH (i)-[:VIOLATES]->(gl:Guideline)
     WITH i, screens, nodes, collect(gl.id) AS guidelines
     OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
     RETURN i.source AS source, i.rule_id AS rule_id, d.name AS component, screens, nodes, guidelines`);
}
interface TaskRow {
  id: string;
  forced_clicks: number;
  shortest: {
    length: number | null;
  };
  detour: number | null;
}
interface GraphFacts {
  release: Release;
  issues: IssueRow[];
  findings: Set<string>;
  decisions: DecisionRow[];
  numbers: Record<string, number>;
  task: {
    forced_clicks: number;
    shortest: {
      length: number | null;
    };
    detour: number | null;
  } | null;
  iaFlagged: string[];
  overflow: {
    id: string;
    width: string;
  }[];
  homeLinks: number;
  products: {
    id: string;
    link_depth: number | null;
  }[];
}
async function facts(graph: string): Promise<GraphFacts> {
  const g = await openGraph(graph);
  const release = await collectRelease(g, graph);
  const scores = await tool<{
    ux: {
      score: number;
    };
    seo: {
      score: number;
    };
  }>(graph, 'lens_scores');
  const tasks = await tool<{
    tasks: TaskRow[];
  }>(graph, 'compare_task');
  const ia = await tool<{
    screens: {
      id: string;
      flagged: boolean;
    }[];
  }>(graph, 'ia_mismatch');
  const overflow = await tool<{
    screens: {
      id: string;
      width: string;
    }[];
  }>(graph, 'mobile_overflow_screens');
  const links = await tool<{
    link_count: number;
  }>(graph, 'screen_links', { screen: '/' });
  const proposals = await listProposals(g);
  const decisions = await listDecisions(g);
  return {
    release,
    issues: await issueRows(g),
    findings: new Set((await listFindings(g)).filter((f) => !f.stale).map((f) => f.key)),
    decisions: proposals.map((p) => {
      const d = decisions.find((x) => x.proposal_key === p.key);
      return { key: p.key, outcome: d?.outcome ?? null, playbook: d?.playbook?.id ?? null };
    }),
    numbers: {
      screens: release.screens.length,
      orphans: release.orphans.length,
      dead_ends: release.deadEnds.length,
      health: release.health.score,
      ux_score: scores.ux.score,
      seo_score: scores.seo.score,
    },
    task: tasks.tasks.find((t) => t.id === 'buy-a-product') ?? null,
    iaFlagged: ia.screens.filter((s) => s.flagged).map((s) => s.id),
    overflow: overflow.screens,
    homeLinks: links.link_count,
    products: await g.read<{
      id: string;
      link_depth: number | null;
    }>(
      "MATCH (s:Screen) WHERE s.id STARTS WITH '/product/' RETURN s.id AS id, s.link_depth AS link_depth",
    ),
  };
}
async function measure(
  graph: string,
  item: Item,
  f: GraphFacts,
): Promise<Record<string, number | null>> {
  const g = await openGraph(graph);
  const route = item.routes[0] ?? '/';
  const out: Record<string, number | null> = {};
  const keys = new Set([...Object.keys(item.expected.v1), ...Object.keys(item.expected.v2)]);
  const one = async (q: string) =>
    (
      await g.read<{
        n: number | null;
      }>(q, { id: route })
    )[0]?.n ?? null;
  const matched = item.detection.issues.flatMap((d) =>
    f.issues.filter(
      (i) =>
        i.rule_id === d.rule_id &&
        i.source === d.source &&
        (d.component === null || i.component === d.component),
    ),
  );
  for (const k of keys) {
    if (SHOP_ONLY.has(k)) continue;
    if (k === 'forced_clicks') out[k] = f.task?.forced_clicks ?? null;
    else if (k === 'shortest_clicks') out[k] = f.task?.shortest.length ?? null;
    else if (k === 'detour') out[k] = f.task?.detour ?? null;
    else if (k === 'orphans' || k === 'dead_ends') out[k] = f.numbers[k] ?? null;
    else if (k === 'outgoing_edges')
      out[k] = await one(
        'MATCH (s:Screen {id: $id}) OPTIONAL MATCH (s)-[e:NAVIGATES_TO]->() RETURN count(e) AS n',
      );
    else if (k === 'inbound_routes')
      out[k] = await one(
        'MATCH (s:Screen {id: $id}) OPTIONAL MATCH (a:Screen)-[:NAVIGATES_TO]->(s) RETURN count(DISTINCT a) AS n',
      );
    else if (k === 'link_depth')
      out[k] = await one('MATCH (s:Screen {id: $id}) RETURN s.link_depth AS n');
    else if (k === 'screens')
      out[k] = item.detection.issues.length
        ? new Set(matched.flatMap((i) => i.screens)).size
        : item.routes.filter((r) => f.iaFlagged.includes(r)).length;
    else if (k === 'nodes') out[k] = matched.reduce((n, i) => n + i.nodes, 0);
    else if (k === 'issues') out[k] = matched.length;
    else if (k === 'listed_products' || k === 'bags') {
      const ids = (
        await g.read<{
          id: string;
        }>(
          "MATCH (:Screen {id: $id})-[:NAVIGATES_TO]->(p:Screen) WHERE p.id STARTS WITH '/product/' RETURN DISTINCT p.id AS id",
          { id: route },
        )
      ).map((r) => r.id);
      out[k] =
        k === 'bags' ? ids.filter((id) => id.startsWith('/product/bag-')).length : ids.length;
    } else if (k === 'element_width_px') {
      const w = f.overflow.find((o) => o.id === route)?.width;
      out[k] = w ? Number.parseInt(w, 10) : null;
    } else if (k === 'product_pages') out[k] = f.products.length;
    else if (k === 'product_link_depth') {
      const depths = new Set(f.products.map((p) => p.link_depth));
      out[k] = depths.size === 1 ? ([...depths][0] ?? null) : null;
    } else if (k === 'home_plain_links') out[k] = f.homeLinks;
  }
  return out;
}
async function newestFile(paths: string[]): Promise<{
  path: string;
  mtime: number;
} | null> {
  let best: {
    path: string;
    mtime: number;
  } | null = null;
  const walk = async (p: string): Promise<void> => {
    const s = await stat(p).catch(() => null);
    if (!s) return;
    if (s.isDirectory()) {
      for (const e of await readdir(p))
        if (e !== 'node_modules' && !e.startsWith('.')) await walk(join(p, e));
    } else if (!best || s.mtimeMs > best.mtime) best = { path: p, mtime: s.mtimeMs };
  };
  for (const p of paths) await walk(p);
  return best;
}
async function docFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const f of ['DEMO.md', 'CLAUDE.md', 'README.md', 'AGENTS.md']) out.push(join(ROOT, f));
  for (const p of ['fens-api', 'fens-dashboard', 'fens-explorer', 'fens-demo-shop'])
    for (const f of ['README.md', 'CLAUDE.md']) out.push(join(ROOT, p, f));
  out.push(join(SHOP, 'FLAWS.md'));
  const present: string[] = [];
  for (const f of out) if (await stat(f).catch(() => null)) present.push(f);
  return present;
}
const rel = (p: string) => relative(ROOT, p);
function mdTable(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}
function textTable(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i] ?? 0)).join('  ');
  return [line(head), line(w.map((n) => '-'.repeat(n))), ...rows.map(line)].join('\n');
}
const fmt = (v: number | null | undefined) =>
  v === undefined ? '—' : v === null ? 'none' : String(v);
async function main(): Promise<number> {
  const manifest: Manifest = await loadManifest(MANIFEST);
  const graphs = { v1: manifest.versions.v1.graph, v2: manifest.versions.v2.graph };
  const noRun = process.argv.includes('--no-run');
  console.log(
    `Ground truth: ${rel(MANIFEST)} (${manifest.items.length} items) against ${graphs.v1} and ${graphs.v2}`,
  );
  const shop = { v1: await verify(graphs.v1), v2: await verify(graphs.v2) };
  console.log(`  verify ${graphs.v1}: ${shop.v1.tail}`);
  console.log(`  verify ${graphs.v2}: ${shop.v2.tail}`);
  if (!noRun)
    for (const v of VERSIONS) {
      await investigate(graphs[v], 'rules', 'both', () => {});
      await decide(graphs[v], 'rules', () => {});
      console.log(`  rules-mode investigate and decide on ${graphs[v]}: done`);
    }
  const f = { v1: await facts(graphs.v1), v2: await facts(graphs.v2) };
  const d = diffOf(f.v1.release, f.v2.release);
  const diff: DiffView = {
    issues: {
      fixed: d.issues.fixed.map((i) => issueKey(i.rule_id, i.component)),
      new: d.issues.new.map((i) => issueKey(i.rule_id, i.component)),
      unchanged: d.issues.unchanged.map((i) => issueKey(i.rule_id, i.component)),
    },
    findings: {
      resolved: d.findings.resolved.map((x) => x.key),
      new: d.findings.new.map((x) => x.key),
      persisting: d.findings.persisting.map((x) => x.key),
    },
  };
  let figmaMap: unknown = {};
  const mapPath = resolve('figma-map.json');
  try {
    figmaMap = JSON.parse(await readFile(mapPath, 'utf8'));
  } catch {}
  const frames = { v1: screensFor(figmaMap, graphs.v1), v2: screensFor(figmaMap, graphs.v2) };
  const mapTime = (await stat(mapPath).catch(() => null))?.mtimeMs ?? 0;
  const newest = await newestFile([
    join(SHOP, 'src'),
    join(SHOP, 'server'),
    join(SHOP, 'public'),
    join(SHOP, 'routes.json'),
    join(SHOP, 'index.html'),
  ]);
  const stale = newest && newest.mtime > mapTime ? newest : null;
  const sync = Object.fromEntries((await syncCheck()).map((s) => [s.graph, s]));
  const syncLines = (v: Version) => {
    const s = sync[graphs[v]];
    if (!s?.result) return [`${v}: ${s?.error ?? 'no sync result'}`];
    return CLASSES.flatMap((c) =>
      (s.result?.classes[c] ?? []).map((x) => `${v}: prototype ${c.replace(/_/g, ' ')}: ${x}`),
    );
  };
  const protoCell = (item: Item, v: Version, p: string[]): Cell => {
    if (!isPresent(item, v)) return 'n/a';
    const mine = syncLines(v).filter((x) => routesIn(x).some((r) => item.routes.includes(r)));
    p.push(...mine);
    return mine.length ? 'FAIL' : 'PASS';
  };
  const docs: DocMismatch[] = [];
  for (const file of await docFiles())
    docs.push(...docMismatches(rel(file), await readFile(file, 'utf8'), manifest));
  const problems = new Map<string, string[]>();
  const rows: string[][] = [];
  const measured: Record<string, Record<Version, Record<string, number | null>>> = {};
  let failed = 0;
  for (const item of manifest.items) {
    const p: string[] = [];
    const m = {
      v1: await measure(graphs.v1, item, f.v1),
      v2: await measure(graphs.v2, item, f.v2),
    };
    measured[item.id] = m;
    const docRows = docs.filter((x) => x.item === item.id);
    for (const x of docRows)
      p.push(`docs: ${x.file}:${x.line} says "${x.found}" (manifest allows ${x.allowed})`);
    const cells: string[] = [
      pair(shopCell(item, shop.v1.lines, p), shopCell(item, shop.v2.lines, p)),
      pair(
        graphCell(item, 'v1', f.v1.issues, m.v1, p),
        graphCell(item, 'v2', f.v2.issues, m.v2, p),
      ),
      pair(findingsCell(item, 'v1', f.v1.findings, p), findingsCell(item, 'v2', f.v2.findings, p)),
      diffCell(item, diff, p),
      pair(
        decisionCell(item, 'v1', f.v1.decisions, p),
        decisionCell(item, 'v2', f.v2.decisions, p),
      ),
      pair(figmaCell(item, 'v1', frames.v1, p), figmaCell(item, 'v2', frames.v2, p)),
      pair(protoCell(item, 'v1', p), protoCell(item, 'v2', p)),
      (docRows.length ? 'FAIL' : 'PASS') as Cell,
    ];
    if (cells.some((c) => c.includes('FAIL'))) failed++;
    problems.set(item.id, p);
    rows.push([item.id, item.title.slice(0, 44), ...cells]);
  }
  const totalProblems: string[] = [];
  const totalCell = (v: Version): Cell => {
    const bad = Object.entries(manifest.versions[v])
      .filter(([k]) => k in f[v].numbers)
      .filter(([k, want]) => f[v].numbers[k] !== want)
      .map(([k, want]) => `${v}: ${k} expected ${want}, measured ${f[v].numbers[k]}`);
    totalProblems.push(...bad);
    return bad.length ? 'FAIL' : 'PASS';
  };
  const allDocs = docs.filter((x) => x.item === 'All');
  for (const x of allDocs)
    totalProblems.push(
      `docs: ${x.file}:${x.line} says "${x.found}" (manifest allows ${x.allowed})`,
    );
  const shopAll = (v: Version): Cell => (shop[v].ok ? 'PASS' : 'FAIL');
  const protoAll = (v: Version): Cell => {
    const lines = syncLines(v);
    totalProblems.push(...lines);
    return lines.length ? 'FAIL' : 'PASS';
  };
  const totals = [
    'All',
    'Totals and overall verify',
    pair(shopAll('v1'), shopAll('v2')),
    pair(totalCell('v1'), totalCell('v2')),
    'n/a / n/a',
    'n/a',
    'n/a / n/a',
    'n/a / n/a',
    pair(protoAll('v1'), protoAll('v2')),
    allDocs.length ? 'FAIL' : 'PASS',
  ];
  if (totals.some((c) => c.includes('FAIL'))) failed++;
  rows.push(totals);
  problems.set('All', totalProblems);
  const claimed = new Set(manifest.items.flatMap((i) => i.detection.findings));
  const claimedProposals = new Set(
    manifest.items
      .filter((i) => i.proposal)
      .map((i) => `${i.proposal?.change_type}|${i.proposal?.target}`),
  );
  const unexplained = VERSIONS.flatMap((v) => [
    ...[...f[v].findings].filter((k) => !claimed.has(k)).map((k) => `${v}: finding ${k}`),
    ...f[v].decisions
      .filter((r) => !claimedProposals.has(r.key))
      .map((r) => `${v}: proposal ${r.key}`),
    ...shop[v].lines.filter((l) => l.verdict === 'WARN').map((l) => `${v}: verify WARN ${l.text}`),
  ]);
  if (unexplained.length) failed++;
  const head = ['ID', 'Title', ...LAYERS];
  console.log('');
  console.log(textTable(head, rows));
  console.log('');
  console.log('Cells read v1 / v2; Diff is v1 to v2. n/a: the layer does not apply to that item.');
  for (const [id, list] of problems) for (const x of list) console.log(`  FAIL  ${id}: ${x}`);
  for (const x of unexplained) console.log(`  FAIL  not in the manifest: ${x}`);
  for (const s of Object.values(sync))
    for (const w of s.warnings)
      console.log(`  WARN  Figma prototype (${s.graph}): ${w}; re-export with scripts/figma-wire.`);
  if (stale)
    console.log(
      `  WARN  ${rel(stale.path)} changed after figma-map.json (${new Date(stale.mtime).toISOString()} > ${new Date(mapTime).toISOString()}): the Figma frames may be stale; recapture them.`,
    );
  await writeFile(
    OUT,
    groundTruthMd(
      manifest,
      head,
      rows,
      problems,
      unexplained,
      measured,
      f,
      shop,
      stale,
      mapTime,
      noRun,
    ),
  );
  console.log(
    `\nWrote ${rel(OUT)}. ${failed === 0 ? 'All rows pass.' : `${failed} row(s) with a FAIL.`}`,
  );
  return failed === 0 ? 0 : 1;
}
function groundTruthMd(
  m: Manifest,
  head: string[],
  rows: string[][],
  problems: Map<string, string[]>,
  unexplained: string[],
  measured: Record<string, Record<Version, Record<string, number | null>>>,
  f: Record<Version, GraphFacts>,
  shop: Record<
    Version,
    {
      tail: string;
    }
  >,
  stale: {
    path: string;
    mtime: number;
  } | null,
  mapTime: number,
  noRun: boolean,
): string {
  const problemLines = [...problems].flatMap(([id, list]) => list.map((x) => `- ${id}: ${x}`));
  const expectedRows: string[][] = [];
  for (const [k, label] of [
    ['screens', 'Screens'],
    ['orphans', 'Orphans'],
    ['dead_ends', 'Dead ends'],
    ['health', 'Health (illustrative)'],
    ['ux_score', 'UX lens score'],
    ['seo_score', 'SEO lens score'],
  ] as const)
    expectedRows.push([
      'All',
      label,
      fmt(m.versions.v1[k]),
      fmt(m.versions.v2[k]),
      `${fmt(f.v1.numbers[k])} / ${fmt(f.v2.numbers[k])}`,
      'graph',
    ]);
  for (const i of m.items) {
    const keys = [...new Set([...Object.keys(i.expected.v1), ...Object.keys(i.expected.v2)])];
    for (const k of keys)
      expectedRows.push([
        i.id,
        k.replace(/_/g, ' '),
        fmt(i.expected.v1[k] ?? null),
        fmt(i.expected.v2[k] ?? null),
        SHOP_ONLY.has(k) ? '—' : `${fmt(measured[i.id]?.v1[k])} / ${fmt(measured[i.id]?.v2[k])}`,
        SHOP_ONLY.has(k) ? 'shop (FLAWS.md)' : 'graph',
      ]);
  }
  return [
    '# Ground truth',
    '',
    `Generated by \`npm run ground-truth\` in fens-api on ${new Date().toISOString().slice(0, 10)} from \`fens-demo-shop/flaws.json\` (measured ${m.measured_on}). Do not edit by hand. Other documents (DEMO.md included) take their flaw numbers from this file.`,
    '',
    `Graphs: \`${m.versions.v1.graph}\` (v1) and \`${m.versions.v2.graph}\` (v2). ${noRun ? 'Stored findings and decisions were read (--no-run).' : 'Findings and decisions come from a fresh rules-mode run.'} The Figma layer reads only \`fens-api/figma-map.json\`; the Figma API is never called.`,
    '',
    '## Layers',
    '',
    mdTable(head, rows),
    '',
    "Cells read v1 / v2; Diff is v1 to v2. n/a: the layer does not apply to that item. Shop is fens-explorer's `verify`; Graph checks the Issues, tools and numbers; Findings, rules mode; Diff, `diff_releases`; Decisions, the decider (rules); Figma, `figma-map.json`; Docs, hard-coded numbers in the READMEs, CLAUDE.md files, FLAWS.md prose and DEMO.md.",
    '',
    `verify: v1 "${shop.v1.tail}", v2 "${shop.v2.tail}".`,
    '',
    '## Problems',
    '',
    ...(problemLines.length || unexplained.length
      ? [...problemLines, ...unexplained.map((x) => `- not in the manifest: ${x}`)]
      : ['None.']),
    ...(stale
      ? [
          '',
          `**Figma frames may be stale:** \`${rel(stale.path)}\` changed after \`figma-map.json\` (${new Date(stale.mtime).toISOString()} > ${new Date(mapTime).toISOString()}). Recapture the frames and update the node ids.`,
        ]
      : []),
    '',
    '## Expected numbers',
    '',
    'Expected values come from `flaws.json`; measured values from the graphs on this run. Numbers marked shop are measured in the browser (FLAWS.md) and checked by `verify`, not in the graph.',
    '',
    mdTable(['ID', 'Measure', 'v1', 'v2', 'Measured v1 / v2', 'Where'], expectedRows),
    '',
    '## Items',
    '',
    ...m.items.map(
      (i) =>
        `- **${i.id}** (${i.kind}) ${i.title}. v1 ${i.status.v1}, v2 ${i.status.v2}. Routes: ${i.routes.join(', ')}.${i.proposal ? ` Proposal: ${i.proposal.agent} ${i.proposal.change_type} on ${i.proposal.target} (${i.proposal.versions.join(', ')}), decision ${i.decision?.outcome ?? 'none'}${i.decision?.playbook ? ` with ${i.decision.playbook}` : ''}.` : ''}${i.notes ? ` ${i.notes}` : ''}`,
    ),
    '',
  ].join('\n');
}
runWithContext(tenantContext('fence-team', 'worker-ground-truth'), main)
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
