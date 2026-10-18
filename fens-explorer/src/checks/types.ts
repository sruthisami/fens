export type Severity = 'minor' | 'moderate' | 'serious' | 'critical';
export type IssueSource = 'axe' | 'flowlens' | 'lighthouse';
export type Lens = 'UX' | 'SEO' | 'AEO';
export interface GuidelineRef {
  id: string;
  name: string;
  source: string;
  lens?: Lens;
}
export interface CheckNode {
  selector: string;
  html: string;
  component: string | null;
}
export interface CheckFinding {
  source: IssueSource;
  ruleId: string;
  severity: Severity;
  help: string;
  description: string;
  helpUrl: string;
  guidelines: GuidelineRef[];
  nodes: CheckNode[];
}
