export interface SeoSnapshot {
  raw_status: number;
  raw_text_length: number;
  rendered_text_length: number;
  text: string;
  js_only_ratio: number;
  meta_description: string | null;
  h1_count: number;
  canonical: string | null;
  jsonld_types: string[];
  has_table: boolean;
  mobile_overflow: boolean;
  overflow: {
    selector: string;
    html: string;
    component: string | null;
    width: number;
  } | null;
  product_like: boolean;
}
export interface LighthouseResult {
  lcp_ms: number | null;
  cls: number | null;
  failed: {
    id: string;
    title: string;
    description: string;
    category: 'seo' | 'performance';
    score: number;
    displayValue: string;
  }[];
}
export interface SitemapEntry {
  url: string;
  path: string | null;
  status: number;
  location: string | null;
}
