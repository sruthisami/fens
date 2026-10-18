import type { Core } from 'cytoscape';
export function highlight(cy: Core, nodeIds: string[], edgeIds: string[] = []): void {
  cy.batch(() => {
    cy.elements().removeClass('dimmed highlighted');
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    const nodes = new Set(nodeIds);
    const edges = new Set(edgeIds);
    cy.elements().addClass('dimmed');
    cy.nodes()
      .filter((n) => nodes.has(n.id()))
      .removeClass('dimmed')
      .addClass('highlighted');
    cy.edges()
      .filter((e) => edges.has(e.id()))
      .removeClass('dimmed')
      .addClass('highlighted');
  });
}
export function clearHighlight(cy: Core): void {
  highlight(cy, []);
}
