import type { IssueDef, IssueOccurrence } from './checks/index.js';
import type { SeoSnapshot } from './seo/types.js';
export type DiscoveredVia = 'start' | 'seed' | 'link' | 'js';
export interface InteractiveElement {
  kind: 'link' | 'button';
  role: string;
  text: string;
  selector: string;
  component: string | null;
  href?: string;
}
export interface ScreenNode {
  id: string;
  path: string;
  url: string;
  title: string;
  fingerprint: string;
  screenshot: string;
  discovered_via: DiscoveredVia;
  depth: number;
  instances: number;
  crawled_at: string;
  state_required: boolean;
}
export interface ScreenRecord extends ScreenNode {
  instance_paths: string[];
  elements: InteractiveElement[];
  seo?: SeoSnapshot;
  lighthouse?: {
    lcp_ms: number | null;
    cls: number | null;
  };
  in_sitemap?: boolean;
  robots_disallowed?: boolean;
}
export interface NavEdge {
  from: string;
  to: string;
  action: string;
  via: 'link' | 'js';
  selector: string;
  redirects_to?: string | null;
}
export interface ComponentNode {
  id: string;
  screen: string;
  name: string;
  selector: string;
  text: string;
}
export interface CrawlResult {
  screens: ScreenRecord[];
  edges: NavEdge[];
  components: ComponentNode[];
  redirects: Record<string, string>;
  droppedEdges: number;
  stateNotes: string[];
  issues: IssueDef[];
  occurrences: IssueOccurrence[];
  sessionCookies: Record<string, string>;
}
