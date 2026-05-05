import type { ThresholdRule } from "../types.js";

export type StepSpec = {
  step_id: string;
  name: string;
  metrics: Record<string, ThresholdRule>;
  artifacts: string[];
  tools: string[];
};

export const PIPELINE_SPEC_SOURCE = "docs/Agent_mode_pipeline.YAML";

export const STEP_SPECS: Record<string, StepSpec> = {
  step_0_scene_registration: {
    step_id: "step_0_scene_registration",
    name: "场景注册与配置注入",
    metrics: {
      scene_match_accuracy: { target: 0.95, minimum: 0.9 },
      profile_load_success_rate: { target: 1, minimum: 0.99 },
      wrong_profile_rate: { target_max: 0.02, hard_max: 0.05 },
    },
    artifacts: ["scene_binding.json"],
    tools: ["hyper_extract", "scene_registry", "profile_loader", "config_store"],
  },
  step_1_parse_normalize: {
    step_id: "step_1_parse_normalize",
    name: "文档解析与标准化",
    metrics: {
      parse_success_rate: { target: 0.99, minimum: 0.95 },
      block_integrity_rate: { target: 0.92, minimum: 0.85 },
      heading_preservation_rate: { target: 0.95, minimum: 0.9 },
      table_preservation_rate: { target: 0.9, minimum: 0.8 },
      source_span_completeness: { target: 0.98, minimum: 0.9 },
    },
    artifacts: ["document_ir.json"],
    tools: ["docling", "marker", "mineru", "builtin"],
  },
  step_2_hierarchical_understanding: {
    step_id: "step_2_hierarchical_understanding",
    name: "层级化文档理解",
    metrics: {
      section_summary_coverage: { target: 0.95, minimum: 0.85 },
      summary_faithfulness: { target: 0.9, minimum: 0.8 },
      summary_grounding_rate: { target: 0.9, minimum: 0.8 },
      theme_goal_accuracy: { target: 0.88, minimum: 0.75 },
      summary_compression_ratio: {},
    },
    artifacts: ["section_summaries.json", "document_understanding.json"],
    tools: [
      "section_first_summaries",
      "raptor_like_hierarchy",
      "contextual_retrieval_enhanced",
      "graphrag_hierarchy",
    ],
  },
  step_3_structured_extraction: {
    step_id: "step_3_structured_extraction",
    name: "结构化抽取",
    metrics: {
      field_coverage: { target: 0.8, minimum: 0.7 },
      field_accuracy: { target: 0.85, minimum: 0.75 },
      item_f1: { target: 0.8, minimum: 0.7 },
      source_grounding_rate: { target: 0.9, minimum: 0.8 },
      structural_consistency: { target: 0.9, minimum: 0.8 },
      gap_detection_accuracy: { target: 0.8, minimum: 0.7 },
      inference_handling_accuracy: { target: 0.9, minimum: 0.85 },
    },
    artifacts: ["structured_draft.v0.json", "gap_candidates.json"],
    tools: [
      "schema_guided_extraction",
      "prompt_only_extraction",
      "hyper_extract_style_template_extraction",
      "marker_schema_extraction",
    ],
  },
  step_4_initial_scoring: {
    step_id: "step_4_initial_scoring",
    name: "初始评分",
    metrics: {
      score_stability: { target: 0.9, minimum: 0.8 },
      metric_explainability: { target: 0.9, minimum: 0.8 },
      low_score_localization_accuracy: { target: 0.85, minimum: 0.75 },
    },
    artifacts: ["scorecard.v0.json"],
    tools: ["custom_scoring_engine", "langfuse", "phoenix"],
  },
  step_5_agent_plan_generation: {
    step_id: "step_5_agent_plan_generation",
    name: "生成 Agent Plan",
    metrics: {
      plan_coverage: { target: 0.9, minimum: 0.8 },
      plan_precision: { target: 0.85, minimum: 0.75 },
      plan_actionability: { target: 0.9, minimum: 0.8 },
      expected_score_gain_quality: {},
      plan_acceptance_rate: {},
    },
    artifacts: ["agent_plan.v0.json"],
    tools: ["langgraph", "hermes_style_runtime", "rule_based_planner"],
  },
  step_6_expert_approval: {
    step_id: "step_6_expert_approval",
    name: "专家确认",
    metrics: {
      plan_approval_rate: { target: 0.8, minimum: 0.6 },
      step_approval_rate: { target: 0.9, minimum: 0.75 },
      edit_before_approval_rate: {},
      rejection_reason_distribution: {},
    },
    artifacts: ["approval_log.json", "approved_agent_plan.json"],
    tools: ["langgraph_hitl_pattern", "json_approval"],
  },
  step_7_stepwise_improvement_run: {
    step_id: "step_7_stepwise_improvement_run",
    name: "分步执行补强",
    metrics: {
      step_completion_rate: { target: 0.9, minimum: 0.75 },
      step_failure_rate: { target_max: 0.1, hard_max: 0.2 },
      step_rework_rate: {},
      source_backed_change_rate: { target: 0.9, minimum: 0.8 },
      inference_overreach_rate: { target_max: 0.1, hard_max: 0.2 },
    },
    artifacts: [
      "step_input.json",
      "step_output.json",
      "step_diff.json",
      "document_v_next.json",
      "structured_draft_candidate_v1.json",
    ],
    tools: ["langgraph", "hermes_style_runtime", "single_shot_rewrite"],
  },
  step_8_reextract_rescore: {
    step_id: "step_8_reextract_rescore",
    name: "重抽取 + 重评分",
    metrics: {
      score_delta_by_metric: {},
      improved_fields_count: {},
      regressed_fields_count: { target_max: 0, hard_max: 2 },
      net_quality_gain: { target: "positive", minimum: "non_negative" },
    },
    artifacts: ["structured_draft.v1.json", "scorecard.v1.json", "score_delta.json"],
    tools: ["same_as_step_3", "custom_scoring_engine"],
  },
  step_9_expert_review_feedback: {
    step_id: "step_9_expert_review_feedback",
    name: "专家评分与策略回流",
    metrics: {
      expert_overall_score: { target: 4, minimum: 3.5 },
      expert_acceptance_rate: { target: 0.8, minimum: 0.6 },
      expert_override_rate: {},
      metric_expert_correlation: {},
    },
    artifacts: ["expert_review.json", "strategy_feedback.json"],
    tools: ["langfuse", "phoenix", "expert_review_form", "strategy_feedback_writer"],
  },
};

export const PIPELINE_STEP_ORDER = Object.keys(STEP_SPECS);

export function getStepSpec(stepId: string): StepSpec {
  const spec = STEP_SPECS[stepId];
  if (!spec) throw new Error(`Unknown pipeline step: ${stepId}`);
  return spec;
}
