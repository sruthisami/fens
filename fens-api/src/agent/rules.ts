import type { ToolRouter } from './router.js';
import type { FindingInput } from './types.js';
type Call = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
interface FanoutIssue {
  id: string;
  rule_id: string;
  severity: string;
  help: string;
  screen_count: number;
  screens: string[];
}
const RECOMMENDATIONS: Record<string, (component: string) => string> = {
  'color-contrast': (c) =>
    `Raise the text and background contrast of ${c} to at least 4.5:1 (WCAG 1.4.3). It is one component, so one fix updates every screen.`,
  'flowlens/label-missing': (c) =>
    `Give every field in ${c} a visible <label> linked with for/id (or aria-label). Keep placeholders only as examples (WCAG 3.3.2).`,
  'heading-order': (c) =>
    `Keep heading levels in order: add an <h2> section heading above the ${c} grid, or render the ${c} title as <h2> on pages without one.`,
};
function issueSeverity(severity: string, screens: number, total: number): FindingInput['severity'] {
  const serious = severity === 'serious' || severity === 'critical';
  if (serious && screens >= total / 2) return 'high';
  if (serious) return 'medium';
  return 'low';
}
const detourSeverity = (d: number): FindingInput['severity'] => (d >= 5 ? 'high' : 'medium');
export const MIN_DETOUR = 3;
export const isDetour = (detour: number | null): detour is number =>
  detour !== null && detour >= MIN_DETOUR;
export async function runRules(router: ToolRouter, call: Call): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  if (router.has('get_graph_schema')) await call('get_graph_schema');
  const byComponent = (await call('issues_by_component')) as {
    result: {
      ranking: {
        component: string;
        issues: number;
        screens: number;
        screen_ids: string[];
      }[];
    };
  };
  const orphans = (await call('find_orphans')) as {
    result: {
      screens: {
        id: string;
        title: string;
      }[];
    };
  };
  const deadEnds = (await call('find_dead_ends')) as {
    result: {
      screens: {
        id: string;
        title: string;
        in_degree: number;
      }[];
    };
  };
  const tasks = (await call('compare_task')) as {
    result: {
      tasks: {
        id: string;
        name: string;
        start: string;
        end: string;
        forced_clicks: number;
        forced_path: {
          order: number;
          action: string;
          from: string;
          to: string;
          moved: boolean;
        }[];
        shortest: {
          length: number | null;
          steps: {
            from: string;
            to: string;
            action: string;
          }[];
        };
        detour: number | null;
      }[];
    };
  };
  const central = (await call('betweenness', { edge_set: 'flow', top: 5 })) as {
    result: {
      ranking: {
        id: string;
        score: number;
      }[];
    };
  };
  const allScreens = (await call('pagerank', { edge_set: 'all', top: 50 })) as {
    result: {
      ranking: {
        id: string;
      }[];
    };
  };
  const screenTotal = allScreens.result.ranking.length;
  for (const row of byComponent.result.ranking.slice(0, 5)) {
    const fan = (await call('component_fanout', { component: row.component })) as {
      result: {
        screen_count: number;
        issues: FanoutIssue[];
      };
    };
    for (const issue of fan.result.issues) {
      const n = issue.screen_count;
      const where = n === 1 ? (issue.screens[0] ?? 'one screen') : `${n} screens`;
      findings.push({
        title: `${issue.help} (${row.component}, ${where})`,
        severity: issueSeverity(issue.severity, n, screenTotal),
        category: 'accessibility',
        explanation: `The ${row.component} component fails the ${issue.rule_id} check (${issue.help}). ${
          n > 1
            ? `It is a shared component, so the same problem appears on ${n} of ${screenTotal} screens: ${issue.screens.slice(0, 6).join(', ')}${n > 6 ? ', ...' : ''}.`
            : `It appears on ${issue.screens.join(', ')}.`
        } The checks marked it ${issue.severity}.`,
        evidence: [
          {
            tool: 'component_fanout',
            args: { component: row.component },
            screens: issue.screens,
            path: [],
          },
          { tool: 'issues_by_component', args: {}, screens: row.screen_ids, path: [] },
        ],
        recommendation: (
          RECOMMENDATIONS[issue.rule_id] ?? ((c: string) => `Fix "${issue.help}" in ${c}.`)
        )(row.component),
        target: { type: 'component', id: row.component },
        rule_id: issue.rule_id,
        issue_ids: [issue.id],
      });
    }
  }
  for (const s of orphans.result.screens) {
    findings.push({
      title: `${s.id} is an orphan: no link or button leads to it`,
      severity: 'medium',
      category: 'structure',
      explanation: `No screen links to ${s.id} (${s.title}). Users can only reach it by typing the URL, so they will not find it on their own.`,
      evidence: [{ tool: 'find_orphans', args: {}, screens: [s.id], path: [] }],
      recommendation: `Link to ${s.id} from where users expect it, for example the header or the account menu.`,
      target: { type: 'screen', id: s.id },
    });
  }
  for (const s of deadEnds.result.screens) {
    findings.push({
      title: `${s.id} is a dead end: no way forward`,
      severity: 'medium',
      category: 'structure',
      explanation: `${s.id} (${s.title}) has no link or button that leads anywhere, so users must use the browser back button. ${s.in_degree} link(s) lead into it.`,
      evidence: [{ tool: 'find_dead_ends', args: {}, screens: [s.id], path: [] }],
      recommendation: `Give ${s.id} a way forward: the shared header and footer, or at least a "Back to home" link.`,
      target: { type: 'screen', id: s.id },
    });
  }
  const centralIds = central.result.ranking.map((r) => r.id);
  for (const t of tasks.result.tasks) {
    if (!isDetour(t.detour) || t.shortest.length === null) continue;
    const forcedPath = [t.start, ...t.forced_path.filter((s) => s.moved).map((s) => s.to)];
    const shortestPath = [t.start, ...t.shortest.steps.map((s) => s.to)];
    const stateOnly = t.forced_path.filter((s) => !s.moved).map((s) => `"${s.action}"`);
    const busy = forcedPath.filter((id) => centralIds.includes(id));
    findings.push({
      title: `"${t.name}" takes ${t.forced_clicks} clicks; the shortest path takes ${t.shortest.length}`,
      severity: detourSeverity(t.detour),
      category: 'flow',
      explanation: `The main journey for "${t.name}" forces ${t.forced_clicks} clicks from ${t.start} to ${t.end}: ${t.forced_path
        .map((s) => `"${s.action}"`)
        .join(', ')}. The shortest route in the graph takes ${t.shortest.length} (${t.shortest.steps
        .map((s) => `"${s.action}"`)
        .join(', ')}), a detour of ${t.detour} click(s).${
        stateOnly.length
          ? ` ${stateOnly.join(', ')} ${stateOnly.length === 1 ? 'only changes state and keeps' : 'only change state and keep'} the user on the same screen.`
          : ''
      }${busy.length ? ` Screens on the forced path that many journeys pass through: ${busy.join(', ')}.` : ''}`,
      evidence: [
        { tool: 'compare_task', args: { task: t.id }, screens: forcedPath, path: forcedPath },
        {
          tool: 'shortest_path',
          args: { from: t.start, to: t.end, edge_set: 'all' },
          screens: shortestPath,
          path: shortestPath,
        },
      ],
      recommendation: `Cut the main journey toward ${t.shortest.length} clicks: merge single-field checkout steps, drop steps that only confirm the previous one, and make the fast route (${t.shortest.steps
        .map((s) => `"${s.action}"`)
        .join(' then ')}) visible instead of hidden.`,
      target: { type: 'task', id: t.id },
    });
  }
  if (router.has('ia_mismatch')) {
    const ia = (await call('ia_mismatch')) as {
      result: {
        method: string;
        screens: {
          id: string;
          category: string;
          flagged: boolean;
          other: number;
          neighbours: {
            id: string;
            category: string | null;
            similarity: number;
          }[];
        }[];
      };
    };
    for (const s of ia.result.screens.filter((x) => x.flagged)) {
      const others = s.neighbours.filter((n) => n.category !== s.category);
      const cats = [...new Set(others.map((n) => n.category))].join(', ');
      findings.push({
        title: `${s.id} shows content that belongs under ${cats}`,
        severity: 'medium',
        category: 'content',
        explanation: `${s.id} sits in the ${s.category} menu category, but ${s.other} of its ${s.neighbours.length} nearest content neighbours (${ia.result.method === 'embedding' ? 'Gemini embeddings' : 'word overlap'}) belong to ${cats}: ${others.map((n) => `${n.id} (${n.category})`).join(', ')}. People who open ${s.id} find items they expected elsewhere.`,
        evidence: [
          {
            tool: 'ia_mismatch',
            args: {},
            screens: [s.id, ...s.neighbours.map((n) => n.id)],
            path: [],
          },
        ],
        recommendation: `Review what ${s.id} lists: move the items that belong under ${cats} and list the ones that belong to ${s.category}.`,
        target: { type: 'screen', id: s.id },
        rule_id: 'ia-mismatch',
      });
    }
  }
  return findings;
}
