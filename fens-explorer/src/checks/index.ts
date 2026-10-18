import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { axeChecks } from './axe.js';
import { labelMissing } from './labelMissing.js';
import type { CheckFinding, GuidelineRef, IssueSource, Severity } from './types.js';
export type { Severity, IssueSource, GuidelineRef, Lens } from './types.js';
const CHECKS: ((page: Page) => Promise<CheckFinding[]>)[] = [axeChecks, labelMissing];
export interface IssueDef {
  id: string;
  key: string;
  source: IssueSource;
  rule_id: string;
  severity: Severity;
  help: string;
  description: string;
  help_url: string;
  component: string | null;
  guidelines: GuidelineRef[];
}
export interface IssueOccurrence {
  issue: string;
  screen: string;
  selector: string;
  html: string;
  node_count: number;
  details?: string[];
  bbox?: Bbox | null;
}
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export async function boxesOf(page: Page, selectors: string[]): Promise<(Bbox | null)[]> {
  return page.evaluate(
    (list) =>
      list.map((sel) => {
        try {
          const el = sel ? document.querySelector(sel) : null;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.left + window.scrollX),
            y: Math.round(r.top + window.scrollY),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        } catch {
          return null;
        }
      }),
    selectors,
  );
}
export function issueId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}
export function toIssues(screen: string, findings: CheckFinding[]) {
  const issues: IssueDef[] = [];
  const occurrences: IssueOccurrence[] = [];
  for (const f of findings) {
    const groups = new Map<
      string,
      {
        component: string | null;
        nodes: CheckFinding['nodes'];
      }
    >();
    for (const node of f.nodes) {
      const key = node.component
        ? `${f.source}|${f.ruleId}|${node.component}`
        : `${f.source}|${f.ruleId}|${screen}|${node.selector}`;
      const group = groups.get(key) ?? { component: node.component, nodes: [] };
      group.nodes.push(node);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      const id = issueId(key);
      issues.push({
        id,
        key,
        source: f.source,
        rule_id: f.ruleId,
        severity: f.severity,
        help: f.help,
        description: f.description,
        help_url: f.helpUrl,
        component: group.component,
        guidelines: f.guidelines,
      });
      const first = group.nodes[0];
      occurrences.push({
        issue: id,
        screen,
        selector: first?.selector ?? '',
        html: (first?.html ?? '').slice(0, 300),
        node_count: group.nodes.length,
      });
    }
  }
  return { issues, occurrences };
}
export async function runChecks(page: Page, screen: string) {
  const findings: CheckFinding[] = [];
  for (const check of CHECKS) findings.push(...(await check(page)));
  const out = toIssues(screen, findings);
  const boxes = await boxesOf(
    page,
    out.occurrences.map((o) => o.selector),
  ).catch(() => out.occurrences.map(() => null));
  out.occurrences.forEach((o, i) => (o.bbox = boxes[i] ?? null));
  return out;
}
