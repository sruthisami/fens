import type { Fact } from './memory.js';
export const NO = /^(no|false|off|never|do not flag|don't flag)$/i;
export function isSuppressing(p: Pick<Fact, 'kind' | 'predicate' | 'object'>): boolean {
  return (
    p.kind === 'preference' &&
    p.predicate.trim().toLowerCase() === 'flag' &&
    NO.test(p.object.trim())
  );
}
export function suppressedBy(
  f: {
    key: string;
    category: string;
    target: {
      type: string;
      id: string;
    } | null;
  },
  prefs: Fact[],
): Fact | null {
  const parts = f.key.split('|');
  for (const p of prefs) {
    if (!isSuppressing(p)) continue;
    const [kind, ...rest] = p.subject.split(':');
    const value = rest.join(':');
    if (!value) continue;
    if (kind === 'rule' && parts.includes(value)) return p;
    if (kind === 'category' && f.category === value) return p;
    if (
      (kind === 'component' || kind === 'screen') &&
      f.target?.type === kind &&
      f.target.id === value
    )
      return p;
  }
  return null;
}
export function parsePreference(text: string): {
  subject: string;
  predicate: string;
  object: string;
} | null {
  const m =
    /\b(?:do not|don't|dont|stop|never)\s+(?:flag|report|show)(?:ing)?\s+(?:the\s+)?(?:(rule|category|component|screen)\s+)?["'`]?([\w/:.-]+)["'`]?/i.exec(
      text,
    );
  if (!m) return null;
  const value = (m[2] ?? '').replace(/[.,;!?]+$/, '');
  if (!value) return null;
  const kind =
    m[1]?.toLowerCase() ??
    (value.startsWith('/') ? 'screen' : /^[A-Z]/.test(value) ? 'component' : 'rule');
  return { subject: `${kind}:${value}`, predicate: 'flag', object: 'no' };
}
