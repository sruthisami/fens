import { API_URL } from './config';
import { authHeaders, authQuery } from './identity';
export type Lens = 'UX' | 'SEO' | 'AEO';
export const LENSES: Lens[] = ['UX', 'SEO', 'AEO'];
export interface Summary {
  graph: string;
  health: {
    score: number;
  };
  screens: number;
  edges: number;
  components: number;
  orphans: number;
  deadEnds: number;
  stateRequired: number;
  seeds: number;
  unreachableByLinks: number;
  lens: Lens | null;
  issues: {
    total: number;
    bySeverity: Record<Severity, number>;
    bySource: Record<string, number>;
    byLens: Record<Lens, number>;
  };
}
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';
export const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
export interface IssueListItem {
  id: string;
  rule_id: string;
  source: 'axe' | 'flowlens' | 'lighthouse';
  severity: Severity;
  help: string;
  guidelines: string[];
  lenses: Lens[];
  component: string | null;
  screen_count: number;
  instance_count: number;
}
export interface IssueDetail {
  issue: Record<string, unknown> & {
    id: string;
    rule_id: string;
    source: string;
    severity: Severity;
    help: string;
    description: string;
    help_url: string;
    status: string;
    first_seen: string;
  };
  guidelines: {
    id: string;
    name: string;
    lens: string;
    source: string;
  }[];
  component: string | null;
  screens: {
    id: string;
    selector: string;
    html: string;
    node_count: number;
    details: string[] | null;
  }[];
}
export interface ScreenIssue {
  id: string;
  rule_id: string;
  source: string;
  severity: Severity;
  help: string;
  component: string | null;
  selector: string | null;
  html: string | null;
  node_count: number | null;
  lenses: Lens[];
}
export interface GraphNode {
  id: string;
  path: string;
  title: string;
  depth: number | null;
  discovered_via: string | null;
  state_required: boolean;
  in_degree: number;
  out_degree: number;
  orphan: boolean;
  dead_end: boolean;
  issue_count: number;
  local_issue_count: number;
  screenshot: string | null;
  link_depth: number | null;
  unreachable_by_links: boolean;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  actions: string[];
  via: string[];
  count: number;
  shared: boolean;
}
export interface GraphData {
  graph: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface ComponentUsage {
  name: string;
  screens: number;
  instances: number;
}
export interface EdgeDetail {
  from?: string;
  to?: string;
  action: string;
  via: string;
  selector: string | null;
  redirects_to: string | null;
}
export interface ScreenDetail {
  screen: Record<string, unknown> & {
    id: string;
    path?: string;
    title?: string;
    depth?: number;
    discovered_via?: string;
    state_required?: boolean;
    link_depth?: number;
    js_only_ratio?: number;
    raw_status?: number;
    mobile_overflow?: boolean;
    jsonld_types?: string[];
    has_table?: boolean;
    in_sitemap?: boolean;
    lcp_ms?: number;
    cls?: number;
    screenshot_url: string | null;
  };
  incoming: EdgeDetail[];
  outgoing: EdgeDetail[];
  components: {
    name: string;
    count: number;
    instances: {
      id: string;
      selector: string | null;
      text: string | null;
    }[];
  }[];
  issues: ScreenIssue[];
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}
async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, { headers: authHeaders() });
  } catch {
    throw new ApiError(`Cannot reach the FlowLens API at ${API_URL}.`, null);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}
const g = (graph: string) => `/api/graphs/${encodeURIComponent(graph)}`;
export const api = {
  graphs: () =>
    get<{
      graphs: string[];
    }>('/api/graphs').then((r) => r.graphs),
  summary: (graph: string, lens: Lens | null = null) =>
    get<Summary>(`${g(graph)}/summary${lens ? `?lens=${lens}` : ''}`),
  graph: (graph: string) => get<GraphData>(`${g(graph)}/graph`),
  components: (graph: string) =>
    get<{
      components: ComponentUsage[];
    }>(`${g(graph)}/components`).then((r) => r.components),
  componentScreens: (graph: string, name: string) =>
    get<{
      screens: string[];
    }>(`${g(graph)}/components/${encodeURIComponent(name)}/screens`).then((r) => r.screens),
  issues: (graph: string, lens: Lens | null = null) =>
    get<{
      issues: IssueListItem[];
    }>(`${g(graph)}/issues${lens ? `?lens=${lens}` : ''}`).then((r) => r.issues),
  issue: (graph: string, id: string) =>
    get<IssueDetail>(`${g(graph)}/issues/${encodeURIComponent(id)}`),
  tool: <R>(graph: string, name: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get<ToolResult<R>>(`${g(graph)}/tools/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`);
  },
  screen: (graph: string, id: string) =>
    get<ScreenDetail>(`${g(graph)}/screens/${encodeURIComponent(id)}`),
};
export const assetUrl = (path: string) =>
  `${API_URL}${path}${path.includes('?') ? '&' : '?'}${authQuery()}`;
export interface ToolResult<R> {
  tool: string;
  graph: string;
  result: R;
  screens: string[];
  edges: string[];
}
export interface PathStep {
  from: string;
  to: string;
  action: string;
  via: string;
}
export interface ShortestPathResult {
  found: boolean;
  length: number | null;
  steps: PathStep[];
}
export interface RankingResult {
  edge_set: string;
  ranking: {
    rank: number;
    id: string;
    title: string;
    score: number;
  }[];
}
export interface IssuesByComponentResult {
  ranking: {
    rank: number;
    component: string;
    issues: number;
    screens: number;
    rules: string[];
    screen_ids: string[];
  }[];
}
export type InvestigateMode = 'llm' | 'rules' | 'replay';
export type AgentName = 'ux' | 'seo';
export type AgentChoice = AgentName | 'both';
export interface Evidence {
  tool: string;
  args: Record<string, unknown>;
  screens: string[];
  path: string[];
}
export type FindingOrigin = 'rules' | 'ai' | 'ai-enriched';
export interface Finding {
  id: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  category: string;
  explanation: string;
  recommendation: string;
  evidence: Evidence[];
  target: {
    type: string;
    id: string;
  } | null;
  mode: string;
  origin?: FindingOrigin;
  agent?: AgentName;
  github_issue_url?: string | null;
  linear_issue_url?: string | null;
  figma_comment_url?: string | null;
  stale?: boolean;
  channels?: ChannelRecord;
  suppressed_by?: {
    fact_id: string;
    text: string;
  } | null;
}
export type Channel = 'github' | 'linear' | 'figma';
export const CHANNELS: Channel[] = ['github', 'linear', 'figma'];
export const CHANNEL_LABEL: Record<Channel, string> = {
  github: 'GitHub issue',
  linear: 'Linear issue',
  figma: 'Figma comment',
};
export interface ChannelRecord {
  github: {
    url: string;
    number: number | null;
    created_at: string | null;
    closed_at: string | null;
  } | null;
  linear: {
    url: string;
    identifier: string | null;
    created_at: string | null;
    closed_at: string | null;
  } | null;
  figma: {
    id: string | null;
    url: string;
    created_at: string | null;
    closed_at: string | null;
  } | null;
  closed_in: string | null;
}
export type ChannelStatus = Record<Channel, string>;
export interface ChannelResult {
  status: string;
  url?: string;
  message?: string;
  code?: number;
}
export type ChannelResults = Partial<Record<Channel, ChannelResult>>;
export interface ChannelPreviewItem {
  available: boolean;
  reason: string | null;
  sent: string | null;
  draft: Record<string, unknown> | null;
}
export interface ChannelsPreview {
  status: ChannelStatus;
  note: string;
  github: ChannelPreviewItem;
  linear: ChannelPreviewItem;
  figma: ChannelPreviewItem;
}
export interface ChannelCheck {
  linked: boolean;
  url?: string;
  checked: boolean;
  exists?: boolean;
  state?: string;
  closed?: boolean;
  links_current?: boolean;
  message?: string;
}
const ch = (graph: string, id: string) => `${g(graph)}/findings/${encodeURIComponent(id)}/channels`;
export const channelsApi = {
  status: (graph: string, id: string) =>
    get<{
      record: ChannelRecord;
      status: ChannelStatus;
    }>(ch(graph, id)),
  preview: (graph: string, id: string) => get<ChannelsPreview>(`${ch(graph, id)}/preview`),
  send: (graph: string, id: string, channels: Channel[], assignee?: string) =>
    post<{
      results: ChannelResults;
      sync: ChannelResults;
      status: ChannelStatus;
    }>(`${ch(graph, id)}/send`, assignee ? { channels, assignee } : { channels }),
  sync: (graph: string, id: string) =>
    post<{
      results: ChannelResults;
    }>(`${ch(graph, id)}/sync`, {}),
  verify: (graph: string, id: string) =>
    get<{
      channels: Record<Channel, ChannelCheck>;
    }>(`${ch(graph, id)}/verify`),
  resolve: (graph: string, id: string, resolvedIn: string) =>
    post<{
      results: ChannelResults;
      status: ChannelStatus;
    }>(`${ch(graph, id)}/resolve`, {
      resolved_in: resolvedIn,
    }),
};
export type AgentEvent =
  | {
      type: 'start';
      graph: string;
      mode: InvestigateMode;
      agent?: AgentChoice;
      started_at: string;
      replay_of?: string;
    }
  | {
      type: 'agent';
      agent: AgentName;
    }
  | {
      type: 'proposal';
      proposal: Proposal;
    }
  | {
      type: 'proposal_rejected';
      agent: AgentName;
      title: string;
      reason: string;
    }
  | {
      type: 'note';
      message: string;
    }
  | {
      type: 'tool_call';
      n: number;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      n: number;
      tool: string;
      ok: boolean;
      summary: string;
    }
  | {
      type: 'finding';
      finding: Finding;
    }
  | {
      type: 'rejected';
      title: string;
      reason: string;
    }
  | {
      type: 'comparison';
      comparison: Comparison;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'done';
      mode: InvestigateMode;
      findings: number;
      proposals?: number;
      rejected: number;
      tool_calls: number;
      ms: number;
      stopped?: string;
    };
export type ChangeType =
  'table_to_cards' | 'table_responsive' | 'content_in_html' | 'remove_links' | 'add_link';
export type Effect = 'improves' | 'neutral' | 'worsens';
export interface Proposal {
  id: string;
  key: string;
  agent: AgentName;
  title: string;
  change: {
    type: ChangeType;
    params: Record<string, unknown>;
  };
  rationale: string;
  issue_keys: string[];
  expected: {
    ux: Effect;
    seo: Effect;
  };
  targets: {
    screens: string[];
    components: string[];
  };
  status: string;
}
export interface IssuePreview {
  title: string;
  body: string;
  labels: string[];
}
export async function* investigate(
  graph: string,
  mode: InvestigateMode,
  signal?: AbortSignal,
  compareWith?: string,
  agent: AgentChoice = 'ux',
): AsyncGenerator<AgentEvent> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${g(graph)}/investigate`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(
        compareWith ? { mode, agent, compare_with: compareWith } : { mode, agent },
      ),
      signal,
    });
  } catch {
    throw new ApiError(`Cannot reach the FlowLens API at ${API_URL}.`, null);
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(body?.error ?? `Investigation failed (${res.status})`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (data) yield JSON.parse(data.slice(6)) as AgentEvent;
      cut = buffer.indexOf('\n\n');
    }
  }
}
async function post<T>(path: string, json?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: 'POST',
      headers:
        json === undefined
          ? authHeaders()
          : { ...authHeaders(), 'Content-Type': 'application/json' },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch {
    throw new ApiError(`Cannot reach the FlowLens API at ${API_URL}.`, null);
  }
  const body = (await res.json().catch(() => null)) as
    | (T & {
        error?: string;
      })
    | null;
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}
export const findingsApi = {
  list: (graph: string) =>
    get<{
      findings: Finding[];
    }>(`${g(graph)}/findings`).then((r) => r.findings),
  preview: (graph: string, id: string) =>
    get<IssuePreview>(`${g(graph)}/findings/${encodeURIComponent(id)}/issue-preview`),
  createIssue: (graph: string, id: string, assignee?: string) =>
    post<CreatedIssue>(
      `${g(graph)}/findings/${encodeURIComponent(id)}/github-issue`,
      assignee ? { assignee } : {},
    ),
  linearPreview: (graph: string, id: string) =>
    get<LinearPreview>(`${g(graph)}/findings/${encodeURIComponent(id)}/linear-preview`),
  createLinear: (graph: string, id: string) =>
    post<CreatedLinearIssue>(`${g(graph)}/findings/${encodeURIComponent(id)}/linear-issue`, {}),
  figmaPreview: (graph: string, id: string) =>
    get<FigmaPreview>(`${g(graph)}/findings/${encodeURIComponent(id)}/figma-preview`),
  postFigma: (graph: string, id: string) =>
    post<{
      url: string;
    }>(`${g(graph)}/findings/${encodeURIComponent(id)}/figma-comment`, {}),
};
export interface CreatedIssue {
  url: string;
  assigned: boolean;
  assign_note?: string;
}
export interface LinearPreview {
  configured: boolean;
  team_id: string | null;
  title: string;
  description: string;
  labels: string[];
  priority: number;
  priority_name: string;
  link: string;
}
export interface CreatedLinearIssue {
  url: string;
  identifier: string;
  labels: string[];
  missing_labels: string[];
  note?: string;
}
export interface FigmaPreview {
  dry_run: boolean;
  reasons: string[];
  screen: string | null;
  file_key: string | null;
  node_id: string | null;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  };
}
export interface AssigneeSuggestion {
  target: {
    from: string;
    components: string[];
    guidelines: string[];
    lenses: string[];
  };
  ranking: {
    rank: number;
    person: string;
    team: string | null;
    github: string | null;
    score: number;
    similar: number;
    evidence: {
      title: string;
      closed_at: string;
      matched: string[];
      weight: number;
      path: string[];
    }[];
  }[];
  note?: string;
}
export interface StableCommunities {
  runs: number;
  threshold: number;
  count: number;
  groups: {
    label: string;
    size: number;
    screens: string[];
  }[];
}
export const proposalsApi = {
  list: (graph: string) =>
    get<{
      proposals: Proposal[];
    }>(`${g(graph)}/proposals`).then((r) => r.proposals),
};
export interface ComparisonItem {
  text: string;
  cite: string;
}
export interface Comparison {
  from: string;
  to: string;
  health: {
    from: number;
    to: number;
    delta: number;
  };
  improved: ComparisonItem[];
  regressed: ComparisonItem[];
  persisting: ComparisonItem[];
  source: 'rules' | 'ai';
  note?: string;
}
export interface ReleaseDiff {
  from: string;
  to: string;
  health: {
    from: {
      score: number;
      breakdown: {
        label: string;
        count: number;
        points: number;
      }[];
    };
    to: {
      score: number;
      breakdown: {
        label: string;
        count: number;
        points: number;
      }[];
    };
    delta: number;
    note: string;
  };
  metrics: {
    orphans: {
      from: number;
      to: number;
      delta: number;
    };
    deadEnds: {
      from: number;
      to: number;
      delta: number;
    };
    forcedClicks: {
      from: number;
      to: number;
      delta: number;
    };
    shortestPath: {
      from: number;
      to: number;
      delta: number;
    };
    issuesBySeverity: {
      from: Record<Severity, number>;
      to: Record<Severity, number>;
    };
  };
  issues: {
    fixed: {
      key: string;
      rule_id: string;
      severity: Severity;
      help: string;
      component: string | null;
      screens: string[];
    }[];
    new: {
      key: string;
      rule_id: string;
      severity: Severity;
      help: string;
      component: string | null;
      screens: string[];
    }[];
    unchanged: {
      key: string;
      rule_id: string;
      severity_from: string | null;
      severity_to: Severity;
      help: string;
      component: string | null;
    }[];
  };
  findings: {
    resolved: {
      id: string;
      key: string;
      title: string;
      severity: string;
      github_issue_url: string | null;
      linear_issue_url: string | null;
      figma_comment_url: string | null;
      channel_status: ChannelStatus;
    }[];
    new: {
      key: string;
      title: string;
      severity: string;
    }[];
    persisting: {
      key: string;
      title: string;
      severity_from: string | null;
      severity_to: string;
    }[];
  };
  screens: {
    added: string[];
    removed: string[];
  };
  tasks: {
    name: string;
    forced: {
      from: number | null;
      to: number | null;
    };
    shortest: {
      from: number | null;
      to: number | null;
    };
  }[];
  changed_screens: string[];
}
export const releaseApi = {
  diff: (toGraph: string, fromGraph: string) =>
    get<ToolResult<ReleaseDiff>>(
      `${g(toGraph)}/tools/diff_releases?from_graph=${encodeURIComponent(fromGraph)}`,
    ).then((r) => r.result),
  compare: (toGraph: string, fromGraph: string) =>
    post<{
      diff: ReleaseDiff;
      memory: {
        episode: {
          id: string;
          summary: string;
        };
        fixed: string[];
        superseded: string[];
      };
    }>(`${g(toGraph)}/compare`, { from_graph: fromGraph }),
};
export interface CrawlDepthResult {
  start: string;
  max_link_depth: number | null;
  distribution: {
    depth: number;
    count: number;
  }[];
  unreachable_by_links: number;
  screens: {
    id: string;
    title: string;
    link_depth: number | null;
    click_depth: number | null;
  }[];
}
export interface UnreachableResult {
  start: string;
  count: number;
  screens: {
    id: string;
    title: string;
    reached_by: {
      from: string;
      action: string;
    }[];
  }[];
  not_reachable_at_all: {
    id: string;
    title: string;
    discovered_via: string | null;
  }[];
}
export interface JsOnlyResult {
  min_ratio: number;
  count: number;
  screens: {
    id: string;
    js_only_ratio: number;
    raw_status: number | null;
  }[];
}
export interface MobileOverflowResult {
  count: number;
  screens: {
    id: string;
    component: string | null;
    selector: string | null;
    width: string | null;
  }[];
}
export interface SitemapGapsResult {
  count: number;
  gaps: {
    kind: string;
    help: string;
    screens: {
      screen: string;
      urls: string[];
    }[];
  }[];
  not_in_sitemap: string[];
}
export interface LensSummaryResult {
  lenses: {
    lens: Lens;
    total: number;
    bySeverity: Record<Severity, number>;
    screens: number;
  }[];
  conflicts: {
    from: {
      id: string;
      name: string;
      lens: string;
    };
    to: {
      id: string;
      name: string;
      lens: string;
    };
    reason: string;
    from_issues: number;
    to_issues: number;
  }[];
}
export type Outcome = 'approved' | 'reconciled' | 'rejected' | 'needs_human';
export type LensEffect = 'improves' | 'unchanged' | 'worsens';
export interface SimSummary {
  label: string;
  playbook: string | null;
  change: {
    type: ChangeType;
    params: Record<string, unknown>;
  };
  ux_before: number;
  ux_after: number;
  seo_before: number;
  seo_after: number;
  ux: LensEffect;
  seo: LensEffect;
  parts: {
    lens: 'ux' | 'seo';
    key: string;
    label: string;
    before: number;
    after: number;
    delta: number;
  }[];
  link_depth: {
    id: string;
    before: number | null;
    after: number | null;
  }[];
}
export interface Decision {
  id: string;
  proposal_id: string;
  proposal_key: string;
  proposal_title: string;
  agent: string;
  change_type: string;
  outcome: Outcome;
  ux_before: number;
  ux_after: number;
  seo_before: number;
  seo_after: number;
  rationale: string;
  note: string | null;
  precedent: boolean;
  precedent_id: string | null;
  playbook: {
    id: string;
    name: string;
  } | null;
  tried_playbooks: string[];
  simulations: SimSummary[];
  screens: string[];
  mode: 'rules' | 'llm';
  github_issue_url: string | null;
  linear_issue_url: string | null;
  created_at: string;
  updated_at: string;
}
export interface PlaybookRow {
  id: string;
  name: string;
  pattern: string;
  change_type: string;
  success_count: number;
  fail_count: number;
}
export type DecideEvent =
  | {
      type: 'start';
      graph: string;
      mode: string;
      proposals: number;
      started_at: string;
    }
  | {
      type: 'precedent';
      proposal_id: string;
      decision_id: string;
      outcome: string;
      playbook: string | null;
    }
  | {
      type: 'simulating';
      proposal_id: string;
      label: string;
    }
  | {
      type: 'result';
      proposal_id: string;
      simulation: SimSummary;
    }
  | {
      type: 'decision';
      decision: Decision;
    }
  | {
      type: 'note';
      message: string;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'done';
      decisions: number;
      outcomes: Record<string, number>;
      ms: number;
    };
export async function* decide(
  graph: string,
  mode: 'rules' | 'llm',
  signal?: AbortSignal,
): AsyncGenerator<DecideEvent> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${g(graph)}/decide`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal,
    });
  } catch {
    throw new ApiError(`Cannot reach the FlowLens API at ${API_URL}.`, null);
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(body?.error ?? `Arbitration failed (${res.status})`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      const data = buffer
        .slice(0, cut)
        .split('\n')
        .find((l) => l.startsWith('data: '));
      buffer = buffer.slice(cut + 2);
      if (data) yield JSON.parse(data.slice(6)) as DecideEvent;
      cut = buffer.indexOf('\n\n');
    }
  }
}
export const decisionsApi = {
  list: (graph: string) =>
    get<{
      decisions: Decision[];
      playbooks: PlaybookRow[];
    }>(`${g(graph)}/decisions`),
  preview: (graph: string, id: string) =>
    get<IssuePreview>(`${g(graph)}/decisions/${encodeURIComponent(id)}/issue-preview`),
  createIssue: (graph: string, id: string, assignee?: string) =>
    post<CreatedIssue>(
      `${g(graph)}/decisions/${encodeURIComponent(id)}/github-issue`,
      assignee ? { assignee } : {},
    ),
  linearPreview: (graph: string, id: string) =>
    get<LinearPreview>(`${g(graph)}/decisions/${encodeURIComponent(id)}/linear-preview`),
  createLinear: (graph: string, id: string) =>
    post<CreatedLinearIssue>(`${g(graph)}/decisions/${encodeURIComponent(id)}/linear-issue`, {}),
  debate: (graph: string, id: string, mode: 'rules' | 'llm' = 'rules') =>
    get<Debate>(`${g(graph)}/decisions/${encodeURIComponent(id)}/debate?mode=${mode}`),
};
export interface DebateArgument {
  agent: 'ux' | 'seo';
  stance: 'for' | 'against' | 'no objection';
  headline: string;
  points: string[];
  text: string | null;
}
export interface Debate {
  decision_id: string;
  proposal_id: string;
  title: string;
  change_type: string;
  outcome: Outcome;
  contested: boolean;
  conflict: {
    seo: { id: string; name: string };
    ux: { id: string; name: string };
    reason: string;
  } | null;
  for: DebateArgument;
  against: DebateArgument;
  compromise: {
    playbook: { id: string; name: string; description: string };
    points: string[];
  } | null;
  tried_playbooks: string[];
  mode: 'rules' | 'llm';
  note: string | null;
}
export interface Me {
  tenant: {
    id: string;
    name: string;
    dev_token: boolean;
  };
  user: {
    id: string;
    name: string;
  };
  users: {
    id: string;
    name: string;
  }[];
  graphs: string[];
}
export const meApi = () => get<Me>('/api/me');
export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  kind: 'fact' | 'preference';
  confidence: number;
  valid_from: string;
  valid_to: string | null;
  source_episode: string | null;
  last_confirmed: string | null;
  superseded_by: string | null;
  supersedes: string[];
  scope: 'team' | 'user';
}
export interface Episode {
  id: string;
  type: string;
  agent: string;
  summary: string;
  at: string;
  graph: string | null;
  ref_key: string | null;
  scope: 'team' | 'user';
}
export interface Procedure {
  id: string;
  name: string;
  agent: string;
  steps: string[];
  uses: number;
  last_used: string | null;
}
export interface PlaybookStat {
  id: string;
  name: string;
  success_count: number;
  fail_count: number;
  rate: number | null;
}
export const memoryApi = {
  facts: (includeHistory = false) =>
    get<{
      facts: Fact[];
    }>(`/api/memory/facts?limit=200${includeHistory ? '&include_history=true' : ''}`).then(
      (r) => r.facts,
    ),
  episodes: () =>
    get<{
      episodes: Episode[];
    }>('/api/memory/episodes?limit=200').then((r) => r.episodes),
  preferences: () =>
    get<{
      preferences: Fact[];
    }>('/api/memory/preferences').then((r) => r.preferences),
  procedures: () =>
    get<{
      procedures: Procedure[];
      playbooks: PlaybookStat[];
    }>('/api/memory/procedures'),
  remember: (f: {
    subject: string;
    predicate: string;
    object: string;
    kind: 'fact' | 'preference';
  }) =>
    post<{
      fact: Fact;
      status: string;
      superseded: string[];
    }>('/api/memory/facts', f),
};
export interface ChatSession {
  id: string;
  user: string;
  started_at: string;
  last_at: string;
  status: 'open' | 'closed';
  summary?: string | null;
}
export interface ChatMessage {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  tool_calls: {
    tool: string;
    args: Record<string, unknown>;
  }[];
}
export interface Remembered {
  summary: string | null;
  summary_at: string | null;
  preferences: Fact[];
  facts: Fact[];
}
export const chatApi = {
  sessions: () =>
    get<{
      sessions: ChatSession[];
      remembered: Remembered;
    }>('/api/chat/sessions'),
  start: () =>
    post<{
      session: ChatSession;
      remembered: Remembered;
    }>('/api/chat/sessions', {}),
  session: (id: string) =>
    get<{
      session: ChatSession;
      messages: ChatMessage[];
    }>(`/api/chat/sessions/${encodeURIComponent(id)}`),
  send: (id: string, text: string, graph: string, mode: 'rules' | 'llm') =>
    post<{
      question: ChatMessage;
      reply: ChatMessage;
      intent: string;
      mode: string;
      note: string | null;
    }>(`/api/chat/sessions/${encodeURIComponent(id)}/messages`, { text, graph, mode }),
  close: (id: string) =>
    post<{
      session: ChatSession;
      episode: string | null;
      preferences: string[];
    }>(`/api/chat/sessions/${encodeURIComponent(id)}/close`, {}),
};
export interface Handoff {
  id: string;
  kind: string;
  from_agent: string;
  to_agent: string;
  payload_key: string;
  status: 'pending' | 'claimed' | 'done' | 'failed';
  claimed_by: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  done_at: number | null;
  attempts: number;
  error: string | null;
  run_id: string | null;
  graph: string | null;
  result: string | null;
}
export const coordApi = {
  handoffs: (runId?: string) =>
    get<{
      handoffs: Handoff[];
      now: number;
    }>(`/api/handoffs?limit=200${runId ? `&run_id=${encodeURIComponent(runId)}` : ''}`),
  pipeline: (graph: string, compareWith?: string) =>
    post<{
      run_id: string;
      handoffs: Handoff[];
      comparison: string | null;
    }>(`${g(graph)}/pipeline`, compareWith ? { compare_with: compareWith } : {}),
  state: () =>
    get<{
      state: {
        key: string;
        value: unknown;
        version: number;
      }[];
    }>('/api/state').then((r) => r.state),
};
export type ProblemSeverity = 'high' | 'medium' | 'low';
export type ProblemStage = 'found' | 'fix_suggested' | 'decided' | 'sent' | 'resolved';
export type ProblemProcess = 'page_check' | 'map_analysis' | 'content_analysis';
export interface FoundBy {
  process: ProblemProcess;
  process_label: string;
  by: string;
  detail: string;
  finding_id?: string;
  issue_id?: string;
}
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
export interface Problem {
  id: string;
  title: string;
  severity: ProblemSeverity;
  lenses: Lens[];
  stage: ProblemStage;
  outcome: Outcome | null;
  finding_ids: string[];
  issue_ids: string[];
  related_issue_ids: string[];
  proposal_ids: string[];
  decision_ids: string[];
  screens: string[];
  found_by: FoundBy[];
  guide: {
    in_app: InAppTool[];
    external: ExternalTool[];
  };
}
export interface ProblemSummary {
  problems: number;
  by_lens: Record<Lens, number>;
  by_severity: Record<ProblemSeverity, number>;
  by_process: Record<ProblemProcess, number>;
  with_fix: number;
  by_outcome: Partial<Record<Outcome, number>>;
  sent: number;
  resolved: number;
  agents_run: boolean;
  check_results: number;
  agent_findings: number;
}
export const problemsApi = {
  list: (graph: string) =>
    get<{
      problems: Problem[];
      summary: ProblemSummary;
    }>(`${g(graph)}/problems`),
};
