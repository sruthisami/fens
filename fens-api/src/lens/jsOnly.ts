export const JS_ONLY = { ratio: 0.5, minText: 300, rawStatus: 200 } as const;
export function jsOnlyPredicate(s: string): string {
  return `${s}.raw_status = ${JS_ONLY.rawStatus} AND ${s}.rendered_text_length >= ${JS_ONLY.minText} AND coalesce(${s}.robots_disallowed, false) = false AND ${s}.js_only_ratio > ${JS_ONLY.ratio}`;
}
