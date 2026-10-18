import { wcag } from '../checks/guidelines.js';
import type { GuidelineRef } from '../checks/types.js';
export const G = {
  noJsContent: {
    id: 'aeo:content-without-js',
    name: 'Key content and answers available without JavaScript',
    source: 'FlowLens',
    lens: 'AEO',
  },
  extractableTables: {
    id: 'aeo:extractable-tables',
    name: 'Extractable data tables',
    source: 'FlowLens',
    lens: 'AEO',
  },
  structuredDataAeo: {
    id: 'aeo:structured-data',
    name: 'Facts are machine-readable (structured data)',
    source: 'FlowLens',
    lens: 'AEO',
  },
  structuredDataSeo: {
    id: 'seo:product-structured-data',
    name: 'Product pages carry Product structured data',
    source: 'FlowLens',
    lens: 'SEO',
  },
  pageTitle: {
    id: 'seo:page-title',
    name: 'Every page has a unique, descriptive title',
    source: 'FlowLens',
    lens: 'SEO',
  },
  metaDescription: {
    id: 'seo:meta-description',
    name: 'Every page has a meta description',
    source: 'FlowLens',
    lens: 'SEO',
  },
  oneH1: {
    id: 'seo:one-h1',
    name: 'One main heading (h1) per page',
    source: 'FlowLens',
    lens: 'SEO',
  },
  sitemap: {
    id: 'seo:sitemap',
    name: 'The sitemap lists every page, and only pages that load',
    source: 'FlowLens',
    lens: 'SEO',
  },
  shallowDepth: {
    id: 'seo:shallow-click-depth',
    name: 'Shallow click depth',
    source: 'FlowLens',
    lens: 'SEO',
  },
  progressiveDisclosure: {
    id: 'ux:progressive-disclosure',
    name: 'Progressive disclosure',
    source: 'FlowLens',
    lens: 'UX',
  },
  limitChoices: {
    id: 'ux:limit-choices',
    name: 'Limit the choices on a page',
    source: 'FlowLens',
    lens: 'UX',
  },
  reflow: { ...wcag('1.4.10'), lens: 'UX' },
} satisfies Record<string, GuidelineRef>;
export const CONFLICTS: {
  from: GuidelineRef;
  to: GuidelineRef;
  reason: string;
}[] = [
  {
    from: G.extractableTables,
    to: G.reflow,
    reason:
      'A wide data table is easy for search and answer engines to extract, but on a phone it forces horizontal scrolling.',
  },
  {
    from: G.noJsContent,
    to: G.progressiveDisclosure,
    reason:
      'Showing answers only on interaction keeps a page short for people, but answers that load only through JavaScript are invisible to engines that do not run it.',
  },
  {
    from: G.shallowDepth,
    to: G.limitChoices,
    reason:
      'Linking many pages from one page keeps them shallow for crawlers, but every extra link is another choice for people to make.',
  },
];
