import { parseArgs } from 'node:util';
import { GRAPH_NAME } from './cli/args.js';
import { connect } from './graph/client.js';
import { readExpectedRoutes, readKnownFindings, readManifest } from './verify/flaws.js';
const USAGE =
  'Usage: npm run verify -- --graph <name> [--version v1|v2] [--flaws <path to FLAWS.md>] [--manifest <path to flaws.json>]';
interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      graph: { type: 'string' },
      version: { type: 'string' },
      flaws: { type: 'string', default: '../fens-demo-shop/FLAWS.md' },
      manifest: { type: 'string', default: '../fens-demo-shop/flaws.json' },
    },
  });
  const name = values.graph;
  if (!name || !GRAPH_NAME.test(name)) throw new Error(`--graph is required.\n${USAGE}`);
  const version = values.version ?? (/v2$/i.test(name) ? 'v2' : 'v1');
  if (version !== 'v1' && version !== 'v2')
    throw new Error(`--version must be v1 or v2.\n${USAGE}`);
  const expected = await readExpectedRoutes(values.flaws ?? '');
  const expectedScreens = version === 'v1' ? expected.v1 : expected.v2;
  const manifest = await readManifest(values.manifest ?? '');
  const n = (id: string, key: string) => manifest.num(id, version, key);
  const db = await connect();
  try {
    if (!(await db.list()).includes(name))
      throw new Error(`Graph ${name} does not exist. Run a crawl first.`);
    const graph = db.selectGraph(name);
    const rows = async <T>(q: string, params?: Record<string, unknown>) =>
      (await graph.roQuery<T>(q, params ? { params: params as never } : undefined)).data ?? [];
    const screens = (
      await rows<{
        id: string;
      }>('MATCH (s:Screen) RETURN s.id AS id')
    ).map((r) => r.id);
    const degree = async (id: string, dir: 'in' | 'out') => {
      const pattern = dir === 'out' ? '(s)-[e:NAVIGATES_TO]->()' : '()-[e:NAVIGATES_TO]->(s)';
      const r = await rows<{
        n: number;
      }>(`MATCH (s:Screen {id: $id}) OPTIONAL MATCH ${pattern} RETURN count(e) AS n`, { id });
      return r[0]?.n ?? null;
    };
    const screensWith = async (component: string) =>
      (
        await rows<{
          id: string;
        }>(
          `MATCH (s:Screen)-[:CONTAINS]->(:Component)-[:INSTANCE_OF]->(:DesignSystemComponent {name: $name})
           RETURN DISTINCT s.id AS id`,
          { name: component },
        )
      ).map((r) => r.id);
    const shortest = await rows<{
      hops: number;
      ids: string[];
    }>(`MATCH (a:Screen {id: '/'}), (b:Screen {id: '/checkout/confirmation'})
       WITH shortestPath((a)-[:NAVIGATES_TO*]->(b)) AS p
       RETURN length(p) AS hops, [n IN nodes(p) | n.id] AS ids`).catch((err: Error) => {
      console.log('  info  shortest path query failed:', err.message);
      return [];
    });
    const checks: Check[] = [];
    const missing = expectedScreens.filter((r) => !screens.includes(r));
    const extra = screens.filter((s) => !expectedScreens.includes(s));
    checks.push({
      name: `Screen count matches FLAWS.md (${version})`,
      pass: screens.length === expectedScreens.length && missing.length === 0 && extra.length === 0,
      detail:
        `expected ${expectedScreens.length}, found ${screens.length}` +
        (missing.length ? `; missing ${missing.join(', ')}` : '') +
        (extra.length ? `; unexpected ${extra.join(', ')}` : ''),
    });
    const resetOut = await degree('/reset-sent', 'out');
    checks.push(
      version === 'v1'
        ? {
            name: 'F2: /reset-sent has no outgoing edges',
            pass: resetOut === 0,
            detail: `outgoing = ${resetOut ?? 'screen not found'}`,
          }
        : {
            name: 'F2 fixed: /reset-sent has outgoing edges',
            pass: (resetOut ?? 0) > 0,
            detail: `outgoing = ${resetOut ?? 'screen not found'}`,
          },
    );
    const ordersIn = await degree('/orders', 'in');
    checks.push(
      version === 'v1'
        ? {
            name: 'F3: /orders has no inbound edges',
            pass: ordersIn === 0,
            detail: `inbound = ${ordersIn ?? 'screen not found (crawl with --seed /orders)'}`,
          }
        : {
            name: 'F3 fixed: /orders has inbound edges',
            pass: (ordersIn ?? 0) > 0,
            detail: `inbound = ${ordersIn ?? 'screen not found'}`,
          },
    );
    const withHeader = await screensWith('Header');
    const withSignIn = await screensWith('SignInButton');
    const lacking = withHeader.filter((s) => !withSignIn.includes(s));
    checks.push({
      name: 'F4: SignInButton is contained by every screen with the shared Header',
      pass: withHeader.length > 0 && lacking.length === 0,
      detail:
        `${withSignIn.length} of ${withHeader.length} header screens` +
        (lacking.length ? `; missing on ${lacking.join(', ')}` : ''),
    });
    if (version === 'v1') {
      checks.push({
        name: 'F2/F4: /reset-sent has no Header and no SignInButton in v1',
        pass: !withHeader.includes('/reset-sent') && !withSignIn.includes('/reset-sent'),
        detail: `header=${withHeader.includes('/reset-sent')}, signIn=${withSignIn.includes('/reset-sent')}`,
      });
    }
    interface IssueRow {
      id: string;
      rule_id: string;
      source: string;
      component: string | null;
      guidelines: string[];
      screens: string[];
      nodes: number[];
    }
    const issues = await rows<IssueRow>(`MATCH (i:Issue)
       OPTIONAL MATCH (i)-[f:FOUND_ON]->(s:Screen)
       WITH i, collect(s.id) AS screens, collect(f.node_count) AS nodes
       OPTIONAL MATCH (i)-[:VIOLATES]->(g:Guideline)
       WITH i, screens, nodes, collect(g.id) AS guidelines
       OPTIONAL MATCH (i)-[:IN_COMPONENT]->(d:DesignSystemComponent)
       RETURN i.id AS id, i.rule_id AS rule_id, i.source AS source, d.name AS component,
              guidelines, screens, nodes`);
    const contrast = issues.filter(
      (i) => i.rule_id === 'color-contrast' && i.component === 'SignInButton',
    );
    const labels = issues.filter((i) => i.rule_id === 'flowlens/label-missing');
    const sameSet = (a: string[], b: string[]) =>
      a.length === b.length && a.every((x) => b.includes(x));
    if (version === 'v1') {
      const c = contrast[0];
      checks.push({
        name: `F4: one color-contrast Issue on SignInButton (WCAG 1.4.3), on every header screen (${n('F4', 'screens')})`,
        pass:
          contrast.length === 1 &&
          !!c &&
          c.guidelines.includes('WCAG 1.4.3') &&
          sameSet(c.screens, withHeader) &&
          c.screens.length === n('F4', 'screens') &&
          !c.screens.includes('/reset-sent'),
        detail: c
          ? `${contrast.length} issue(s); on ${c.screens.length} of ${withHeader.length} header screens; guidelines ${c.guidelines.join(', ')}`
          : 'not found',
      });
      const l = labels[0];
      checks.push({
        name: `F5: one flowlens/label-missing Issue on /checkout/address (${n('F5', 'nodes')} nodes, FormField, WCAG 3.3.2)`,
        pass:
          labels.length === 1 &&
          !!l &&
          sameSet(l.screens, manifest.routes('F5')) &&
          l.nodes[0] === n('F5', 'nodes') &&
          l.component === 'FormField' &&
          l.guidelines.includes('WCAG 3.3.2'),
        detail: l
          ? `${labels.length} issue(s); screens ${l.screens.join(', ')}; nodes ${l.nodes.join(', ')}; component ${l.component ?? 'none'}; guidelines ${l.guidelines.join(', ')}`
          : 'not found',
      });
    } else {
      checks.push({
        name: 'F4 fixed: no color-contrast Issue on SignInButton',
        pass: contrast.length === 0,
        detail: `${contrast.length} found`,
      });
      checks.push({
        name: 'F5 fixed: no flowlens/label-missing Issue',
        pass: labels.length === 0,
        detail: `${labels.length} found`,
      });
    }
    const headings = issues.filter((i) => i.rule_id === 'heading-order');
    const heading = headings[0];
    checks.push({
      name: 'F7: one heading-order Issue on ProductCard across /shoes, /bags and /accessories',
      pass:
        headings.length === 1 &&
        !!heading &&
        heading.component === 'ProductCard' &&
        sameSet(heading.screens, manifest.routes('F7')) &&
        heading.screens.length === n('F7', 'screens'),
      detail: heading
        ? `${headings.length} issue(s); component ${heading.component ?? 'none'}; screens ${heading.screens.join(', ')}`
        : 'not found',
    });
    const landmarks = issues.filter(
      (i) => i.rule_id === 'landmark-one-main' || i.rule_id === 'region',
    );
    checks.push(
      version === 'v1'
        ? {
            name: 'F8: landmark-one-main and region Issues on /reset-sent',
            pass:
              landmarks.length === 2 && landmarks.every((i) => sameSet(i.screens, ['/reset-sent'])),
            detail: `${landmarks.length} issue(s): ${landmarks.map((i) => `${i.rule_id} on ${i.screens.join(', ')}`).join('; ') || 'none'}`,
          }
        : {
            name: 'F8 fixed: no landmark-one-main or region Issues',
            pass: landmarks.length === 0,
            detail: `${landmarks.length} found`,
          },
    );
    const accessoryProducts = (
      await rows<{
        id: string;
      }>(`MATCH (:Screen {id: '/accessories'})-[:NAVIGATES_TO]->(p:Screen)
         WHERE p.id STARTS WITH '/product/' RETURN p.id AS id`)
    ).map((r) => r.id.replace('/product/', ''));
    const bags = accessoryProducts.filter((id) => id.startsWith('bag-'));
    checks.push({
      name: `F6: /accessories lists ${n('F6', 'listed_products')} products, ${n('F6', 'bags')} of them bags (both versions)`,
      pass:
        accessoryProducts.length === n('F6', 'listed_products') && bags.length === n('F6', 'bags'),
      detail: `${accessoryProducts.length} products (${accessoryProducts.join(', ')}); ${bags.length} bags`,
    });
    const journey = await rows<{
      clicks: number;
    }>(`MATCH (t:Task {id: 'buy-a-product'}) RETURN t.clicks AS clicks`);
    const clicks = journey[0]?.clicks ?? null;
    const hops = shortest[0]?.hops ?? null;
    checks.push(
      version === 'v1'
        ? {
            name: `F1: main checkout journey is ${n('F1', 'forced_clicks')} clicks, and a ${n('F1', 'shortest_clicks')}-edge shortcut exists (v1)`,
            pass: clicks === n('F1', 'forced_clicks') && hops === n('F1', 'shortest_clicks'),
            detail: `main journey ${clicks ?? 'not recorded (run journey)'} clicks; shortest ${hops ?? 'none'} edges`,
          }
        : {
            name: `F1 fixed: main checkout journey is ${n('F1', 'forced_clicks')} clicks, shortcut ${n('F1', 'shortest_clicks')} edges (v2)`,
            pass: clicks === n('F1', 'forced_clicks') && hops === n('F1', 'shortest_clicks'),
            detail: `main journey ${clicks ?? 'not recorded (run journey)'} clicks; shortest ${hops ?? 'none'} edges`,
          },
    );
    const notes: string[] = [];
    const seoIssues: IssueRow[] = [];
    const seoScreens = await rows<{
      id: string;
      link_depth: number | null;
      jsonld: string[] | null;
      ratio: number | null;
    }>(`MATCH (s:Screen)
       RETURN s.id AS id, s.link_depth AS link_depth, s.jsonld_types AS jsonld, s.js_only_ratio AS ratio`);
    if (seoScreens.some((s) => s.ratio !== null)) {
      const overflow = issues.filter((i) => i.rule_id === 'flowlens/mobile-overflow');
      const sizeTable = overflow.find((i) => i.component === 'SizeTable');
      checks.push({
        name: 'C1: one mobile-overflow Issue on SizeTable, on /size-guide only (both versions)',
        pass:
          overflow.length === n('C1', 'screens') &&
          !!sizeTable &&
          sameSet(sizeTable.screens, manifest.routes('C1')),
        detail:
          overflow
            .map((i) => `${i.component ?? 'no component'} on ${i.screens.join(', ')}`)
            .join('; ') || 'none',
      });
      const jsOnly = issues.filter((i) => i.rule_id === 'flowlens/js-only-content');
      const jsScreens = jsOnly.flatMap((i) => i.screens);
      checks.push({
        name: 'C2: js-only-content on /faq only (both versions)',
        pass: sameSet(jsScreens, ['/faq']),
        detail: `js-only content on ${jsScreens.join(', ') || 'no screen'}`,
      });
      const products = seoScreens.filter((s) => s.id.startsWith('/product/'));
      const off = products.filter(
        (s) => s.link_depth !== 1 || !(s.jsonld ?? []).includes('Product'),
      );
      checks.push({
        name: 'C3: every product page is at link depth 1 and has Product JSON-LD (both versions)',
        pass:
          products.length === n('C3', 'product_pages') &&
          off.length === 0 &&
          products.every((s) => s.link_depth === n('C3', 'product_link_depth')),
        detail:
          `${products.length - off.length} of ${products.length}` +
          (off.length
            ? `; not: ${off.map((s) => `${s.id} (depth ${s.link_depth ?? 'none'}, JSON-LD ${(s.jsonld ?? []).join('/') || 'none'})`).join(', ')}`
            : ''),
      });
      const orders = seoScreens.find((s) => s.id === '/orders');
      checks.push(
        version === 'v1'
          ? {
              name: 'F3: /orders is not reachable by links (link_depth null)',
              pass: !!orders && orders.link_depth === null,
              detail: `link_depth ${orders ? (orders.link_depth ?? 'null') : 'screen not found'}`,
            }
          : {
              name: 'F3 fixed: /orders is reachable by links',
              pass: orders?.link_depth !== null && orders?.link_depth !== undefined,
              detail: `link_depth ${orders ? (orders.link_depth ?? 'null') : 'screen not found'}`,
            },
      );
      const gaps = issues.filter((i) => i.rule_id === 'flowlens/sitemap-gap');
      checks.push({
        name: 'No sitemap-gap Issues (both versions)',
        pass: gaps.length === 0,
        detail: gaps.map((i) => `${i.screens.join(', ') || 'no screen'}`).join('; ') || 'none',
      });
      const networkTree = issues.filter((i) => i.rule_id === 'network-dependency-tree-insight');
      checks.push({
        name: 'No Lighthouse network-dependency-tree Issue (dropped as a local artifact)',
        pass: networkTree.length === 0,
        detail: `${networkTree.length} found`,
      });
      seoIssues.push(...overflow, ...jsOnly);
    }
    const planted = new Set(
      [...contrast, ...labels, ...headings, ...landmarks, ...seoIssues].map((i) => i.id),
    );
    const unplanted = issues.filter((i) => !planted.has(i.id));
    console.log(`Verify ${name} against FLAWS.md (${version})`);
    for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
    const known = (await readKnownFindings(values.flaws ?? '')).filter((k) =>
      k.versions.includes(version),
    );
    const matched = new Set<string>();
    for (const u of unplanted) {
      const where = `${u.source} ${u.rule_id}${u.component ? ` in ${u.component}` : ''} on ${u.screens.join(', ')}`;
      const hit = known.find(
        (k) =>
          k.rule === u.rule_id &&
          k.source === u.source &&
          u.screens.every((s) => k.screens.includes(s)),
      );
      if (hit) {
        matched.add(hit.rule);
        console.log(`  OK    expected unplanted finding (FLAWS.md): ${where}`);
      } else {
        console.log(`  WARN  unplanted issue (not in FLAWS.md): ${where}`);
      }
    }
    for (const n of notes) console.log(`  info  ${n}`);
    for (const k of known.filter((k) => !matched.has(k.rule))) {
      console.log(
        `  info  listed unplanted finding not found this time: ${k.source} ${k.rule} on ${k.screens.join(', ')}`,
      );
    }
    const orders = await rows<{
      via: string;
    }>(`MATCH (s:Screen {id: '/orders'}) RETURN s.discovered_via AS via`);
    console.log('  info  /orders discovered_via:', orders[0]?.via ?? 'n/a');
    console.log(
      '  info  shortest path / -> /checkout/confirmation:',
      shortest[0] ? `${shortest[0].hops} edges (${shortest[0].ids.join(' -> ')})` : 'none',
    );
    const failed = checks.filter((c) => !c.pass).length;
    console.log(failed === 0 ? '  All checks passed.' : `  ${failed} check(s) failed.`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await db.close();
  }
}
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
