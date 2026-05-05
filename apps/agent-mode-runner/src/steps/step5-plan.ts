import { baselinePlannerAdapter } from "../planning/baseline-planner.js";
import { createLlmPlannerAdapter } from "../planning/llm-planner.js";
import type { PlannerAdapter } from "../planning/planner-adapter.js";
import type { PipelineState, PlannerProfile, StepMetric } from "../types.js";

const PLANNER_ADAPTERS: Record<PlannerProfile, PlannerAdapter> = {
  baseline: baselinePlannerAdapter,
  deepseek: createLlmPlannerAdapter("deepseek"),
  qwen_plus: createLlmPlannerAdapter("qwen_plus"),
};

export async function runStep5Plan(state: PipelineState): Promise<{
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
}> {
  if (!state.section_cards || !state.document_ir || !state.scorecard_v0 || !state.structured_draft_v0) {
    throw new Error("Step 5 requires section_cards, document_ir, structured_draft_v0 and scorecard_v0");
  }
  const profile = state.planner_profile ?? "baseline";
  const result = await PLANNER_ADAPTERS[profile].plan({
    plannerProfile: profile,
    ir: state.document_ir,
    sectionCards: state.section_cards,
    draft: state.structured_draft_v0,
    scorecard: state.scorecard_v0,
    documentUnderstanding: state.document_understanding,
    schemaProfile: state.schema_profile,
    expertGuidanceProfile: state.expert_guidance_profile,
    evaluationProfile: state.evaluation_profile,
    fieldDiagnostics: state.field_score_diagnostics_v0,
    scoreExplanation: state.score_explanation_v0,
  });
  state.agent_plan_v0 = result.plan;
  state.agent_plan_generation_trace = result.extraArtifacts?.agent_plan_generation_trace;
  return {
    artifacts: {
      "agent_plan.v0": result.plan,
      "coverage.step5": result.coverage,
      ...(result.extraArtifacts ?? {}),
    },
    metrics: result.metrics,
  };
}
