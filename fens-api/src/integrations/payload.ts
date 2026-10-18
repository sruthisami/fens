import type { FindingRow } from '../agent/findings.js';
import { env } from '../config/env.js';
import type { ChannelRecord } from './record.js';
export interface CommonPayload {
  finding_id: string;
  title: string;
  severity: string;
  category: string;
  agent: string;
  headline: string;
  evidence: string[];
  explanation: string;
  recommendation: string;
  link: string;
}
const MAX_EVIDENCE = 5;
const MAX_SCREENS = 3;
const capital = (s: string) => (s ? s[0]?.toUpperCase() + s.slice(1) : s);
export function dashboardLink(graph: string, findingId: string): string {
  return `${env.ALLOWED_ORIGIN}/?graph=${encodeURIComponent(graph)}&finding=${encodeURIComponent(findingId)}`;
}
export function buildCommonPayload(
  graph: string,
  f: Pick<
    FindingRow,
    | 'id'
    | 'title'
    | 'severity'
    | 'category'
    | 'agent'
    | 'evidence'
    | 'explanation'
    | 'recommendation'
  >,
): CommonPayload {
  const severity = capital(f.severity);
  const category = capital(f.category);
  const agent = `${f.agent.toUpperCase()} agent`;
  const evidence = f.evidence.slice(0, MAX_EVIDENCE).map((e) => {
    if (e.path.length > 1) return `${e.tool}: ${e.path.join(' → ')}`;
    const shown = e.screens.slice(0, MAX_SCREENS).join(', ');
    const more = e.screens.length > MAX_SCREENS ? ` +${e.screens.length - MAX_SCREENS} more` : '';
    return `${e.tool}: ${shown || 'no screens'}${more}`;
  });
  if (f.evidence.length > MAX_EVIDENCE)
    evidence.push(`+${f.evidence.length - MAX_EVIDENCE} more evidence items`);
  return {
    finding_id: f.id,
    title: `[FlowLens] ${f.title}`,
    severity,
    category,
    agent,
    headline: `Severity: ${severity} · Category: ${category} · ${agent}`,
    evidence,
    explanation: f.explanation,
    recommendation: f.recommendation,
    link: dashboardLink(graph, f.id),
  };
}
export type Channel = 'github' | 'linear' | 'figma';
export const LINKS_START = '<!-- flowlens-links -->';
export const LINKS_END = '<!-- /flowlens-links -->';
export function otherLinks(
  rec: ChannelRecord,
  own: Channel,
  link: string,
): {
  label: string;
  url: string;
}[] {
  const out = [{ label: 'FlowLens dashboard', url: link }];
  if (own !== 'github' && rec.github)
    out.push({
      label: `GitHub issue${rec.github.number ? ` #${rec.github.number}` : ''}`,
      url: rec.github.url,
    });
  if (own !== 'linear' && rec.linear)
    out.push({
      label: `Linear issue${rec.linear.identifier ? ` ${rec.linear.identifier}` : ''}`,
      url: rec.linear.url,
    });
  if (own !== 'figma' && rec.figma) out.push({ label: 'Figma comment', url: rec.figma.url });
  return out;
}
export function linksBlock(rec: ChannelRecord, own: Channel, link: string): string {
  return [
    LINKS_START,
    '**FlowLens links**',
    ...otherLinks(rec, own, link).map((l) => `- ${l.label}: ${l.url}`),
    LINKS_END,
  ].join('\n');
}
export function linksText(rec: ChannelRecord, own: Channel, link: string): string {
  return `Links: ${otherLinks(rec, own, link)
    .map((l) => `${l.label} ${l.url}`)
    .join(' · ')}`;
}
const MARKED = /<!-- flowlens-links -->[\s\S]*?<!-- \/flowlens-links -->/;
const VISIBLE = /(?:^|\n)\\?\*\\?\*FlowLens links\\?\*\\?\*\n(?:[-*] .*(?:\n|$))*/;
export function replaceLinksBlock(text: string, block: string): string {
  if (MARKED.test(text)) return text.replace(MARKED, block);
  const visible = VISIBLE.exec(text);
  if (visible) {
    const lead = visible[0].startsWith('\n') ? '\n' : '';
    return text.replace(VISIBLE, `${lead}${block}${visible[0].endsWith('\n') ? '\n' : ''}`);
  }
  return `${text.trimEnd()}\n\n${block}`;
}
export function linksCurrent(
  text: string,
  rec: ChannelRecord,
  own: Channel,
  link: string,
): boolean {
  return otherLinks(rec, own, link).every((l) => text.includes(l.url));
}
export interface DiffSummary {
  from: string;
  to: string;
  health: {
    from: number;
    to: number;
    delta: number;
  };
  issues_fixed: number;
  issues_new: number;
  findings_resolved: number;
  findings_new: number;
}
export function resolveText(
  f: Pick<FindingRow, 'id' | 'title'>,
  d: DiffSummary,
): {
  markdown: string;
  text: string;
} {
  const signed = d.health.delta > 0 ? `+${d.health.delta}` : `${d.health.delta}`;
  const diff = `health ${d.health.from} → ${d.health.to} (${signed}); ${d.issues_fixed} issues fixed, ${d.issues_new} new; ${d.findings_resolved} findings resolved, ${d.findings_new} new`;
  const compare = `${env.ALLOWED_ORIGIN}/?graph=${encodeURIComponent(d.to)}`;
  return {
    markdown: [
      `Resolved in \`${d.to}\`: FlowLens no longer finds "${f.title}" (finding \`${f.id}\`).`,
      '',
      `Release diff \`${d.from}\` → \`${d.to}\`: ${diff}.`,
      '',
      `[Compare the releases in FlowLens](${compare})`,
    ].join('\n'),
    text: `Resolved in ${d.to}: FlowLens no longer finds "${f.title}" (finding ${f.id}). Release diff ${d.from} → ${d.to}: ${diff}. ${compare} The Figma REST API cannot mark comments resolved, so please resolve this thread in Figma.`,
  };
}
