import type { GuidelineRef } from './types.js';
const SC_NAMES: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  '1.2.2': 'Captions (Prerecorded)',
  '1.3.1': 'Info and Relationships',
  '1.3.5': 'Identify Input Purpose',
  '1.4.1': 'Use of Color',
  '1.4.2': 'Audio Control',
  '1.4.3': 'Contrast (Minimum)',
  '1.4.4': 'Resize Text',
  '1.4.10': 'Reflow',
  '1.4.11': 'Non-text Contrast',
  '1.4.12': 'Text Spacing',
  '2.1.1': 'Keyboard',
  '2.2.1': 'Timing Adjustable',
  '2.2.2': 'Pause, Stop, Hide',
  '2.4.1': 'Bypass Blocks',
  '2.4.2': 'Page Titled',
  '2.4.4': 'Link Purpose (In Context)',
  '2.4.7': 'Focus Visible',
  '2.5.3': 'Label in Name',
  '2.5.8': 'Target Size (Minimum)',
  '3.1.1': 'Language of Page',
  '3.1.2': 'Language of Parts',
  '3.3.2': 'Labels or Instructions',
  '4.1.1': 'Parsing',
  '4.1.2': 'Name, Role, Value',
};
export function wcag(sc: string): GuidelineRef {
  return { id: `WCAG ${sc}`, name: SC_NAMES[sc] ?? `WCAG ${sc}`, source: 'WCAG 2.2' };
}
export function guidelinesFromAxe(ruleId: string, tags: string[], help: string): GuidelineRef[] {
  const scs = tags
    .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  if (scs.length === 0) return [{ id: `axe:${ruleId}`, name: help, source: 'axe-core' }];
  return [...new Set(scs)].map(wcag);
}
