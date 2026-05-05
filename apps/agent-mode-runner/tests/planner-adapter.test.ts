import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { baselinePlannerAdapter } from "../src/planning/baseline-planner.js";
import { createLlmPlannerAdapter } from "../src/planning/llm-planner.js";
import { parseKeyConfig, resolvePlannerProviderConfig } from "../src/tools/key-config.js";
import type {
  DocumentIR,
  EvaluationProfile,
  ExtractionScorecard,
  FieldScoreDiagnostics,
  GroundTruthDraft,
  PlannerProfile,
  SchemaProfile,
  ScoreExplanation,
  SectionCard,
} from "../src/types.js";

const ir: DocumentIR = {
  doc_id: "planner-test",
  version_id: "v0",
  blocks: [
    {
      block_id: "b1",
      block_type: "paragraph",
      text_content: "需要补充商品页面截图证据，并说明截图如何支撑判断。",
      heading_level: 0,
      source_file: "sample.md",
      source_span: "L1",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    },
  ],
};

const sectionCards: SectionCard[] = [
  {
    section_id: "s1",
    title: "证据补强",
    summary: "说明页面截图和判断证据。",
    source_block_ids: ["b1"],
    key_signals: ["页面截图", "判断证据"],
    covered_schema_fields: ["page_screenshots", "judgment_basis"],
    likely_gaps: ["page_screenshots"],
    confidence: 0.9,
  },
];

const draft: GroundTruthDraft = {
  schema_name: "BusinessDocStructuredDraft",
  schema_version: "v1",
  doc_id: "planner-test",
  version_id: "v0",
  required_inputs: [],
  deliverables: [],
  thinking_framework: [],
  execution_steps: [],
  execution_actions: [],
  key_node_rationales: [],
  page_screenshots: [],
  faq_types: [],
  judgment_basis: [],
  judgment_criteria: [],
  resolution_methods: [],
  trigger_conditions: [],
  termination_conditions: [],
  validation_methods: [],
  tool_templates: [],
  exceptions_and_non_applicable_scope: [],
  gaps: [],
  confidence_by_field: {},
  source_refs: {},
};

const schemaProfile: SchemaProfile = {
  profile_id: "schema.planner.test",
  version: "v1",
  required_fields: ["judgment_basis"],
  optional_fields: ["page_screenshots"],
  inferred_candidate_fields: [],
  field_definitions: {},
  normalization_rules: [],
  output_requirements: [],
};

const evaluationProfile: EvaluationProfile = {
  profile_id: "eval.planner.test",
  version: "v1",
  metrics: [],
  metric_thresholds: {},
  field_weights: {},
  critical_fields: ["judgment_basis"],
  list_fields: ["judgment_basis", "page_screenshots"],
  single_fields: [],
  hard_gates: [],
  gap_priority_rules: [],
};

const scorecard: ExtractionScorecard = {
  document_id: "planner-test",
  version_id: "v0",
  mode: "heuristic",
  scores: { field_coverage: 0.5 },
  threshold_check: { field_coverage: "warn" },
  overall_status: "needs_improvement",
};

const fieldDiagnostics: FieldScoreDiagnostics = {
  scoring_profile: "schema_guided",
  raw_field_coverage: 0.5,
  weighted_field_coverage: 0.5,
  fields: {
    page_screenshots: {
      field_key: "page_screenshots",
      filled: false,
      required: false,
      critical: false,
      field_weight: 1,
      validation_status: "fail",
      item_count: 0,
      source_ref_count: 0,
      risk_reasons: ["optional field has no grounded extraction"],
    },
  },
};

const scoreExplanation: ScoreExplanation = {
  below_threshold_metrics: scorecard.threshold_check,
  overall_status: "needs_improvement",
  evaluation_profile_id: "eval.planner.test",
  metric_thresholds: {},
  top_risk_fields: [
    {
      field_key: "page_screenshots",
      risk_reasons: ["optional field has no grounded extraction"],
    },
  ],
  field_level_reasons: {
    page_screenshots: ["optional field has no grounded extraction"],
  },
  recommended_plan_targets: [
    {
      target_field: "page_screenshots",
      rationale: "optional field has no grounded extraction",
    },
  ],
};

const baseInput = {
  plannerProfile: "baseline" as PlannerProfile,
  ir,
  sectionCards,
  draft,
  scorecard,
  schemaProfile,
  evaluationProfile,
  fieldDiagnostics,
  scoreExplanation,
};

describe("planner adapters", () => {
  it("uses Step 4 recommended plan targets before fallback missing fields", async () => {
    const result = await baselinePlannerAdapter.plan(baseInput);

    assert.equal(result.plan.steps[0]?.target_field, "page_screenshots");
    assert.ok(result.plan.steps[0]?.rationale.includes("optional field has no grounded extraction"));
    assert.equal(result.coverage.top_risk_fields_covered_rate, 1);
  });

  it("generates a validated DeepSeek planner plan through a mock completion", async () => {
    const adapter = createLlmPlannerAdapter("deepseek", async () =>
      JSON.stringify({
        plan_id: "mock-plan",
        goal: "补强页面截图证据",
        steps: [
          {
            step_id: "plan_step_1",
            title: "补充页面截图证据",
            target_metric: "field_coverage",
            target_field: "page_screenshots",
            rationale: "当前截图证据缺失，需要让专家补齐页面截图或截图说明。",
            evidence_block_ids: ["b1"],
            action_type: "add_missing_field",
            expected_output: "补充页面截图证据及其判断作用。",
            status: "pending",
          },
        ],
        expected_improvement: { field_coverage: 0.1 },
        status: "draft",
      }),
    );

    const result = await adapter.plan({ ...baseInput, plannerProfile: "deepseek" });

    assert.equal(result.plan.steps[0]?.target_field, "page_screenshots");
    const trace = result.extraArtifacts?.agent_plan_generation_trace;
    assert.ok(trace);
    assert.equal(trace.planner_provider, "deepseek");
    assert.equal(trace.fallback_reason, undefined);
  });

  it("falls back to baseline when Qwen-plus returns invalid JSON", async () => {
    const adapter = createLlmPlannerAdapter("qwen_plus", async () => "not-json");
    const result = await adapter.plan({ ...baseInput, plannerProfile: "qwen_plus" });

    assert.equal(result.plan.steps[0]?.target_field, "page_screenshots");
    const trace = result.extraArtifacts?.agent_plan_generation_trace;
    assert.ok(trace);
    assert.equal(trace.planner_provider, "qwen_plus");
    assert.match(trace.fallback_reason ?? "", /Invalid JSON/);
  });
});

describe("key_config loader", () => {
  it("parses duplicate keys with later values winning and redacts secrets in summaries", () => {
    const parsed = parseKeyConfig(
      [
        "# comment",
        "DASHSCOPE_API_KEY=old-secret",
        "DASHSCOPE_MODEL=qwen-plus",
        "DASHSCOPE_API_KEY=new-secret",
        "DEEPSEEK_BASE_URL=https://api.deepseek.com",
      ].join("\n"),
    );
    const config = resolvePlannerProviderConfig({
      provider: "qwen_plus",
      keyConfig: parsed,
      env: {},
    });

    assert.equal(config.model, "qwen-plus");
    assert.equal(config.apiKey, "new-secret");
    assert.equal(config.safeSummary.hasApiKey, true);
    assert.equal(JSON.stringify(config.safeSummary).includes("new-secret"), false);
  });
});
