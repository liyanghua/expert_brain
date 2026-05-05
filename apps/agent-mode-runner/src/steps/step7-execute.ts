import { metric } from "../observability/metrics.js";
import { addDraftItem } from "../tools/field-extractor.js";
import type { PipelineState, StepMetric, StepOutput } from "../types.js";

export function runStep7Execute(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  if (!state.approved_agent_plan || !state.structured_draft_v0) {
    throw new Error("Step 7 requires approved_agent_plan and structured_draft_v0");
  }
  let draft = structuredClone(state.structured_draft_v0);
  const stepOutputs: StepOutput[] = [];
  const stepArtifacts: Record<string, unknown> = {};
  for (const step of state.approved_agent_plan.steps) {
    const content = `${step.title}：${step.rationale}`;
    const shouldMarkInferred =
      Boolean(
        step.target_field &&
          state.schema_profile?.inferred_candidate_fields.includes(step.target_field),
      ) ||
      Boolean(
        step.target_field &&
          state.expert_guidance_profile?.inference_boundaries.some((line) =>
            line.includes(step.target_field!),
          ),
      );
    if (step.target_field) {
      draft = addDraftItem(
        draft,
        step.target_field,
        content,
        step.evidence_block_ids,
        shouldMarkInferred ? "InferredCandidate" : "Drafted",
        shouldMarkInferred
          ? "来自 ExpertGuidanceProfile.inference_boundaries，需要专家确认"
          : undefined,
      );
    }
    const output: StepOutput = {
      step_id: step.step_id,
      status: "completed",
      changed_fields: step.target_field ? [step.target_field] : [],
      source_backed: step.evidence_block_ids.length > 0,
      inference_overreach: false,
      candidate_item: step.target_field
        ? {
            content,
            status: shouldMarkInferred ? "InferredCandidate" : "Drafted",
            confidence: step.evidence_block_ids.length > 0 ? 0.78 : 0.58,
            source_refs: step.evidence_block_ids.map((block_id) => ({ block_id })),
          }
        : undefined,
    };
    stepOutputs.push(output);
    stepArtifacts[`steps/${step.step_id}/step_input`] = step;
    stepArtifacts[`steps/${step.step_id}/step_output`] = output;
    stepArtifacts[`steps/${step.step_id}/step_diff`] = {
      changed_fields: output.changed_fields,
      before_version: "v0",
      after_version: "candidate_v1",
    };
  }
  state.structured_draft_candidate_v1 = draft;
  const sourceBacked = stepOutputs.filter((output) => output.source_backed).length;
  return {
    artifacts: {
      ...stepArtifacts,
      document_v_next: {
        doc_id: draft.doc_id,
        version_id: "candidate_v1",
        note: "Backend runner only updates structured draft in phase 1.",
      },
      structured_draft_candidate_v1: draft,
    },
    metrics: {
      step_completion_rate: metric(stepOutputs.length > 0 ? 1 : 0),
      step_failure_rate: metric(0),
      step_rework_rate: metric(0, "proxy"),
      source_backed_change_rate: metric(
        stepOutputs.length === 0 ? 0 : sourceBacked / stepOutputs.length,
      ),
      inference_overreach_rate: metric(0, "proxy"),
      changed_field_count: metric(
        new Set(stepOutputs.flatMap((output) => output.changed_fields)).size,
      ),
    },
  };
}
