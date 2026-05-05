import type { BlockRole, ContinuityDecisionTrace, DocumentBlock, SemanticSegment, SemanticUnit } from "../types.js";

export type ReviewTagStatus =
  | "covered"
  | "missing"
  | "weak"
  | "needs_confirmation"
  | "inferred";

export type ReviewFieldStatus =
  | "covered"
  | "missing"
  | "weak_source"
  | "needs_confirmation"
  | "inferred_candidate";

export type ReviewBlockTag = {
  block_id: string;
  field_key: string;
  label: string;
  status: ReviewTagStatus;
  sources: ("evidence_map" | "draft_source_refs" | "diagnostic")[];
  relation: "supporting_evidence";
};

export type ReviewSupportingFieldRef = {
  field_key: string;
  label: string;
  status: ReviewTagStatus;
  sources: ReviewBlockTag["sources"];
};

export type ReviewBlockAnnotation = {
  block_id: string;
  primary_role: BlockRole;
  primary_label: string;
  supporting_field_refs: ReviewSupportingFieldRef[];
  semantic_unit_id?: string;
  semantic_unit_summary?: string;
  semantic_unit_source_block_ids?: string[];
  continuity_reason?: string;
  unit_supporting_field_refs: ReviewSupportingFieldRef[];
  confidence: number;
  reason: string;
};

export type ReviewSchemaField = {
  field_key: string;
  label: string;
  required: boolean;
  critical: boolean;
  status: ReviewFieldStatus;
  source_block_ids: string[];
  semantic_unit_ids?: string[];
  semantic_segment_ids?: string[];
  item_count: number;
  source_count: number;
  reason: string;
  risk_reasons: string[];
  gap_priority?: string;
};

export type ReviewHint = {
  field_key: string;
  label: string;
  priority: "low" | "medium" | "high";
  why_it_matters: string;
  what_to_ask: string;
  recommended_structure: string;
  source_block_ids: string[];
  semantic_unit_ids?: string[];
  semantic_segment_ids?: string[];
  status: "todo" | "confirmed" | "ignored" | "not_applicable";
};

export type ReviewMetric = {
  key: string;
  label: string;
  value: number | string | boolean | null;
  status?: string;
};

export type ReviewFriendlyEvaluationItem = {
  key: string;
  label: string;
  value_text: string;
  explanation: string;
  action: string;
  status: "表现较好" | "建议关注" | "需要补充";
};

export type ReviewLlmCallObservability<ParsedResult = unknown> = {
  generated_at: string;
  provider: string;
  model: string;
  base_host?: string;
  prompt: {
    system: string;
    user: string;
  };
  raw_response: string;
  parsed_result: ParsedResult;
  prompt_chars: number;
  response_chars: number;
};

export type ReviewExpertSummaryParsedResult = {
  core_idea: string;
  method_spine: string[];
  strengths: string[];
  gaps: string[];
  expert_commentary: string;
};

export type ReviewExpertSummaryArtifact = {
  generated_at: string;
  provider: string;
  model: string;
  core_idea: string;
  method_spine: string[];
  strengths: string[];
  gaps: string[];
  expert_commentary: string;
  prompt_chars?: number;
  response_chars?: number;
  observability?: ReviewExpertSummaryObservability;
};

export type ReviewExpertSummaryObservability =
  ReviewLlmCallObservability<ReviewExpertSummaryParsedResult> & {
    parsed_summary: ReviewExpertSummaryParsedResult;
  };

export type ReviewOptimizationPatchType =
  | "add_missing_element"
  | "strengthen_method"
  | "clarify_metric"
  | "add_validation"
  | "improve_structure";

export type ReviewOptimizationPatch = {
  patch_id: string;
  title: string;
  patch_type: ReviewOptimizationPatchType;
  target_field_key: string;
  target_field_label: string;
  suggested_location: {
    block_id?: string;
    position: "after" | "before" | "replace" | "appendix";
  };
  draft_text: string;
  rationale: string;
  source_block_ids: string[];
  expected_improvement: string;
  status: "preview" | "needs_review";
};

export type ReviewOptimizationParsedResult = {
  goal: string;
  summary: string;
  patches: ReviewOptimizationPatch[];
};

export type ReviewOptimizationTodo = {
  todo_id: string;
  title: string;
  target_field_key: string;
  target_field_label: string;
  reason: string;
  recommended_structure: string;
  source_block_ids: string[];
  semantic_unit_id?: string;
  semantic_segment_id?: string;
  why_this_segment?: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "preview_generated" | "skipped";
};

export type ReviewOptimizationPlanArtifact = {
  generated_at: string;
  provider: string;
  model: string;
  goal: string;
  summary: string;
  todos: ReviewOptimizationTodo[];
  status: "planned" | "preview_ready" | "preview_failed";
  observability?: ReviewLlmCallObservability<ReviewOptimizationPlanParsedResult>;
};

export type ReviewOptimizationPlanParsedResult = {
  goal: string;
  summary: string;
  todos: ReviewOptimizationTodo[];
  status: ReviewOptimizationPlanArtifact["status"];
  fallback_used?: boolean;
  fallback_reason?: string;
  metrics?: {
    heading_only_plan_target_rate: number;
    segment_grounded_todo_rate: number;
    plan_actionability: number;
  };
};

export type ReviewOptimizationErrorArtifact = {
  generated_at: string;
  stage: "completion" | "parse" | "validation" | "preview_generation";
  message: string;
  provider?: string;
  model?: string;
  prompt_chars?: number;
  raw_response_preview?: string;
};

export type ReviewOptimizationArtifact = {
  generated_at: string;
  provider: string;
  model: string;
  goal: string;
  summary: string;
  patches: ReviewOptimizationPatch[];
  prompt_chars?: number;
  response_chars?: number;
  observability?: ReviewLlmCallObservability<ReviewOptimizationParsedResult>;
};

export type ReviewWorkbenchPayload = {
  run_id: string;
  run_dir: string;
  generated_at: string;
  artifact_source: "agent_mode_runner_step_0_4";
  document: {
    doc_id: string;
    version_id: string;
    blocks: DocumentBlock[];
  };
  document_summary: {
    document_theme: string;
    business_scene?: string;
    primary_goal?: string;
    core_idea: string;
    method_spine: string[];
    expert_commentary: string;
    review_focuses: string[];
    source_notes: string[];
    expert_summary_status: "deterministic" | "llm_generated";
    summary_for_agent: string;
    process_spine: string[];
    quality_risks: string[];
    likely_gaps: string[];
    source_block_ids: string[];
  };
  semantic_units?: SemanticUnit[];
  continuity_decision_trace?: ContinuityDecisionTrace;
  semantic_segments?: SemanticSegment[];
  block_tags: ReviewBlockTag[];
  block_annotations: ReviewBlockAnnotation[];
  schema_fields: ReviewSchemaField[];
  hints: ReviewHint[];
  evaluation: {
    metrics: ReviewMetric[];
  };
  friendly_evaluation: {
    items: ReviewFriendlyEvaluationItem[];
    debug_metrics: ReviewMetric[];
  };
  expert_summary_observability?: ReviewExpertSummaryObservability;
  one_click_optimization_plan?: ReviewOptimizationPlanArtifact;
  one_click_optimization_error?: ReviewOptimizationErrorArtifact;
  one_click_optimization?: ReviewOptimizationArtifact;
  one_click_optimization_observability?: ReviewLlmCallObservability<ReviewOptimizationParsedResult>;
};
