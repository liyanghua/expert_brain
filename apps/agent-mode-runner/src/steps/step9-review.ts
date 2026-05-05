import { metric } from "../observability/metrics.js";
import type { ExpertReview, PipelineState, StepMetric } from "../types.js";

export function runStep9Review(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  if (!state.score_delta) throw new Error("Step 9 requires score_delta");
  const review: ExpertReview = {
    overall_score: state.score_delta.net_quality_gain >= 0 ? 4 : 3.4,
    dimension_scores: {
      completeness: 4,
      accuracy: 3.8,
      clarity: 4,
      actionability: 4,
      traceability: 4,
    },
    comments: "Mock expert review for backend runner smoke. Replace with manual review JSON later.",
    accepted_final_version: state.score_delta.regressed_fields_count <= 2,
  };
  const feedback = {
    accepted: review.accepted_final_version,
    recommended_strategy_updates: [
      "继续优先补强低分字段",
      "保留 source refs 作为后续专家复核入口",
    ],
  };
  state.expert_review = review;
  return {
    artifacts: {
      expert_review: review,
      strategy_feedback: feedback,
    },
    metrics: {
      expert_overall_score: metric(review.overall_score, "proxy"),
      expert_acceptance_rate: metric(review.accepted_final_version ? 1 : 0, "proxy"),
      expert_override_rate: metric(0, "proxy"),
      metric_expert_correlation: metric(0.75, "pending_gold"),
      expert_score: metric(review.overall_score, "proxy"),
    },
  };
}
