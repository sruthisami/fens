import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../config/env.js';
export interface DiffLike {
  from: string;
  to: string;
  health: {
    from: {
      score: number;
    };
    to: {
      score: number;
    };
    delta: number;
  };
  metrics: {
    orphans: {
      from: number;
      to: number;
      delta: number;
    };
    deadEnds: {
      from: number;
      to: number;
      delta: number;
    };
    forcedClicks: {
      from: number;
      to: number;
      delta: number;
    };
  };
  issues: {
    fixed: {
      key: string;
      help: string;
      rule_id: string;
      severity: string;
      screens: string[];
    }[];
    new: {
      key: string;
      help: string;
      rule_id: string;
      severity: string;
      screens: string[];
    }[];
    unchanged: {
      key: string;
      help: string;
      rule_id: string;
      severity_to: string;
    }[];
  };
  findings: {
    resolved: {
      key: string;
      title: string;
    }[];
    new: {
      key: string;
      title: string;
    }[];
    persisting: {
      key: string;
      title: string;
      severity_to: string;
    }[];
  };
}
export interface ComparisonItem {
  text: string;
  cite: string;
}
export interface Comparison {
  from: string;
  to: string;
  health: {
    from: number;
    to: number;
    delta: number;
  };
  improved: ComparisonItem[];
  regressed: ComparisonItem[];
  persisting: ComparisonItem[];
  source: 'rules' | 'ai';
  note?: string;
}
export function comparisonFromTemplates(d: DiffLike): Comparison {
  const improved: ComparisonItem[] = [];
  const regressed: ComparisonItem[] = [];
  const persisting: ComparisonItem[] = [];
  for (const i of d.issues.fixed) {
    improved.push({
      text: `Fixed ${i.severity} ${i.rule_id}: ${i.help} (${i.screens.length} screen${i.screens.length === 1 ? '' : 's'} before).`,
      cite: `issues.fixed[${i.key}]`,
    });
  }
  for (const f of d.findings.resolved) {
    improved.push({ text: `Resolved finding: ${f.title}.`, cite: `findings.resolved[${f.key}]` });
  }
  if (d.metrics.forcedClicks.delta < 0) {
    improved.push({
      text: `Main journeys got shorter: forced clicks ${d.metrics.forcedClicks.from} → ${d.metrics.forcedClicks.to}.`,
      cite: 'metrics.forcedClicks',
    });
  }
  if (d.metrics.orphans.delta < 0) {
    improved.push({
      text: `Orphan screens ${d.metrics.orphans.from} → ${d.metrics.orphans.to}.`,
      cite: 'metrics.orphans',
    });
  }
  if (d.metrics.deadEnds.delta < 0) {
    improved.push({
      text: `Dead-end screens ${d.metrics.deadEnds.from} → ${d.metrics.deadEnds.to}.`,
      cite: 'metrics.deadEnds',
    });
  }
  for (const i of d.issues.new) {
    regressed.push({
      text: `New ${i.severity} ${i.rule_id}: ${i.help} on ${i.screens.length} screen${i.screens.length === 1 ? '' : 's'}.`,
      cite: `issues.new[${i.key}]`,
    });
  }
  for (const f of d.findings.new) {
    regressed.push({ text: `New finding: ${f.title}.`, cite: `findings.new[${f.key}]` });
  }
  if (d.metrics.forcedClicks.delta > 0) {
    regressed.push({
      text: `Main journeys got longer: forced clicks ${d.metrics.forcedClicks.from} → ${d.metrics.forcedClicks.to}.`,
      cite: 'metrics.forcedClicks',
    });
  }
  for (const i of d.issues.unchanged) {
    persisting.push({
      text: `Still present (${i.severity_to}): ${i.help} (${i.rule_id}).`,
      cite: `issues.unchanged[${i.key}]`,
    });
  }
  for (const f of d.findings.persisting) {
    persisting.push({
      text: `Still a finding (${f.severity_to}): ${f.title}.`,
      cite: `findings.persisting[${f.key}]`,
    });
  }
  return {
    from: d.from,
    to: d.to,
    health: { from: d.health.from.score, to: d.health.to.score, delta: d.health.delta },
    improved,
    regressed,
    persisting,
    source: 'rules',
  };
}
const modelSchema = z.object({
  improved: z
    .array(z.object({ text: z.string().min(3).max(400), cite: z.string().min(1).max(200) }))
    .max(12),
  regressed: z
    .array(z.object({ text: z.string().min(3).max(400), cite: z.string().min(1).max(200) }))
    .max(12),
  persisting: z
    .array(z.object({ text: z.string().min(3).max(400), cite: z.string().min(1).max(200) }))
    .max(12),
});
export async function comparisonFromModel(
  d: DiffLike,
  note: (m: string) => void,
): Promise<Comparison> {
  const template = comparisonFromTemplates(d);
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) {
    return {
      ...template,
      note: 'AI summary not available (GEMINI_API_KEY or GEMINI_MODEL is not set); showing the rule-based summary.',
    };
  }
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const prompt = `Summarise how the app changed between two releases, using only this diff JSON.
Return JSON with three lists: "improved", "regressed" and "persisting". Each item is { "text": short plain sentence, "cite": the diff field it rests on, e.g. "issues.fixed[<key>]" or "metrics.forcedClicks" }. Use only facts in the diff. No invented screens or numbers.

${JSON.stringify(d).slice(0, 12000)}`;
  try {
    const response = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } },
      },
    });
    const { comparison, dropped } = parseModelAnswer(d, response.text ?? '{}');
    if (dropped > 0) note(`Dropped ${dropped} summary item(s) whose citation is not in the diff.`);
    return comparison;
  } catch (err) {
    note(
      `AI summary failed (${(err as Error).message.slice(0, 120)}); showing the rule-based summary.`,
    );
    return { ...template, note: 'AI summary unavailable; showing the rule-based summary.' };
  }
}
export function parseModelAnswer(
  d: DiffLike,
  text: string,
): {
  comparison: Comparison;
  dropped: number;
} {
  const template = comparisonFromTemplates(d);
  const parsed = modelSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error('the model answer did not match the summary format');
  const keep = (items: ComparisonItem[]) => items.filter((i) => citationExists(d, i.cite));
  const all = [...parsed.data.improved, ...parsed.data.regressed, ...parsed.data.persisting];
  const dropped = all.filter((i) => !citationExists(d, i.cite)).length;
  return {
    comparison: {
      from: d.from,
      to: d.to,
      health: template.health,
      improved: keep(parsed.data.improved),
      regressed: keep(parsed.data.regressed),
      persisting: keep(parsed.data.persisting),
      source: 'ai',
    },
    dropped,
  };
}
export function citationExists(d: DiffLike, cite: string): boolean {
  const m = /^(issues|findings)\.(fixed|new|unchanged|resolved|persisting)(?:\[(.+)\])?$/.exec(
    cite,
  );
  if (m) {
    const list =
      (
        d as unknown as Record<
          string,
          Record<
            string,
            {
              key: string;
            }[]
          >
        >
      )[m[1] ?? '']?.[m[2] ?? ''] ?? [];
    return m[3] === undefined ? true : list.some((x) => x.key === m[3]);
  }
  if (cite === 'metrics.forcedClicks' || cite === 'metrics.orphans' || cite === 'metrics.deadEnds')
    return true;
  return false;
}
