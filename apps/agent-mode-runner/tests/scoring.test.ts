import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildScoreExplanation,
  computeFieldScoreDiagnostics,
  computeRunnerScorecard,
} from "../src/tools/scoring.js";
import type {
  DocumentIR,
  EvaluationProfile,
  GroundTruthDraft,
  SchemaGuidedValidationReport,
  SchemaProfile,
} from "../src/types.js";

const ir: DocumentIR = {
  doc_id: "score-test",
  version_id: "v0",
  blocks: [
    {
      block_id: "b1",
      block_type: "paragraph",
      text_content: "点击率低于行业均值，需要复盘点击率。",
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

const schemaProfile: SchemaProfile = {
  profile_id: "schema.score.test",
  version: "v1",
  required_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
  optional_fields: [],
  inferred_candidate_fields: [],
  field_definitions: {},
  normalization_rules: [],
  output_requirements: [],
};

const evaluationProfile: EvaluationProfile = {
  profile_id: "eval.score.test",
  version: "v1",
  metrics: [],
  metric_thresholds: {
    field_coverage: { target: 0.8, minimum: 0.7 },
    source_grounding_rate: { target: 0.9, minimum: 0.8 },
    structural_consistency: { target: 0.9, minimum: 0.8 },
    gap_detection_accuracy: { target: 0.8, minimum: 0.7 },
    inference_handling_accuracy: { target: 0.9, minimum: 0.85 },
  },
  field_weights: {
    judgment_basis: 1,
    judgment_criteria: 2,
    validation_methods: 1,
  },
  critical_fields: ["judgment_criteria", "validation_methods"],
  list_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
  single_fields: [],
  hard_gates: [],
  gap_priority_rules: [
    {
      priority: "P1",
      field_key: "judgment_criteria",
      reason: "判断标准缺失会直接削弱可执行性",
    },
  ],
};

const draft: GroundTruthDraft = {
  schema_name: "BusinessDocStructuredDraft",
  schema_version: "v1",
  doc_id: "score-test",
  version_id: "v0",
  required_inputs: [],
  deliverables: [],
  thinking_framework: [],
  execution_steps: [],
  execution_actions: [],
  key_node_rationales: [],
  page_screenshots: [],
  faq_types: [],
  judgment_basis: [
    {
      content: "点击率",
      status: "Drafted",
      confidence: 0.88,
      source_refs: [{ block_id: "b1" }],
    },
  ],
  judgment_criteria: [],
  resolution_methods: [],
  trigger_conditions: [],
  termination_conditions: [],
  validation_methods: [
    {
      content: "复盘点击率",
      status: "Drafted",
      confidence: 0.88,
      source_refs: [{ block_id: "b1" }],
    },
  ],
  tool_templates: [],
  exceptions_and_non_applicable_scope: [],
  gaps_structured: {
    missing_fields: [{ field_key: "judgment_criteria", message: "missing" }],
    weak_fields: [],
    inferred_fields: [],
    needs_confirmation_fields: [],
  },
  gaps: [],
  confidence_by_field: {
    judgment_basis: 0.88,
    validation_methods: 0.88,
  },
  source_refs: {
    judgment_basis: [{ block_id: "b1" }],
    validation_methods: [{ block_id: "b1" }],
  },
};

const validationReport: SchemaGuidedValidationReport = {
  extraction_profile: "schema_guided",
  typed_validation_pass_rate: 0.6667,
  source_backed_item_rate: 1,
  inferred_field_count: 0,
  gap_count: 1,
  table_row_extraction_count: 0,
  fields: {
    judgment_basis: { status: "pass", messages: [], item_count: 1, source_ref_count: 1 },
    judgment_criteria: {
      status: "fail",
      messages: ["required field has no grounded extraction"],
      item_count: 0,
      source_ref_count: 0,
    },
    validation_methods: { status: "pass", messages: [], item_count: 1, source_ref_count: 1 },
  },
};

describe("scorecard engine", () => {
  it("uses schema-guided validation report for weighted coverage and field diagnostics", () => {
    const diagnostics = computeFieldScoreDiagnostics({
      draft,
      schemaProfile,
      evaluationProfile,
      schemaGuidedValidationReport: validationReport,
    });
    const scorecard = computeRunnerScorecard({
      draft,
      ir,
      schemaProfile,
      evaluationProfile,
      schemaGuidedValidationReport: validationReport,
      fieldDiagnostics: diagnostics,
    });
    const explanation = buildScoreExplanation({
      scorecard,
      fieldDiagnostics: diagnostics,
      evaluationProfile,
    });

    assert.equal(scorecard.scores.raw_field_coverage, 0.6667);
    assert.equal(scorecard.scores.field_coverage, 0.5);
    assert.equal(scorecard.scores.source_grounding_rate, 1);
    assert.equal(scorecard.threshold_check?.field_coverage, "fail");
    assert.equal(diagnostics.fields.judgment_criteria?.gap_priority, "P1");
    assert.ok(diagnostics.fields.judgment_criteria?.risk_reasons.includes("required field is empty"));
    assert.equal(explanation.top_risk_fields[0]?.field_key, "judgment_criteria");
    assert.equal(explanation.recommended_plan_targets[0]?.target_field, "judgment_criteria");
  });
});
