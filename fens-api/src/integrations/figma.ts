import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindingRow } from '../agent/findings.js';
import { env } from '../config/env.js';
import { openGraph } from '../graph/db.js';
import { buildCommonPayload, linksText } from './payload.js';
import type { ChannelRecord } from './record.js';
const MAP_FILE = resolve('figma-map.json');
const API = 'https://api.figma.com/v1';
export interface FigmaPreview {
  dry_run: boolean;
  reasons: string[];
  screen: string | null;
  other_screens: string[];
  file_key: string | null;
  node_id: string | null;
  pinned: 'element' | 'frame';
  offset: {
    x: number;
    y: number;
  };
  request: {
    method: 'POST';
    url: string;
    headers: Record<string, string>;
    body: {
      message: string;
      client_meta: {
        node_id: string;
        node_offset: {
          x: number;
          y: number;
        };
      } | null;
    };
  };
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function screensFor(data: unknown, graph: string): Record<string, string> {
  if (!isObject(data)) return {};
  const own = data[graph];
  const screens = isObject(own) ? own : isObject(data.screens) ? data.screens : {};
  return Object.fromEntries(
    Object.entries(screens).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}
async function screenMap(graph: string): Promise<Record<string, string>> {
  try {
    return screensFor(JSON.parse(await readFile(MAP_FILE, 'utf8')), graph);
  } catch {
    return {};
  }
}
export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type BboxLookup = (screen: string) => Promise<Bbox | null>;
const noBoxes: BboxLookup = async () => null;
export function screensOf(f: Pick<FindingRow, 'evidence' | 'target'>): string[] {
  const all = [
    ...f.evidence.flatMap((e) => [...e.path, ...e.screens]),
    ...(f.target?.type === 'screen' ? [f.target.id] : []),
  ];
  return [...new Set(all)];
}
export function graphBboxLookup(graph: string, findingId: string): BboxLookup {
  return async (screen) => {
    const g = await openGraph(graph);
    const rows = await g.read<Bbox>(
      `MATCH (:Finding {id: $id})-[:BASED_ON]->(:Issue)-[f:FOUND_ON]->(:Screen {id: $screen})
       WHERE f.bbox_x IS NOT NULL
       RETURN f.bbox_x AS x, f.bbox_y AS y, f.bbox_w AS w, f.bbox_h AS h
       ORDER BY y, x LIMIT 1`,
      { id: findingId, screen },
    );
    return rows[0] ?? null;
  };
}
const MAX_LISTED = 12;
export async function figmaPreview(
  graph: string,
  f: FindingRow,
  bboxOf: BboxLookup = noBoxes,
  rec: ChannelRecord = f.channels,
): Promise<FigmaPreview> {
  const common = buildCommonPayload(graph, f);
  const [screen = null, ...others] = screensOf(f);
  const nodeId = screen ? ((await screenMap(graph))[screen] ?? null) : null;
  const box = screen ? await bboxOf(screen) : null;
  const offset = box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
  const reasons = [
    ...(env.FIGMA_TOKEN ? [] : ['FIGMA_TOKEN is not set in fens-api/.env']),
    ...(env.FIGMA_FILE_KEY ? [] : ['FIGMA_FILE_KEY is not set in fens-api/.env']),
    ...(screen ? [] : ['the finding has no screen']),
    ...(screen && !nodeId ? [`figma-map.json has no Figma node for ${screen} in ${graph}`] : []),
  ];
  const also = others.length
    ? ` Also on ${others.length} other screen${others.length === 1 ? '' : 's'}: ${others.slice(0, MAX_LISTED).join(', ')}${others.length > MAX_LISTED ? `, +${others.length - MAX_LISTED} more` : ''}.`
    : '';
  const message = [
    `${common.title} (on ${screen ?? 'this frame'})`,
    common.headline,
    `Evidence: ${common.evidence.join('; ') || 'none recorded'}`,
    `${common.recommendation}${also}`,
    linksText(rec, 'figma', common.link),
  ].join('\n');
  return {
    dry_run: reasons.length > 0,
    reasons,
    screen,
    other_screens: others,
    file_key: env.FIGMA_FILE_KEY ?? null,
    node_id: nodeId,
    pinned: box ? 'element' : 'frame',
    offset,
    request: {
      method: 'POST',
      url: `${API}/files/${env.FIGMA_FILE_KEY ?? '<FIGMA_FILE_KEY>'}/comments`,
      headers: { 'X-Figma-Token': '<FIGMA_TOKEN>', 'Content-Type': 'application/json' },
      body: {
        message,
        client_meta: nodeId ? { node_id: nodeId, node_offset: offset } : null,
      },
    },
  };
}
export function figmaCommentUrl(fileKey: string, nodeId: string | null, commentId: string): string {
  const node = nodeId ? `?node-id=${encodeURIComponent(nodeId.replace(':', '-'))}` : '';
  return `https://www.figma.com/design/${fileKey}${node}#${commentId}`;
}
