import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}flaws.json`, 'utf8'));
const flawsPath = `${root}FLAWS.md`;
const STATUS = { present: 'Present', fixed: 'Fixed', persisting: 'Persisting' };
const value = (v) => (v === null ? 'none' : String(v));
const code = (s) => `\`${s}\``;
function table(head, rows) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [
    line(head),
    `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}
const items = (kind) => manifest.items.filter((i) => i.kind === kind);
const statusRow = (i) => [i.id, i.title, STATUS[i.status.v1], STATUS[i.status.v2]];
function expectedTable() {
  const rows = [];
  for (const [name, key] of [
    ['Screens', 'screens'],
    ['Orphans', 'orphans'],
    ['Dead ends', 'dead_ends'],
    ['Health (illustrative)', 'health'],
    ['UX lens score', 'ux_score'],
    ['SEO lens score', 'seo_score'],
  ])
    rows.push(['All', name, value(manifest.versions.v1[key]), value(manifest.versions.v2[key])]);
  for (const i of manifest.items) {
    const keys = [...new Set([...Object.keys(i.expected.v1), ...Object.keys(i.expected.v2)])];
    for (const k of keys)
      rows.push([
        i.id,
        k.replace(/_/g, ' '),
        value(i.expected.v1[k] ?? null),
        value(i.expected.v2[k] ?? null),
      ]);
  }
  return table(['ID', 'Measure', 'v1', 'v2'], rows);
}
function detectionTable() {
  return table(
    ['ID', 'Issue rules', 'Tools', 'Findings', 'Proposal and decision'],
    manifest.items.map((i) => [
      i.id,
      i.detection.issues.map((x) => code(x.rule_id)).join(', ') || '—',
      i.detection.tools.map(code).join(', ') || '—',
      i.detection.findings.map(code).join(', ') || '—',
      i.proposal
        ? `${i.proposal.agent} ${code(i.proposal.change_type)} on ${code(i.proposal.target)}: ${i.decision?.outcome ?? '—'}${i.decision?.playbook ? ` (${code(i.decision.playbook)})` : ''}`
        : '—',
    ]),
  );
}
function unplantedTables() {
  const u = items('unplanted');
  const versions = (i) => ['v1', 'v2'].filter((v) => i.status[v] !== 'fixed').join(', ');
  const issueRows = u.flatMap((i) =>
    i.detection.issues.map((x) => [
      code(x.rule_id),
      code(x.source),
      i.routes.map(code).join(', '),
      versions(i),
    ]),
  );
  const findingRows = u
    .filter((i) => i.detection.findings.length)
    .map((i) => [
      i.id,
      i.detection.findings.map(code).join(', '),
      i.routes.map(code).join(', '),
      versions(i),
    ]);
  return [
    'Issues the checks report that were not planted:',
    '',
    table(['Rule', 'Source', 'Screens', 'Versions'], issueRows),
    '',
    'Agent findings that were not planted:',
    '',
    table(['ID', 'Finding', 'Screens', 'Versions'], findingRows),
  ].join('\n');
}
const BLOCKS = {
  summary: () => table(['ID', 'Flaw', 'v1', 'v2'], items('flaw').map(statusRow)),
  conflicts: () => table(['ID', 'Conflict', 'v1', 'v2'], items('conflict').map(statusRow)),
  expected: expectedTable,
  detection: detectionTable,
  unplanted: unplantedTables,
};
const cells = (s) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\|[\s|:-]+\|$/.test(l))
    .map((l) =>
      l
        .split('|')
        .map((c) => c.trim())
        .join('|'),
    );
const marker = (name) =>
  new RegExp(`(<!-- flaws:${name} -->\\n)([\\s\\S]*?)(\\n<!-- /flaws:${name} -->)`);
let text = readFileSync(flawsPath, 'utf8');
const problems = [];
for (const [name, build] of Object.entries(BLOCKS)) {
  const m = marker(name).exec(text);
  if (!m) {
    problems.push(`FLAWS.md has no <!-- flaws:${name} --> block`);
    continue;
  }
  const want = build();
  const have = cells(m[2]);
  const exp = cells(want);
  if (have.join('\n') !== exp.join('\n')) {
    const changed = exp
      .map((row, k) => [row, have[k] ?? '(missing row)'])
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => `    expected: ${a}\n    found:    ${b}`);
    if (have.length > exp.length) changed.push(`    ${have.length - exp.length} extra row(s)`);
    problems.push(`the ${name} table differs from flaws.json:\n${changed.join('\n')}`);
  }
  text = text.replace(marker(name), `$1\n${want}\n$3`);
}
if (process.argv.includes('--check')) {
  if (problems.length) {
    for (const p of problems) console.error(`FAIL  ${p}`);
    console.error('Run npm run flaws:md to regenerate the tables from flaws.json.');
    process.exit(1);
  }
  console.log('PASS  FLAWS.md tables match flaws.json');
} else {
  if (problems.some((p) => p.includes('has no'))) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  writeFileSync(flawsPath, text);
  console.log(`FLAWS.md: ${Object.keys(BLOCKS).length} tables written from flaws.json`);
}
