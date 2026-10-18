// What found each part of a problem, and where a person can check it: in FlowLens (a graph tool,
// run with these arguments) and outside it (browser and web tools). Plain text and links only.
export type Process = 'page_check' | 'map_analysis' | 'content_analysis';
export interface InAppTool {
  tool: string;
  args: Record<string, string>;
  label: string;
}
export interface ExternalTool {
  name: string;
  how: string;
  url?: string;
}
export interface Guide {
  in_app: InAppTool[];
  external: ExternalTool[];
}

export const PROCESS_LABEL: Record<Process, string> = {
  page_check: 'Page check during the crawl',
  map_analysis: 'Site map analysis by an agent',
  content_analysis: 'Content analysis by an agent',
};

export const SOURCE_LABEL: Record<string, string> = {
  axe: 'Accessibility check (axe-core)',
  flowlens: 'FlowLens page check',
  lighthouse: 'Lighthouse audit',
};

// Graph tools an agent cites as evidence, by the process they stand for. Tools that only read
// check results (component_fanout, issues_by_component, js_only_content, ...) are page checks.
const TOOL_PROCESS: Record<string, Process> = {
  find_orphans: 'map_analysis',
  find_dead_ends: 'map_analysis',
  compare_task: 'map_analysis',
  shortest_path: 'map_analysis',
  betweenness: 'map_analysis',
  pagerank: 'map_analysis',
  communities: 'map_analysis',
  crawl_depth: 'map_analysis',
  unreachable_by_links: 'map_analysis',
  screen_links: 'map_analysis',
  ia_mismatch: 'content_analysis',
  similar_screens: 'content_analysis',
  stable_communities: 'content_analysis',
};
export const toolProcess = (tool: string): Process => TOOL_PROCESS[tool] ?? 'page_check';

const AXE: ExternalTool = {
  name: 'axe DevTools',
  how: 'Browser extension: run a scan on the screen and look for the same rule.',
  url: 'https://www.deque.com/axe/devtools/',
};
const LIGHTHOUSE: ExternalTool = {
  name: 'Lighthouse',
  how: 'Chrome DevTools, Lighthouse panel (or PageSpeed Insights for a public URL).',
  url: 'https://pagespeed.web.dev/',
};
const LINK_CRAWLER: ExternalTool = {
  name: 'A link crawler (e.g. Screaming Frog)',
  how: 'Crawl from the home page following plain links only; the screen should appear with its depth.',
};

const RULE_EXTERNAL: Record<string, ExternalTool[]> = {
  'color-contrast': [
    AXE,
    {
      name: 'Chrome DevTools contrast',
      how: 'Inspect the text, open the color picker of its color: it shows the ratio and the AA line.',
    },
  ],
  'flowlens/label-missing': [
    AXE,
    {
      name: 'A screen reader',
      how: 'Tab into each field (VoiceOver: Cmd+F5): it should announce a name, not only the placeholder.',
    },
  ],
  'heading-order': [
    AXE,
    {
      name: 'Chrome accessibility tree',
      how: 'DevTools, Elements, Accessibility pane: walk the headings and check the levels.',
    },
  ],
  region: [AXE],
  'landmark-one-main': [AXE],
  'flowlens/mobile-overflow': [
    {
      name: 'Chrome device toolbar',
      how: 'DevTools, toggle the device toolbar, set 375 x 812: the page should not scroll sideways.',
    },
  ],
  'flowlens/js-only-content': [
    {
      name: 'JavaScript off',
      how: 'DevTools command menu, "Disable JavaScript", reload: the text should still be there. Or curl the URL.',
    },
  ],
  'flowlens/jsonld-missing': [
    {
      name: 'Rich Results Test',
      how: 'Test the page URL: it should find a Product item.',
      url: 'https://search.google.com/test/rich-results',
    },
  ],
  'flowlens/sitemap-gap': [
    {
      name: 'Search Console sitemaps report',
      how: 'Submit /sitemap.xml and read which URLs fail or redirect.',
      url: 'https://search.google.com/search-console',
    },
  ],
  'flowlens/title-missing': [LIGHTHOUSE],
  'flowlens/title-duplicate': [LINK_CRAWLER],
  'flowlens/meta-description-missing': [LIGHTHOUSE],
  'flowlens/h1-count': [AXE],
};

const TOOL_EXTERNAL: Record<string, ExternalTool[]> = {
  find_orphans: [LINK_CRAWLER],
  unreachable_by_links: [LINK_CRAWLER],
  crawl_depth: [LINK_CRAWLER],
  find_dead_ends: [
    {
      name: 'Click through',
      how: 'Open the screen in a fresh tab: there should be a way forward without the back button.',
    },
  ],
  compare_task: [
    {
      name: 'Usability test',
      how: 'Ask a person to do the task and count the clicks against the shortest path.',
    },
  ],
  ia_mismatch: [
    {
      name: 'Card sorting or tree testing',
      how: 'Ask people where they expect the items; compare with the menu category.',
    },
  ],
  screen_links: [
    {
      name: 'First-click test',
      how: 'Ask people to find a product from the page and time the first click.',
    },
  ],
};

// The graph tool that shows a check result's rule in FlowLens.
function ruleTool(rule: string, component: string | null): InAppTool | null {
  if (rule === 'flowlens/mobile-overflow')
    return { tool: 'mobile_overflow_screens', args: {}, label: 'Screens that scroll sideways' };
  if (rule === 'flowlens/js-only-content')
    return { tool: 'js_only_content', args: {}, label: 'Content that needs JavaScript' };
  if (rule === 'flowlens/sitemap-gap')
    return { tool: 'sitemap_gaps', args: {}, label: 'Sitemap gaps' };
  if (component)
    return {
      tool: 'component_fanout',
      args: { component },
      label: `Every screen that uses ${component}`,
    };
  return null;
}

const TOOL_LABEL: Record<string, string> = {
  find_orphans: 'Screens nothing links to',
  find_dead_ends: 'Screens with no way forward',
  compare_task: 'Task: forced path against the shortest one',
  shortest_path: 'Shortest path',
  unreachable_by_links: 'Screens crawlers cannot reach by links',
  crawl_depth: 'Link depth of every screen',
  ia_mismatch: 'Screens whose content fits another category',
  similar_screens: 'Screens with similar content',
  screen_links: 'Links on the screen',
  component_fanout: 'Every screen that uses the component',
  mobile_overflow_screens: 'Screens that scroll sideways',
  js_only_content: 'Content that needs JavaScript',
  sitemap_gaps: 'Sitemap gaps',
  check_results: 'Page check results',
};

const stringArgs = (args: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(args)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => [k, String(v)]),
  );

// Tools that only list check results add nothing a person can rerun on one problem.
const NOT_RERUNNABLE = new Set(['issues_by_component', 'lens_summary']);

export function guideFor(
  evidence: { tool: string; args: Record<string, unknown> }[],
  checks: { rule_id: string; source: string; component: string | null }[],
): Guide {
  const in_app: InAppTool[] = [];
  const external: ExternalTool[] = [];
  const seenTool = new Set<string>();
  const addTool = (t: InAppTool) => {
    const k = `${t.tool} ${JSON.stringify(t.args)}`;
    if (seenTool.has(k)) return;
    seenTool.add(k);
    in_app.push(t);
  };
  const addExternal = (list: ExternalTool[] | undefined) => {
    for (const e of list ?? []) if (!external.some((x) => x.name === e.name)) external.push(e);
  };
  for (const e of evidence) {
    if (NOT_RERUNNABLE.has(e.tool)) continue;
    addTool({ tool: e.tool, args: stringArgs(e.args), label: TOOL_LABEL[e.tool] ?? e.tool });
    addExternal(TOOL_EXTERNAL[e.tool]);
  }
  for (const c of checks) {
    const t = ruleTool(c.rule_id, c.component);
    if (t) addTool(t);
    addExternal(
      RULE_EXTERNAL[c.rule_id] ??
        (c.source === 'lighthouse' ? [LIGHTHOUSE] : c.source === 'axe' ? [AXE] : []),
    );
  }
  return { in_app, external };
}
