import { findingKey } from './store.js';
import type { FindingInput } from './types.js';
export function reconcileFindings(
  baseline: FindingInput[],
  modelFindings: FindingInput[],
): FindingInput[] {
  const matchedBaselineIndices = new Set<number>();
  const enrichedOrAiFindings: FindingInput[] = [];
  for (const mf of modelFindings) {
    const matchedIndices: number[] = [];
    for (let i = 0; i < baseline.length; i++) {
      const bf = baseline[i];
      let matches = false;
      if (mf.replaces_keys && mf.replaces_keys.includes(findingKey(bf))) {
        matches = true;
      } else if (mf.target.type === bf.target.type && mf.target.id === bf.target.id) {
        if (mf.rule_id && bf.rule_id) {
          matches = mf.rule_id === bf.rule_id;
        } else if (mf.category === bf.category) {
          matches = true;
        } else {
          matches = true;
        }
      } else if (
        mf.rule_id &&
        bf.rule_id &&
        mf.rule_id === bf.rule_id &&
        mf.category === bf.category
      ) {
        matches = true;
      }
      if (matches) {
        matchedIndices.push(i);
      }
    }
    if (matchedIndices.length > 0) {
      for (const idx of matchedIndices) {
        matchedBaselineIndices.add(idx);
      }
      const primaryBaseline = baseline[matchedIndices[0]];
      enrichedOrAiFindings.push({
        ...mf,
        rule_id: mf.rule_id ?? primaryBaseline.rule_id,
        issue_ids: mf.issue_ids ?? primaryBaseline.issue_ids,
        origin: 'ai-enriched',
      });
    } else {
      enrichedOrAiFindings.push({
        ...mf,
        origin: 'ai',
      });
    }
  }
  const keptBaselineFindings: FindingInput[] = [];
  for (let i = 0; i < baseline.length; i++) {
    if (!matchedBaselineIndices.has(i)) {
      keptBaselineFindings.push({
        ...baseline[i],
        origin: 'rules',
      });
    }
  }
  return [...enrichedOrAiFindings, ...keptBaselineFindings];
}
