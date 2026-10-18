// Check results (Issues) that no finding of the agent covers become findings of their own, so every
// problem in the dashboard has a finding that can be sent to a channel.
import type { FindingInput } from './types.js';

type Call = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;
export interface CheckResult {
  id: string;
  key: string;
  rule_id: string;
  source: string;
  severity: string;
  help: string;
  help_url: string | null;
  lenses: string[];
  component: string | null;
  screens: string[];
}

const SOURCE: Record<string, string> = {
  axe: 'axe-core',
  flowlens: 'FlowLens',
  lighthouse: 'Lighthouse',
};
const severityOf = (s: string): FindingInput['severity'] =>
  s === 'critical' || s === 'serious' ? 'high' : s === 'moderate' ? 'medium' : 'low';

// Covered: the finding is based on it, targets its component, or targets its only screen or the
// screen of a finding with the same rule.
export function covered(issue: CheckResult, findings: FindingInput[]): boolean {
  return findings.some((f) => {
    if (f.issue_ids?.includes(issue.id)) return true;
    if (f.target.type === 'component') return f.target.id === issue.component;
    if (f.target.type !== 'screen') return false;
    if (issue.screens.length === 1 && issue.screens[0] === f.target.id) return true;
    return f.rule_id?.split('|')[0] === issue.rule_id && issue.screens.includes(f.target.id);
  });
}

export function checkFinding(issue: CheckResult, agent: 'ux' | 'seo'): FindingInput {
  const n = issue.screens.length;
  const where = issue.component ?? (n === 1 ? issue.screens[0] : `${n} screens`);
  const list = issue.screens.slice(0, 6).join(', ') + (n > 6 ? ', ...' : '');
  const source = SOURCE[issue.source] ?? issue.source;
  return {
    title: `${issue.help} (${where})`,
    severity: severityOf(issue.severity),
    category:
      agent === 'ux'
        ? 'accessibility'
        : issue.lenses.includes('AEO') && !issue.lenses.includes('SEO')
          ? 'aeo'
          : 'seo',
    explanation: `The ${source} check ${issue.rule_id} fails on ${list}: ${issue.help}. It was marked ${issue.severity}.`,
    evidence: [
      {
        tool: 'check_results',
        args: { lens: agent === 'ux' ? 'UX' : (issue.lenses[0] ?? 'SEO') },
        screens: issue.screens,
        path: [],
      },
    ],
    recommendation: `Fix ${issue.rule_id} on ${list}${issue.help_url ? ` (guidance: ${issue.help_url})` : ''}, then crawl again to confirm.`,
    target: issue.component
      ? { type: 'component', id: issue.component }
      : { type: 'screen', id: issue.screens[0]! },
    rule_id: issue.rule_id,
    issue_ids: [issue.id],
  };
}

// UX files check results with a UX guideline; SEO files the rest (SEO and AEO only).
export async function checkFindings(
  call: Call,
  agent: 'ux' | 'seo',
  findings: FindingInput[],
): Promise<FindingInput[]> {
  const r = (await call('check_results')) as { result: { issues: CheckResult[] } };
  return r.result.issues
    .filter((i) => i.screens.length > 0)
    .filter((i) => (agent === 'ux') === i.lenses.includes('UX'))
    .filter((i) => i.lenses.length > 0 && !covered(i, findings))
    .map((i) => checkFinding(i, agent));
}
