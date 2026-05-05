import type { ExtractionScorecard, ScoreDelta } from "../types.js";

export function compareScorecards(
  before: ExtractionScorecard,
  after: ExtractionScorecard,
): ScoreDelta {
  const keys = new Set([
    ...Object.keys(before.scores),
    ...Object.keys(after.scores),
  ]);
  const delta: Record<string, number | null> = {};
  let improved = 0;
  let regressed = 0;
  let net = 0;
  for (const key of keys) {
    const a = before.scores[key as keyof typeof before.scores];
    const b = after.scores[key as keyof typeof after.scores];
    if (typeof a !== "number" || typeof b !== "number") {
      delta[key] = null;
      continue;
    }
    const diff = Number((b - a).toFixed(4));
    delta[key] = diff;
    net += diff;
    if (diff > 0) improved += 1;
    if (diff < 0) regressed += 1;
  }
  return {
    score_delta_by_metric: delta,
    improved_fields_count: improved,
    regressed_fields_count: regressed,
    net_quality_gain: Number(net.toFixed(4)),
  };
}
