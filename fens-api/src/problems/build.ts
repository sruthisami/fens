// One list of problems for people: every agent finding, check result (Issue) and proposed change,
// grouped so each thing wrong is shown once, with what found it and the fix and verdict under it.
// Pure, so build.test.ts covers the grouping without a database.
import {
  guideFor,
  PROCESS_LABEL,
  SOURCE_LABEL,
  toolProcess,
  type Guide,
  type Process,
} from './origins.js';

export type Severity = 'high' | 'medium' | 'low';
export type Lens = 'UX' | 'SEO' | 'AEO';
export type Stage = 'found' | 'fix_suggested' | 'decided' | 'sent' | 'resolved';

export interface ProblemFinding {
  id: string;
  key: string;
  agent: 'ux' | 'seo';
  title: string;
  severity: string;
  category: string;
  mode: string;
  origin: string;
  target: { type: string; id: string } | null;
  evidence: { tool: string; args: Record<string, unknown>; screens: string[]; path: string[] }[];
  issue_ids: string[];
  sent: boolean;
  closed_in: string | null;
}
export interface ProblemIssue {
  id: string;
  key: string;
  rule_id: string;
  source: string;
  severity: string;
  help: string;
  lenses: string[];
  component: string | null;
  screens: string[];
}
export interface ProblemProposal {
  id: string;
  agent: string;
  title: string;
  change: { type: string; params: Record<string, unknown> };
  issue_keys: string[];
  targets: { screens: string[]; components: string[] };
}
export interface ProblemDecision {
  id: string;
  proposal_id: string;
  outcome: string;
}
export interface FoundBy {
  process: Process;
  process_label: string;
  by: string;
  detail: string;
  finding_id?: string;
  issue_id?: string;
}
export interface Problem {
  id: string;
  title: string;
  severity: Severity;
  lenses: Lens[];
  stage: Stage;
  outcome: string | null;
  finding_ids: string[];
  issue_ids: string[];
  related_issue_ids: string[];
  proposal_ids: string[];
  decision_ids: string[];
  screens: string[];
  found_by: FoundBy[];
  guide: Guide;
}
export interface ProblemSummary {
  problems: number;
  by_lens: Record<Lens, number>;
  by_severity: Record<Severity, number>;
  by_process: Record<Process, number>;
  with_fix: number;
  by_outcome: Record<string, number>;
  sent: number;
  resolved: number;
  agents_run: boolean;
  check_results: number;
  agent_findings: number;
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const LENS_ORDER: Lens[] = ['UX', 'SEO', 'AEO'];
const issueSeverity = (s: string): Severity =>
  s === 'critical' || s === 'serious' ? 'high' : s === 'moderate' ? 'medium' : 'low';
const asSeverity = (s: string): Severity => (s === 'high' || s === 'medium' ? s : 'low');

// The rule id at the end of a finding key: [seo-agent|]category|type:id[|rule…].
export function findingRule(key: string): string | null {
  const parts = key.split('|');
  if (parts[0] === 'seo-agent') parts.shift();
  const rule = parts.slice(2).join('|');
  return rule ? (rule.split('|')[0] ?? null) : null;
}

// Which findings a change type can fix: by the check rule behind them or the tool that found them.
const FIXES: Record<string, { rules: string[]; tools: string[] }> = {
  table_to_cards: { rules: ['flowlens/mobile-overflow'], tools: ['mobile_overflow_screens'] },
  table_responsive: { rules: ['flowlens/mobile-overflow'], tools: ['mobile_overflow_screens'] },
  content_in_html: { rules: ['flowlens/js-only-content'], tools: ['js_only_content'] },
  add_link: { rules: [], tools: ['find_orphans', 'unreachable_by_links', 'crawl_depth'] },
  remove_links: { rules: ['choice-overload'], tools: ['screen_links'] },
};

export function primaryTarget(change: ProblemProposal['change']): string | null {
  const p = change.params;
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const t =
    change.type === 'add_link' ? first(p.to) : change.type === 'remove_links' ? p.from : p.screen;
  return typeof t === 'string' ? t : null;
}

function fixes(p: ProblemProposal, f: ProblemFinding, issueKeys: Map<string, string>): boolean {
  const keys = new Set(f.issue_ids.map((id) => issueKeys.get(id)).filter(Boolean));
  if (p.issue_keys.some((k) => keys.has(k))) return true;
  const fix = FIXES[p.change.type];
  if (!fix || !f.target) return false;
  const component = p.change.params.component;
  const sameTarget =
    (f.target.type === 'screen' && f.target.id === primaryTarget(p.change)) ||
    (f.target.type === 'component' && f.target.id === component);
  if (!sameTarget) return false;
  const rule = findingRule(f.key);
  return (
    (rule !== null && fix.rules.includes(rule)) ||
    f.evidence.some((e) => fix.tools.includes(e.tool))
  );
}

const findingLens = (f: ProblemFinding): Lens =>
  f.agent === 'seo' ? (f.category === 'aeo' ? 'AEO' : 'SEO') : 'UX';

function findingProcess(f: ProblemFinding): Process {
  const procs = f.evidence.map((e) => toolProcess(e.tool));
  return procs.find((p) => p !== 'page_check') ?? 'page_check';
}

function findingFoundBy(f: ProblemFinding): FoundBy {
  const process = findingProcess(f);
  const agent = f.agent === 'seo' ? 'SEO agent' : 'UX agent';
  const how = f.origin === 'rules' || f.mode === 'rules' ? 'rules' : 'AI';
  const tools = [...new Set(f.evidence.map((e) => e.tool))];
  return {
    process,
    process_label: PROCESS_LABEL[process],
    by: `${agent} (${how})`,
    detail:
      process === 'page_check'
        ? `Reviewed the check results with ${tools.join(', ')}`
        : `Found with ${tools.join(', ')}`,
    finding_id: f.id,
  };
}

function proposalFoundBy(p: ProblemProposal): FoundBy {
  const tool = FIXES[p.change.type]?.tools[0];
  const process = tool ? toolProcess(tool) : 'map_analysis';
  return {
    process,
    process_label: PROCESS_LABEL[process],
    by: p.agent === 'seo' ? 'SEO agent' : 'UX agent',
    detail: `Proposed a change (${p.change.type})${tool ? ` from ${tool}` : ''}`,
  };
}

// The tool behind a change type, for a problem that is only a proposal.
function proposalEvidence(p: ProblemProposal) {
  const tool = FIXES[p.change.type]?.tools[0];
  if (!tool) return [];
  const screen = primaryTarget(p.change);
  return [{ tool, args: tool === 'screen_links' && screen ? { screen } : {} }];
}

function issueFoundBy(i: ProblemIssue, related: boolean): FoundBy {
  const n = i.screens.length;
  return {
    process: 'page_check',
    process_label: PROCESS_LABEL.page_check,
    by: SOURCE_LABEL[i.source] ?? i.source,
    detail: `${i.rule_id} on ${n === 1 ? i.screens[0] : `${n} screens`}${
      related ? ', on the same screen' : ''
    }`,
    issue_id: i.id,
  };
}

export function buildProblems(input: {
  findings: ProblemFinding[];
  issues: ProblemIssue[];
  proposals: ProblemProposal[];
  decisions: ProblemDecision[];
}): { problems: Problem[]; summary: ProblemSummary } {
  const { findings, proposals, decisions } = input;
  const issues = input.issues.filter((i) => i.screens.length > 0);
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const issueKeys = new Map(issues.map((i) => [i.id, i.key]));

  // Union findings that one proposal fixes.
  const parent = new Map(findings.map((f) => [f.id, f.id]));
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const fixedBy = new Map<string, ProblemFinding[]>();
  for (const p of proposals) {
    const hit = findings.filter((f) => fixes(p, f, issueKeys));
    fixedBy.set(p.id, hit);
    for (const f of hit.slice(1)) parent.set(find(f.id), find(hit[0]!.id));
  }

  interface Group {
    findings: ProblemFinding[];
    issues: Set<string>;
    related: Set<string>;
    proposals: ProblemProposal[];
  }
  const groups = new Map<string, Group>();
  const groupOf = (root: string): Group => {
    let g = groups.get(root);
    if (!g) {
      g = { findings: [], issues: new Set(), related: new Set(), proposals: [] };
      groups.set(root, g);
    }
    return g;
  };
  const sortedFindings = [...findings].sort(
    (a, b) =>
      RANK[asSeverity(a.severity)] - RANK[asSeverity(b.severity)] || a.key.localeCompare(b.key),
  );
  for (const f of sortedFindings) {
    const g = groupOf(find(f.id));
    g.findings.push(f);
    for (const id of f.issue_ids) if (issueById.has(id)) g.issues.add(id);
  }
  for (const p of proposals) {
    const hit = fixedBy.get(p.id) ?? [];
    if (hit.length) groupOf(find(hit[0]!.id)).proposals.push(p);
    else groupOf(`proposal:${p.id}`).proposals.push(p);
  }

  // Check results no finding is based on: with the problem about the same screen, else their own.
  const covered = new Set([...groups.values()].flatMap((g) => [...g.issues]));
  for (const i of issues) {
    if (covered.has(i.id)) continue;
    const screen = i.screens.length === 1 ? i.screens[0] : null;
    const home = screen
      ? [...groups.values()].find((g) =>
          g.findings.some((f) => f.target?.type === 'screen' && f.target.id === screen),
        )
      : undefined;
    if (home) home.related.add(i.id);
    else groupOf(`issue:${i.id}`).issues.add(i.id);
  }

  const decisionsOf = new Map<string, ProblemDecision[]>();
  for (const d of decisions)
    decisionsOf.set(d.proposal_id, [...(decisionsOf.get(d.proposal_id) ?? []), d]);

  const problems: Problem[] = [];
  for (const g of groups.values()) {
    const checks = [...g.issues].map((id) => issueById.get(id)!);
    const related = [...g.related].map((id) => issueById.get(id)!);
    const lead = g.findings[0];
    const ds = g.proposals.flatMap((p) => decisionsOf.get(p.id) ?? []);
    const lenses = new Set<Lens>();
    for (const f of g.findings) lenses.add(findingLens(f));
    for (const i of checks)
      for (const l of i.lenses) if (LENS_ORDER.includes(l as Lens)) lenses.add(l as Lens);
    for (const p of g.proposals)
      if (!g.findings.length) lenses.add(p.agent === 'seo' ? 'SEO' : 'UX');
    const severity: Severity = g.findings.length
      ? g.findings.map((f) => asSeverity(f.severity)).sort((a, b) => RANK[a] - RANK[b])[0]!
      : checks.length
        ? checks.map((i) => issueSeverity(i.severity)).sort((a, b) => RANK[a] - RANK[b])[0]!
        : 'medium';
    const first = checks[0];
    const title = lead
      ? lead.title
      : first
        ? `${first.help} (${first.component ?? (first.screens.length === 1 ? first.screens[0] : `${first.screens.length} screens`)})`
        : (g.proposals[0]?.title ?? 'Problem');
    const screens = new Set<string>();
    for (const f of g.findings) {
      if (f.target?.type === 'screen') screens.add(f.target.id);
      for (const e of f.evidence) for (const s of e.path) screens.add(s);
    }
    for (const i of [...checks, ...related]) for (const s of i.screens) screens.add(s);
    for (const p of g.proposals) for (const s of p.targets.screens) screens.add(s);
    const stage: Stage = g.findings.some((f) => f.closed_in)
      ? 'resolved'
      : g.findings.some((f) => f.sent)
        ? 'sent'
        : ds.length
          ? 'decided'
          : g.proposals.length
            ? 'fix_suggested'
            : 'found';
    problems.push({
      id: lead?.id ?? first?.id ?? g.proposals[0]!.id,
      title,
      severity,
      lenses: LENS_ORDER.filter((l) => lenses.has(l)),
      stage,
      outcome: ds[0]?.outcome ?? null,
      finding_ids: g.findings.map((f) => f.id),
      issue_ids: checks.map((i) => i.id),
      related_issue_ids: related.map((i) => i.id),
      proposal_ids: g.proposals.map((p) => p.id),
      decision_ids: ds.map((d) => d.id),
      screens: [...screens].sort(),
      found_by: [
        ...g.findings.map(findingFoundBy),
        ...(g.findings.length ? [] : g.proposals.map(proposalFoundBy)),
        ...checks.map((i) => issueFoundBy(i, false)),
        ...related.map((i) => issueFoundBy(i, true)),
      ],
      guide: guideFor(
        g.findings.length
          ? g.findings.flatMap((f) => f.evidence)
          : g.proposals.flatMap(proposalEvidence),
        [...checks, ...related],
      ),
    });
  }
  problems.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      b.screens.length - a.screens.length ||
      a.title.localeCompare(b.title),
  );
  return { problems, summary: summarize(problems, findings.length, issues.length) };
}

function summarize(problems: Problem[], findings: number, checks: number): ProblemSummary {
  const by_lens: Record<Lens, number> = { UX: 0, SEO: 0, AEO: 0 };
  const by_severity: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  const by_process: Record<Process, number> = {
    page_check: 0,
    map_analysis: 0,
    content_analysis: 0,
  };
  const by_outcome: Record<string, number> = {};
  for (const p of problems) {
    for (const l of p.lenses) by_lens[l]++;
    by_severity[p.severity]++;
    for (const proc of new Set(p.found_by.map((f) => f.process))) by_process[proc]++;
    if (p.outcome) by_outcome[p.outcome] = (by_outcome[p.outcome] ?? 0) + 1;
  }
  return {
    problems: problems.length,
    by_lens,
    by_severity,
    by_process,
    with_fix: problems.filter((p) => p.proposal_ids.length).length,
    by_outcome,
    sent: problems.filter((p) => p.stage === 'sent' || p.stage === 'resolved').length,
    resolved: problems.filter((p) => p.stage === 'resolved').length,
    agents_run: findings > 0,
    check_results: checks,
    agent_findings: findings,
  };
}
