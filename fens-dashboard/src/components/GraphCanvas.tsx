import cytoscape, { type Core, type LayoutOptions } from 'cytoscape';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { GraphData } from '../api';
import { GROUP_COLORS, STYLE, toElements } from '../graph/elements';
import { clearHighlight, highlight } from '../graph/highlight';
export type LayoutName = 'breadthfirst' | 'cose';
export interface GraphCanvasHandle {
  highlight: (nodeIds: string[], edgeIds?: string[]) => void;
  clearHighlight: () => void;
  resetView: () => void;
}
interface Props {
  data: GraphData;
  layout: LayoutName;
  showShared: boolean;
  crawlableOnly: boolean;
  groups?: Record<string, string> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}
function fitVisible(cy: Core) {
  cy.fit(cy.elements(':visible'), 30);
}
function runLayout(cy: Core, name: LayoutName) {
  const eles = name === 'breadthfirst' ? cy.elements() : cy.nodes().union(cy.edges('[!shared]'));
  const options: LayoutOptions =
    name === 'breadthfirst'
      ? {
          name,
          directed: true,
          roots: cy
            .nodes()
            .filter((n) => n.id() === '/' || n.data('orphan') === true) as unknown as string[],
          spacingFactor: 1.15,
          avoidOverlap: true,
          animate: false,
          fit: false,
        }
      : { name, animate: false, fit: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 90 };
  eles.layout(options).run();
  fitVisible(cy);
}
export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(
  { data, layout, showShared, crawlableOnly, groups = null, selectedId, onSelect },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useImperativeHandle(ref, () => ({
    highlight: (nodeIds, edgeIds = []) => {
      if (cyRef.current) highlight(cyRef.current, nodeIds, edgeIds);
    },
    clearHighlight: () => {
      if (cyRef.current) clearHighlight(cyRef.current);
    },
    resetView: () => {
      if (cyRef.current) fitVisible(cyRef.current);
    },
  }));
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements: toElements(data),
      style: STYLE,
      minZoom: 0.15,
      maxZoom: 3,
      boxSelectionEnabled: false,
    });
    cy.on('tap', 'node', (e) => onSelectRef.current(e.target.id()));
    cy.on('tap', (e) => {
      if (e.target === cy) onSelectRef.current(null);
    });
    cyRef.current = cy;
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]);
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) runLayout(cy, layout);
  }, [data, layout]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges('[?shared]').toggleClass('hidden', !showShared);
  }, [data, showShared]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges('.js').toggleClass('js-hidden', crawlableOnly);
  }, [data, crawlableOnly]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n) => {
      const g = groups?.[n.id()];
      const base = n.data('baseLabel') as string;
      n.data('label', g ? `${base}\nGroup ${g}` : base);
      n.data(
        'groupColor',
        g ? GROUP_COLORS[(g.charCodeAt(0) - 65) % GROUP_COLORS.length] : '#dbe4ff',
      );
      n.toggleClass('grouped', !!g);
    });
  }, [data, groups]);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedId) cy.getElementById(selectedId).select();
  }, [data, selectedId]);
  return (
    <div
      ref={container}
      className="graph-canvas"
      role="img"
      aria-label="Screen graph. Use the screen list to open details with the keyboard."
    />
  );
});
