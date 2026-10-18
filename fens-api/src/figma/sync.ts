export interface Connection {
  from: string;
  label: string;
  to: string;
}
export interface PrototypeGraph {
  page: string;
  exported_at: string;
  hash: string;
  transition: string | null;
  starting_points: string[];
  mirror_frames: Record<string, string>;
  state_only: string[];
  connections: Connection[];
  capture_gaps: Connection[];
}
export interface GraphEdge {
  from: string;
  to: string;
  action: string;
}
export const CLASSES = [
  'missing',
  'extra',
  'wrong_target',
  'ambiguity',
  'state_only',
  'screens',
  'orphans_dead_ends',
  'state_dependent',
  'settings',
] as const;
export type SyncClass = (typeof CLASSES)[number];
export interface SyncResult {
  classes: Record<SyncClass, string[]>;
  capture_gaps: string[];
  matched: number;
  edges: number;
}
export const normLabel = (s: string) =>
  s
    .replace(/\(\d+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const STARTS = ['Home', 'Checkout flow', 'Password reset'];
const key = (c: Connection) => `${c.from}|${c.label}|${c.to}`;
const show = (c: Connection) => `${c.from} "${c.label}" -> ${c.to}`;
export function compareProto(
  rawEdges: GraphEdge[],
  proto: PrototypeGraph,
  screens: string[],
  frames: Record<string, string>,
): SyncResult {
  const classes = Object.fromEntries(CLASSES.map((c) => [c, [] as string[]])) as Record<
    SyncClass,
    string[]
  >;
  const edges = [
    ...new Map(
      rawEdges
        .filter((e) => e.from !== e.to)
        .map((e) => ({ from: e.from, label: normLabel(e.action), to: e.to }))
        .map((c) => [key(c), c]),
    ).values(),
  ];
  const conns = new Map(proto.connections.map((c) => [key(c), c]));
  const gaps = new Set(proto.capture_gaps.map(key));
  const byLabel = new Map<string, Set<string>>();
  for (const e of edges) {
    const k = `${e.from}|${e.label}`;
    byLabel.set(k, (byLabel.get(k) ?? new Set()).add(e.to));
  }
  for (const [k, targets] of byLabel)
    if (targets.size > 1)
      classes.ambiguity.push(`${k.replace('|', ' "')}" -> ${[...targets].join(', ')}`);
  let matched = 0;
  const captureGaps: string[] = [];
  for (const e of edges) {
    if (conns.has(key(e))) {
      matched++;
      continue;
    }
    if (gaps.has(key(e))) {
      captureGaps.push(show(e));
      continue;
    }
    const other = proto.connections.filter((c) => c.from === e.from && c.label === e.label);
    if (other.length)
      classes.wrong_target.push(`${show(e)} (Figma: ${other.map((c) => c.to).join(', ')})`);
    else classes.missing.push(show(e));
  }
  const edgeKeys = new Set(edges.map(key));
  for (const g of proto.capture_gaps)
    if (!edgeKeys.has(key(g)))
      classes.extra.push(`capture gap ${show(g)} is not a graph edge any more`);
  for (const c of proto.connections) {
    if (edgeKeys.has(key(c))) continue;
    if (byLabel.has(`${c.from}|${c.label}`)) continue;
    if (proto.state_only.includes(c.label))
      classes.state_only.push(`${show(c)}: a state-only click has a connection`);
    else classes.extra.push(show(c));
  }
  for (const s of screens) if (!frames[s]) classes.screens.push(`${s}: no frame in figma-map.json`);
  for (const f of Object.keys(frames))
    if (!screens.includes(f) && !proto.mirror_frames[f])
      classes.screens.push(`frame ${f} has no graph screen`);
  for (const c of proto.connections)
    for (const s of [c.from, c.to])
      if (!screens.includes(s)) classes.screens.push(`${show(c)}: ${s} is not a graph screen`);
  for (const s of screens) {
    if (!edges.some((e) => e.to === s) && proto.connections.some((c) => c.to === s))
      classes.orphans_dead_ends.push(`${s} is an orphan in the graph but has inbound connections`);
    if (!edges.some((e) => e.from === s) && proto.connections.some((c) => c.from === s))
      classes.orphans_dead_ends.push(
        `${s} is a dead end in the graph but has outbound connections`,
      );
  }
  for (const e of edges)
    if (
      (e.to === '/checkout/confirmation' || e.label === 'cart') &&
      !conns.has(key(e)) &&
      !gaps.has(key(e))
    )
      classes.state_dependent.push(`${show(e)} has no connection`);
  if (proto.transition !== 'INSTANT')
    classes.settings.push(
      `transition is ${proto.transition ?? 'unknown'}, not one INSTANT transition`,
    );
  for (const name of STARTS)
    if (!proto.starting_points.some((s) => s === name || s.startsWith(`${name} `)))
      classes.settings.push(`starting point "${name}" is missing`);
  return { classes, capture_gaps: captureGaps, matched, edges: edges.length };
}
export const routesIn = (line: string) =>
  [...line.matchAll(/(\/[\w\-/()]*)/g)].map((m) => m[1] ?? '');
