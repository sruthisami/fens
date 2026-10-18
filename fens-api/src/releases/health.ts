export const HEALTH_WEIGHTS = {
  serious: 10,
  critical: 10,
  moderate: 5,
  minor: 2,
  orphan: 5,
  deadEnd: 5,
  extraClick: 2,
} as const;
export interface HealthInput {
  issuesBySeverity: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  orphans: number;
  deadEnds: number;
  extraClicks: number;
}
export interface HealthBreakdown {
  label: string;
  count: number;
  points: number;
}
export function healthScore(input: HealthInput): {
  score: number;
  breakdown: HealthBreakdown[];
} {
  const s = input.issuesBySeverity;
  const breakdown: HealthBreakdown[] = [
    {
      label: 'serious or critical UX issues',
      count: s.serious + s.critical,
      points: (s.serious + s.critical) * HEALTH_WEIGHTS.serious,
    },
    {
      label: 'moderate UX issues',
      count: s.moderate,
      points: s.moderate * HEALTH_WEIGHTS.moderate,
    },
    { label: 'minor UX issues', count: s.minor, points: s.minor * HEALTH_WEIGHTS.minor },
    {
      label: 'orphan screens',
      count: input.orphans,
      points: input.orphans * HEALTH_WEIGHTS.orphan,
    },
    {
      label: 'dead-end screens',
      count: input.deadEnds,
      points: input.deadEnds * HEALTH_WEIGHTS.deadEnd,
    },
    {
      label: 'forced clicks above shortest path',
      count: input.extraClicks,
      points: input.extraClicks * HEALTH_WEIGHTS.extraClick,
    },
  ];
  const lost = breakdown.reduce((n, b) => n + b.points, 0);
  return { score: Math.max(0, 100 - lost), breakdown };
}
