const TIMEOUT_MS = 10000;
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}
export function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (field === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true;
      if (agents.includes('*') && value) rules.push({ allow: field === 'allow', pattern: value });
    }
  }
  return rules;
}
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}
export function isAllowed(path: string, rules: RobotsRule[]): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.allow)
    )
      best = r;
  }
  return best ? best.allow : true;
}
export async function fetchRobots(origin: string): Promise<{
  found: boolean;
  rules: RobotsRule[];
}> {
  const res = await fetch(`${origin}/robots.txt`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) return { found: false, rules: [] };
  return { found: true, rules: parseRobots(await res.text()) };
}
