import { isPresent, SHOP_ONLY, type Item, type Version } from './manifest.js';
export type Cell = 'PASS' | 'FAIL' | 'n/a';
export function cellOf(
  checks: {
    ok: boolean;
    problem: string;
  }[],
  problems: string[],
): Cell {
  if (checks.length === 0) return 'n/a';
  for (const c of checks) if (!c.ok) problems.push(c.problem);
  return checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
}
export interface VerifyLine {
  verdict: 'PASS' | 'FAIL' | 'OK' | 'WARN';
  text: string;
}
export function parseVerify(output: string): VerifyLine[] {
  return output
    .split('\n')
    .map((l) => /^\s+(PASS|FAIL|OK|WARN)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ verdict: m[1] as VerifyLine['verdict'], text: m[2] as string }));
}
export function shopCell(item: Item, lines: VerifyLine[], problems: string[]): Cell {
  const id = new RegExp(`\\b${item.id}\\b`);
  const rules = item.detection.issues.map((i) => i.rule_id);
  const mine = lines.filter((l) =>
    item.kind === 'unplanted'
      ? (l.verdict === 'OK' || l.verdict === 'WARN') && rules.some((r) => l.text.includes(` ${r} `))
      : (l.verdict === 'PASS' || l.verdict === 'FAIL') && id.test(l.text.split(':')[0] ?? ''),
  );
  return cellOf(
    mine.map((l) => ({
      ok: l.verdict === 'PASS' || l.verdict === 'OK',
      problem: `verify ${l.verdict}: ${l.text}`,
    })),
    problems,
  );
}
export interface IssueRow {
  source: string;
  rule_id: string;
  component: string | null;
  screens: string[];
  nodes: number;
  guidelines: string[];
}
export const matchIssues = (item: Item, issues: IssueRow[]) =>
  item.detection.issues.map((d) => ({
    d,
    found: issues.filter(
      (i) =>
        i.rule_id === d.rule_id &&
        i.source === d.source &&
        (d.component === null || i.component === d.component),
    ),
  }));
export function graphCell(
  item: Item,
  v: Version,
  issues: IssueRow[],
  measured: Record<string, number | null | undefined>,
  problems: string[],
): Cell {
  const checks: {
    ok: boolean;
    problem: string;
  }[] = [];
  for (const { d, found } of matchIssues(item, issues)) {
    if (isPresent(item, v)) {
      checks.push({
        ok: found.length === 1,
        problem: `${v}: expected one ${d.source} ${d.rule_id} Issue${d.component ? ` in ${d.component}` : ''}, found ${found.length}`,
      });
      if (d.guideline && found[0])
        checks.push({
          ok: found[0].guidelines.includes(d.guideline),
          problem: `${v}: ${d.rule_id} does not violate ${d.guideline} (${found[0].guidelines.join(', ')})`,
        });
    } else
      checks.push({
        ok: found.length === 0,
        problem: `${v}: ${d.rule_id} should be fixed, found ${found.length}`,
      });
  }
  for (const [key, want] of Object.entries(item.expected[v])) {
    if (SHOP_ONLY.has(key)) continue;
    const got = measured[key];
    if (got === undefined) continue;
    checks.push({ ok: got === want, problem: `${v}: ${key} expected ${want}, measured ${got}` });
  }
  return cellOf(checks, problems);
}
export function findingsCell(item: Item, v: Version, keys: Set<string>, problems: string[]): Cell {
  return cellOf(
    item.detection.findings.map((k) =>
      isPresent(item, v)
        ? { ok: keys.has(k), problem: `${v}: rules mode did not produce ${k}` }
        : {
            ok: !keys.has(k),
            problem: `${v}: ${k} should be gone (fixed), but rules mode produced it`,
          },
    ),
    problems,
  );
}
export interface DiffView {
  issues: {
    fixed: string[];
    new: string[];
    unchanged: string[];
  };
  findings: {
    resolved: string[];
    new: string[];
    persisting: string[];
  };
}
const ISSUE_BUCKET = { fixed: 'fixed', persisting: 'unchanged', present: 'new' } as const;
const FINDING_BUCKET = { fixed: 'resolved', persisting: 'persisting', present: 'new' } as const;
export function diffCell(item: Item, diff: DiffView, problems: string[]): Cell {
  const s = item.status.v2;
  const issueKeys = item.detection.issues.map((d) => issueKey(d.rule_id, d.component));
  const checks = [
    ...issueKeys.map((k) => {
      const bucket = ISSUE_BUCKET[s];
      return {
        ok: diff.issues[bucket].includes(k),
        problem: `diff: Issue ${k} is not in issues.${bucket}`,
      };
    }),
    ...item.detection.findings.map((k) => {
      const bucket = FINDING_BUCKET[s];
      return {
        ok: diff.findings[bucket].includes(k),
        problem: `diff: ${k} is not in findings.${bucket}`,
      };
    }),
  ];
  return cellOf(checks, problems);
}
export interface DecisionRow {
  key: string;
  outcome: string | null;
  playbook: string | null;
}
export function decisionCell(
  item: Item,
  v: Version,
  rows: DecisionRow[],
  problems: string[],
): Cell {
  if (!item.proposal) return 'n/a';
  const key = `${item.proposal.change_type}|${item.proposal.target}`;
  const row = rows.find((r) => r.key === key);
  if (!item.proposal.versions.includes(v))
    return cellOf([{ ok: !row, problem: `${v}: unexpected proposal ${key}` }], problems);
  const want = item.decision;
  return cellOf(
    [
      { ok: !!row, problem: `${v}: no proposal ${key}` },
      ...(want && row
        ? [
            {
              ok: row.outcome === want.outcome,
              problem: `${v}: ${key} decided ${row.outcome ?? 'nothing'}, expected ${want.outcome}`,
            },
            {
              ok: row.playbook === want.playbook,
              problem: `${v}: ${key} playbook ${row.playbook ?? 'none'}, expected ${want.playbook ?? 'none'}`,
            },
          ]
        : []),
    ],
    problems,
  );
}
export function figmaCell(
  item: Item,
  v: Version,
  frames: Record<string, string>,
  problems: string[],
): Cell {
  if (!isPresent(item, v)) return 'n/a';
  return cellOf(
    item.figma_routes.map((r) => ({ ok: !!frames[r], problem: `${v}: no Figma frame for ${r}` })),
    problems,
  );
}
export const pair = (a: Cell, b: Cell) => `${a} / ${b}`;
export const issueKey = (rule: string, component: string | null) => `${rule}|${component ?? ''}`;
