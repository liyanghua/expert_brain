export type ToolProfile = {
  parse: string;
  understanding: string;
  extraction: string;
  planning: string;
  execution: string;
};

export const TOOL_PROFILES: Record<string, ToolProfile> = {
  builtin: {
    parse: "builtin",
    understanding: "section_first_summaries",
    extraction: "schema_guided_extraction",
    planning: "hybrid_scorecard_guided_plan",
    execution: "stepwise_targeted_rewrite",
  },
  baseline: {
    parse: "builtin",
    understanding: "section_first_summaries",
    extraction: "prompt_only_extraction",
    planning: "rule_based_plan",
    execution: "single_shot_rewrite",
  },
};

export const KNOWN_TOOLS = new Set([
  "builtin",
  "docling",
  "marker",
  "mineru",
  "section_first_summaries",
  "raptor_like_hierarchy",
  "contextual_retrieval_enhanced",
  "prompt_only_extraction",
  "schema_guided_extraction",
  "hyper_extract_style_template_extraction",
  "marker_schema_extraction",
  "rule_based_plan",
  "llm_only_plan",
  "hybrid_scorecard_guided_plan",
  "single_shot_rewrite",
  "stepwise_targeted_rewrite",
  "stepwise_targeted_rewrite_with_expert_checkpoints",
]);

export function resolveToolProfile(profileName = "builtin"): ToolProfile {
  return TOOL_PROFILES[profileName] ?? TOOL_PROFILES.builtin!;
}
