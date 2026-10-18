import type { ElementDefinition, StylesheetStyle } from 'cytoscape';
import type { GraphData } from '../api';
const MIN_SIZE = 26;
const MAX_SIZE = 64;
export function toElements(data: GraphData): ElementDefinition[] {
  const maxDegree = Math.max(1, ...data.nodes.map((n) => n.in_degree + n.out_degree));
  const nodes: ElementDefinition[] = data.nodes.map((n) => {
    const degree = n.in_degree + n.out_degree;
    const classes = [
      n.orphan ? 'orphan' : '',
      n.dead_end ? 'dead-end' : '',
      n.state_required ? 'state-required' : '',
    ].filter(Boolean);
    return {
      group: 'nodes',
      data: {
        id: n.id,
        label: [
          n.path,
          n.local_issue_count > 0
            ? `⚠ ${n.local_issue_count} issue${n.local_issue_count === 1 ? '' : 's'}`
            : '',
          n.unreachable_by_links ? '⊘ no link path' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        baseLabel: [
          n.path,
          n.local_issue_count > 0
            ? `⚠ ${n.local_issue_count} issue${n.local_issue_count === 1 ? '' : 's'}`
            : '',
          n.unreachable_by_links ? '⊘ no link path' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        size: Math.round(MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.sqrt(degree / maxDegree)),
        orphan: n.orphan,
      },
      classes: classes.join(' '),
    };
  });
  const edges: ElementDefinition[] = data.edges.map((e) => ({
    group: 'edges',
    data: { id: e.id, source: e.source, target: e.target, shared: e.shared },
    classes: [e.via.every((v) => v === 'js') ? 'js' : 'link', e.shared ? 'shared' : '']
      .filter(Boolean)
      .join(' '),
  }));
  return [...nodes, ...edges];
}
export const GROUP_COLORS = [
  '#bfdbfe',
  '#fde68a',
  '#bbf7d0',
  '#fecaca',
  '#ddd6fe',
  '#fed7aa',
  '#a5f3fc',
  '#f5d0fe',
];
export const STYLE: StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle',
      width: 'data(size)',
      height: 'data(size)',
      'background-color': '#dbe4ff',
      'border-width': 2,
      'border-color': '#1e3a8a',
      label: 'data(label)',
      color: '#111827',
      'font-size': 11,
      'font-family': 'system-ui, sans-serif',
      'text-valign': 'bottom',
      'text-margin-y': 5,
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.9,
      'text-background-padding': '2px',
      'text-wrap': 'wrap',
      'text-max-width': '170px',
    },
  },
  {
    selector: 'node.dead-end',
    style: { shape: 'octagon', 'background-color': '#ffedd5', 'border-color': '#9a3412' },
  },
  {
    selector: 'node.orphan',
    style: { shape: 'diamond', 'background-color': '#fee2e2', 'border-color': '#b91c1c' },
  },
  { selector: 'node.state-required', style: { 'border-style': 'dashed', 'border-width': 3 } },
  {
    selector: 'node:selected',
    style: { 'border-width': 5, 'border-color': '#111827', 'overlay-opacity': 0 },
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#6b7280',
      'target-arrow-color': '#6b7280',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.9,
      'curve-style': 'bezier',
    },
  },
  { selector: 'edge.js', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
  { selector: 'edge.shared', style: { width: 1 } },
  { selector: '.hidden', style: { display: 'none' } },
  { selector: 'node.grouped', style: { 'background-color': 'data(groupColor)' } },
  { selector: '.js-hidden', style: { display: 'none' } },
  { selector: 'node.dimmed', style: { 'background-opacity': 0.25, 'border-opacity': 0.3 } },
  { selector: 'edge.dimmed', style: { opacity: 0.15 } },
  { selector: 'node.highlighted', style: { 'border-width': 5, 'border-color': '#111827' } },
  {
    selector: 'edge.highlighted',
    style: {
      display: 'element',
      width: 3,
      'line-color': '#111827',
      'target-arrow-color': '#111827',
    },
  },
];
