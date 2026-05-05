import { metric } from "../observability/metrics.js";
import { computeRunnerScorecard } from "../tools/scoring.js";
import { compareScorecards } from "../tools/score-delta.js";
import type { PipelineState, StepMetric } from "../types.js";

export function runStep8Rescore(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  if (!state.document_ir || !state.structured_draft_candidate_v1 || !state.scorecard_v0) {
    throw new Error("Step 8 requires document_ir, structured_draft_candidate_v1 and scorecard_v0");
  }
  const draftV1 = {
    ...state.structured_draft_candidate_v1,
    version_id: "v1",
  };
  const scorecardV1 = computeRunnerScorecard({
    draft: draftV1,
    ir: { ...state.document_ir, version_id: "v1" },
    schemaProfile: state.schema_profile,
    evaluationProfile: state.evaluation_profile,
    schemaGuidedValidationReport: state.schema_guided_validation_report,
  });
  const scoreDelta = compareScorecards(state.scorecard_v0, scorecardV1);
  state.structured_draft_v1 = draftV1;
  state.scorecard_v1 = scorecardV1;
  state.score_delta = scoreDelta;
  return {
    artifacts: {
      "structured_draft.v1": draftV1,
      "scorecard.v1": scorecardV1,
      score_delta: scoreDelta,
    },
    metrics: {
      score_delta_by_metric: metric(scoreDelta.net_quality_gain, "measured"),
      improved_fields_count: metric(scoreDelta.improved_fields_count),
      regressed_fields_count: metric(scoreDelta.regressed_fields_count),
      net_quality_gain: metric(scoreDelta.net_quality_gain),
      improved_metric_count: metric(scoreDelta.improved_fields_count),
      regressed_metric_count: metric(scoreDelta.regressed_fields_count),
    },
  };
}
