import { metric } from "../observability/metrics.js";
import {
  buildScoreExplanation,
  computeFieldScoreDiagnostics,
  computeRunnerScorecard,
} from "../tools/scoring.js";
import type { PipelineState, StepMetric } from "../types.js";

export function runStep4Scorecard(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  if (!state.structured_draft_v0 || !state.document_ir) {
    throw new Error("Step 4 requires structured_draft_v0 and document_ir");
  }
  const started = Date.now();
  const fieldDiagnostics = computeFieldScoreDiagnostics({
    draft: state.structured_draft_v0,
    schemaProfile: state.schema_profile,
    evaluationProfile: state.evaluation_profile,
    schemaGuidedValidationReport: state.schema_guided_validation_report,
  });
  const scorecard = computeRunnerScorecard({
    draft: state.structured_draft_v0,
    ir: state.document_ir,
    schemaProfile: state.schema_profile,
    evaluationProfile: state.evaluation_profile,
    schemaGuidedValidationReport: state.schema_guided_validation_report,
    fieldDiagnostics,
  });
  state.scorecard_v0 = scorecard;
  state.field_score_diagnostics_v0 = fieldDiagnostics;
  const explanation = buildScoreExplanation({
    scorecard,
    fieldDiagnostics,
    evaluationProfile: state.evaluation_profile,
  });
  state.score_explanation_v0 = explanation;
  const failing = Object.values(scorecard.threshold_check ?? {}).filter(
    (status) => status === "fail",
  ).length;
  const failingFields = Object.values(fieldDiagnostics.fields).filter(
    (field) => field.validation_status === "fail",
  ).length;
  return {
    artifacts: {
      "scorecard.v0": scorecard,
      "score_explanation.v0": explanation,
      "field_score_diagnostics.v0": fieldDiagnostics,
    },
    metrics: {
      score_stability: metric(0.85, "proxy"),
      metric_explainability: metric(
        explanation.top_risk_fields.length > 0 ? 0.9 : 0.82,
        "proxy",
        "字段级风险已落到 score explanation",
      ),
      low_score_localization_accuracy: metric(
        explanation.top_risk_fields.length > 0 ? 0.84 : 0.76,
        "proxy",
      ),
      scoring_duration_ms: metric(Date.now() - started),
      failing_metric_count: metric(failing),
      failing_field_count: metric(failingFields),
    },
  };
}
