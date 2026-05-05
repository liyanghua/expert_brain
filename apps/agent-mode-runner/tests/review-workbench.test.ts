import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildReviewWorkbench } from "../src/review/build-review-workbench.js";

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

describe("review workbench builder", () => {
  it("builds a first-pass review payload from Step 0-4 artifacts", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-review-workbench-"));
    writeJson(join(runDir, "run_summary.json"), {
      run_id: "run-review",
      scene_name: "商品诊断",
    });
    writeJson(join(runDir, "document_ir.json"), {
      doc_id: "doc-review",
      version_id: "v0",
      blocks: [
        {
          block_id: "b1",
          block_type: "heading",
          text_content: "商品诊断流程说明",
          heading_level: 1,
          source_file: "source.md",
          source_span: "L1",
          attachment_refs: [],
          children_block_ids: [],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "点击率下降时需要判断入口吸引力和流量质量。",
          heading_level: 0,
          source_file: "source.md",
          source_span: "L2",
          attachment_refs: [],
          children_block_ids: [],
        },
        {
          block_id: "b3",
          block_type: "table",
          text_content: "| 指标 | 判断 |\n| --- | --- |\n| 点击率下降 | 需要阈值 |",
          heading_level: 0,
          source_file: "source.md",
          source_span: "L3",
          attachment_refs: [],
          children_block_ids: [],
        },
      ],
    });
    writeJson(join(runDir, "document_synthesis.json"), {
      document_theme: "商品诊断流程说明",
      business_scene: "商品诊断",
      primary_goal: "定位点击率下降原因",
      process_spine: [{ section_id: "s1", role: "diagnosis" }],
      key_signals: ["点击率下降"],
      likely_gaps: ["缺少判断标准"],
      quality_risks: ["判断标准不可复现"],
      summary_for_agent: "文档说明了诊断方向，但缺少明确判断阈值。",
      confidence: 0.82,
    });
    writeJson(join(runDir, "structured_draft.v0.json"), {
      doc_id: "doc-review",
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
          content: "点击率下降",
          status: "Drafted",
          confidence: 0.9,
          source_refs: [{ block_id: "b2" }],
        },
      ],
      judgment_criteria: [],
      resolution_methods: [],
      trigger_conditions: [],
      termination_conditions: [],
      validation_methods: [],
      tool_templates: [],
      exceptions_and_non_applicable_scope: [],
      gaps_structured: {
        missing_fields: [{ field_key: "judgment_criteria", message: "schema_guided 未找到 source-grounded 证据" }],
        weak_fields: [],
        inferred_fields: [],
        needs_confirmation_fields: [],
      },
      gaps: [{ field_key: "internal_gap", severity: "medium", message: "internal gap should not become a user field" }],
      confidence_by_field: {},
      source_refs: {},
    });
    writeJson(join(runDir, "block_role_map.json"), {
      understanding_profile: "structured_context",
      blocks: {
        b1: {
          block_id: "b1",
          primary_role: "business_definition",
          primary_label: "业务定义",
          secondary_roles: [],
          compatible_fields: ["business_scenario"],
          excluded_primary_fields: [],
          confidence: 0.82,
          reason: "heading defines the business scene",
        },
        b2: {
          block_id: "b2",
          primary_role: "metric_basis",
          primary_label: "指标依据",
          secondary_roles: [],
          compatible_fields: ["judgment_basis"],
          excluded_primary_fields: [],
          confidence: 0.86,
          reason: "paragraph includes diagnostic metric signal",
        },
        b3: {
          block_id: "b3",
          primary_role: "validation_rule",
          primary_label: "判断/验证规则",
          secondary_roles: ["metric_basis"],
          compatible_fields: ["judgment_criteria", "judgment_basis"],
          excluded_primary_fields: [],
          confidence: 0.9,
          reason: "table includes metric and rule columns",
        },
      },
    });
    writeJson(join(runDir, "schema_guided_evidence_map.json"), {
      extraction_profile: "schema_guided",
      fields: {
        judgment_basis: {
          field: "judgment_basis",
          candidate_block_ids: ["b2"],
          selected_block_ids: ["b2"],
          semantic_unit_ids: ["unit_judgment"],
          signals: ["点击率下降"],
          source_grounded: true,
          table_backed: false,
          selection_reason: "paragraph evidence",
        },
        judgment_criteria: {
          field: "judgment_criteria",
          candidate_block_ids: ["b3"],
          selected_block_ids: ["b3"],
          semantic_unit_ids: ["unit_judgment"],
          signals: ["需要阈值"],
          source_grounded: false,
          table_backed: true,
          selection_reason: "table suggests missing criteria",
        },
      },
    });
    writeJson(join(runDir, "semantic_units.v0.json"), {
      understanding_profile: "structured_context",
      semantic_coherence_profile: "rules",
      units: [
        {
          unit_id: "unit_judgment",
          source_block_ids: ["b2", "b3"],
          anchor_block_id: "b2",
          semantic_text:
            "点击率下降时需要判断入口吸引力和流量质量。\n| 指标 | 判断 |\n| --- | --- |\n| 点击率下降 | 需要阈值 |",
          summary: "这组段落共同说明点击率下降判断依据和待补充的判断标准。",
          continuity_edges: [
            {
              from_block_id: "b2",
              to_block_id: "b3",
              relation: "elaboration",
              signals: ["field_overlap"],
              confidence: 0.72,
            },
          ],
          related_schema_fields: ["judgment_basis"],
          missing_or_weak_fields: ["judgment_criteria"],
          confidence: 0.9,
        },
      ],
    });
    writeJson(join(runDir, "continuity_decision_trace.json"), {
      semantic_coherence_profile: "rules",
      decisions: [
        {
          from_block_id: "b2",
          to_block_id: "b3",
          relation: "elaboration",
          signals: ["field_overlap"],
          confidence: 0.72,
          should_merge: true,
          rule_score: 0.72,
          final_score: 0.72,
          merge_reason: "相邻段落共同说明点击率判断依据和判断标准",
        },
      ],
    });
    writeJson(join(runDir, "schema_guided_validation_report.json"), {
      extraction_profile: "schema_guided",
      typed_validation_pass_rate: 0.5,
      source_backed_item_rate: 1,
      inferred_field_count: 0,
      gap_count: 1,
      table_row_extraction_count: 1,
      fields: {
        judgment_basis: { status: "pass", messages: [], item_count: 1, source_ref_count: 1 },
        judgment_criteria: {
          status: "fail",
          messages: ["required field has no grounded extraction"],
          item_count: 0,
          source_ref_count: 0,
        },
      },
    });
    writeJson(join(runDir, "field_score_diagnostics.v0.json"), {
      scoring_profile: "schema_guided",
      raw_field_coverage: 0.5,
      weighted_field_coverage: 0.5,
      fields: {
        judgment_basis: {
          field_key: "judgment_basis",
          filled: true,
          required: true,
          critical: true,
          field_weight: 1,
          validation_status: "pass",
          item_count: 1,
          source_ref_count: 1,
          risk_reasons: [],
        },
        judgment_criteria: {
          field_key: "judgment_criteria",
          filled: false,
          required: true,
          critical: true,
          field_weight: 2,
          validation_status: "fail",
          item_count: 0,
          source_ref_count: 0,
          gap_priority: "P1",
          risk_reasons: ["required field is empty", "required field has no grounded extraction"],
        },
        faq_types: {
          field_key: "faq_types",
          filled: true,
          required: false,
          critical: false,
          field_weight: 1,
          validation_status: "pass",
          item_count: 1,
          source_ref_count: 1,
          risk_reasons: [],
        },
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
    });
    writeJson(join(runDir, "score_explanation.v0.json"), {
      below_threshold_metrics: { field_coverage: "fail" },
      overall_status: "needs_improvement",
      top_risk_fields: [
        { field_key: "judgment_criteria", risk_reasons: ["required field is empty"], gap_priority: "P1" },
      ],
      field_level_reasons: {
        judgment_criteria: ["required field is empty"],
      },
      recommended_plan_targets: [
        {
          target_field: "judgment_criteria",
          rationale: "optional field has no grounded extraction",
          priority: "P1",
        },
        {
          target_field: "page_screenshots",
          rationale: "optional field has no grounded extraction",
          priority: "P2",
        },
      ],
    });
    writeJson(join(runDir, "scorecard.v0.json"), {
      document_id: "doc-review",
      version_id: "v0",
      mode: "heuristic",
      scores: {
        field_coverage: 0.5,
        typed_validation_pass_rate: 0.5,
        source_backed_item_rate: 1,
      },
      threshold_check: { field_coverage: "fail" },
      overall_status: "needs_improvement",
    });
    writeJson(join(runDir, "expert_summary.v0.json"), {
      generated_at: "2026-01-01T00:00:00.000Z",
      provider: "mock",
      model: "mock-summary-model",
      core_idea: "专家摘要核心思想",
      method_spine: ["先判断点击率问题", "再补充阈值"],
      strengths: ["已有诊断方向"],
      gaps: ["缺少判断标准"],
      expert_commentary: "专家摘要批语",
      observability: {
        provider: "mock",
        model: "mock-summary-model",
        prompt: {
          system: "system prompt",
          user: "user prompt",
        },
        raw_response: "{\"core_idea\":\"专家摘要核心思想\"}",
        parsed_summary: {
          core_idea: "专家摘要核心思想",
          method_spine: ["先判断点击率问题", "再补充阈值"],
          strengths: ["已有诊断方向"],
          gaps: ["缺少判断标准"],
          expert_commentary: "专家摘要批语",
        },
      },
    });
    writeJson(join(runDir, "one_click_optimization.v0.json"), {
      generated_at: "2026-01-01T00:00:00.000Z",
      provider: "mock",
      model: "mock-optimize-model",
      goal: "补齐商品诊断判断标准",
      summary: "建议补充点击率下降的判断阈值。",
      patches: [
        {
          patch_id: "patch_1",
          title: "补充点击率下降判断标准",
          patch_type: "clarify_metric",
          target_field_key: "judgment_criteria",
          target_field_label: "判断标准",
          suggested_location: { block_id: "b2", position: "after" },
          draft_text: "当点击率连续 3 天低于同类商品均值 20% 时，优先判断入口吸引力和流量质量。",
          rationale: "原文提到点击率下降，但没有可复核阈值。",
          source_block_ids: ["b2"],
          expected_improvement: "提升判断标准清晰度。",
          status: "preview",
        },
      ],
      observability: {
        generated_at: "2026-01-01T00:00:00.000Z",
        provider: "mock",
        model: "mock-optimize-model",
        prompt: {
          system: "optimize system prompt",
          user: "optimize user prompt",
        },
        raw_response: "{\"patches\":[]}",
        parsed_result: {
          goal: "补齐商品诊断判断标准",
          summary: "建议补充点击率下降的判断阈值。",
          patches: [],
        },
        prompt_chars: 40,
        response_chars: 14,
      },
    });
    writeJson(join(runDir, "one_click_optimization_plan.v0.json"), {
      generated_at: "2026-01-01T00:00:00.000Z",
      goal: "先补齐这篇文档中最影响落地的关键缺口",
      summary: "建议先处理 1 个待补充事项。",
      todos: [
        {
          todo_id: "todo_1",
          title: "补充判断标准",
          target_field_key: "judgment_criteria",
          target_field_label: "判断标准",
          reason: "还没有看到明确的判断标准。",
          recommended_structure: "判断标准 = 指标 + 阈值 + 适用条件 + 验证方式",
          source_block_ids: ["b2"],
          priority: "high",
          status: "pending",
        },
      ],
      status: "planned",
    });
    writeJson(join(runDir, "one_click_optimization_error.v0.json"), {
      generated_at: "2026-01-01T00:00:00.000Z",
      stage: "preview_generation",
      message: "mock preview generation failed",
      provider: "mock",
      model: "mock-optimize-model",
    });

    const payload = buildReviewWorkbench({ runDir });

    assert.equal(payload.run_id, "run-review");
    assert.equal(payload.document.blocks.length, 3);
    assert.equal(payload.document_summary.document_theme, "商品诊断流程说明");
    assert.match(payload.document_summary.core_idea, /专家摘要核心思想/);
    assert.equal(payload.expert_summary_observability?.model, "mock-summary-model");
    assert.equal(payload.expert_summary_observability?.prompt.system, "system prompt");
    assert.match(payload.expert_summary_observability?.raw_response ?? "", /core_idea/);
    assert.equal(payload.one_click_optimization?.patches[0]?.target_field_label, "判断标准");
    assert.equal(payload.one_click_optimization_observability?.model, "mock-optimize-model");
    assert.match(payload.one_click_optimization_observability?.raw_response ?? "", /patches/);
    assert.equal(payload.one_click_optimization_plan?.todos[0]?.target_field_label, "判断标准");
    assert.equal(payload.one_click_optimization_error?.stage, "preview_generation");
    assert.ok(payload.document_summary.method_spine.length > 0);
    assert.ok(payload.document_summary.expert_commentary.length > 0);
    assert.ok(payload.document_summary.review_focuses.some((focus) => focus.includes("判断标准")));
    assert.ok(payload.friendly_evaluation.items.some((item) => item.label === "要素完整度"));
    assert.ok(
      payload.friendly_evaluation.items.every(
        (item) => !/pass|warn|fail|coverage|source_ref|schema|block/i.test(`${item.label}${item.explanation}${item.action}`),
      ),
    );
    assert.equal(payload.schema_fields.find((field) => field.field_key === "judgment_basis")?.status, "covered");
    assert.equal(payload.schema_fields.find((field) => field.field_key === "judgment_criteria")?.status, "missing");
    assert.equal(payload.schema_fields.find((field) => field.field_key === "faq_types")?.label, "常见问题类型");
    assert.equal(payload.schema_fields.find((field) => field.field_key === "page_screenshots")?.label, "页面示例");
    assert.equal(payload.hints.find((hint) => hint.field_key === "page_screenshots")?.recommended_structure.includes("关键结论"), false);
    assert.equal(payload.schema_fields.some((field) => field.field_key === "gaps"), false);
    assert.equal(
      /schema_guided|source-grounded|optional field|grounded extraction|required field|internal_gap|\bgaps\b/i.test(
        JSON.stringify({
          fields: payload.schema_fields.map((field) => field.reason),
          hints: payload.hints.map((hint) => [hint.why_it_matters, hint.what_to_ask]),
          focuses: payload.document_summary.review_focuses,
        }),
      ),
      false,
    );
    assert.ok(payload.block_tags.some((tag) => tag.block_id === "b2" && tag.label === "判断依据"));
    assert.ok(payload.block_tags.some((tag) => tag.block_id === "b3" && tag.status === "missing"));
    assert.equal(
      payload.block_tags.filter((tag) => tag.block_id === "b2" && tag.field_key === "judgment_basis").length,
      1,
    );
    assert.equal(payload.block_annotations.find((annotation) => annotation.block_id === "b2")?.primary_role, "metric_basis");
    assert.equal(payload.block_annotations.find((annotation) => annotation.block_id === "b2")?.semantic_unit_id, "unit_judgment");
    assert.equal(payload.block_annotations.find((annotation) => annotation.block_id === "b3")?.semantic_unit_id, "unit_judgment");
    assert.deepEqual(
      payload.block_annotations.find((annotation) => annotation.block_id === "b2")?.semantic_unit_source_block_ids,
      ["b2", "b3"],
    );
    assert.match(
      payload.block_annotations.find((annotation) => annotation.block_id === "b2")?.semantic_unit_summary ?? "",
      /共同说明点击率下降/,
    );
    assert.match(
      payload.block_annotations.find((annotation) => annotation.block_id === "b3")?.continuity_reason ?? "",
      /相邻段落共同说明/,
    );
    assert.deepEqual(
      payload.block_annotations
        .find((annotation) => annotation.block_id === "b2")
        ?.unit_supporting_field_refs.map((ref) => ref.label)
        .sort(),
      ["判断依据", "判断标准"],
    );
    assert.equal(
      payload.block_annotations.find((annotation) => annotation.block_id === "b3")?.supporting_field_refs.length,
      1,
    );
    assert.equal(payload.hints[0]?.field_key, "judgment_criteria");
    assert.match(payload.hints[0]?.recommended_structure ?? "", /判断标准/);
    assert.ok(payload.evaluation.metrics.some((metric) => metric.key === "field_coverage"));
    assert.equal(payload.evaluation.metrics.find((metric) => metric.key === "duplicate_tag_rate")?.value, 0);
    assert.ok(payload.evaluation.metrics.some((metric) => metric.key === "primary_label_coverage"));
    assert.ok(existsSync(join(runDir, "review_workbench.json")));
    const persisted = JSON.parse(readFileSync(join(runDir, "review_workbench.json"), "utf8")) as {
      run_id: string;
    };
    assert.equal(persisted.run_id, "run-review");
  });

  it("uses friendly fallback block annotations when block role map is missing", () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-review-workbench-baseline-"));
    writeJson(join(runDir, "run_summary.json"), {
      run_id: "run-baseline-review",
      understanding_profile: "baseline",
    });
    writeJson(join(runDir, "document_ir.json"), {
      doc_id: "doc-baseline",
      version_id: "v0",
      blocks: [
        {
          block_id: "b1",
          block_type: "heading",
          text_content: "商品诊断流程说明",
          heading_level: 1,
          source_file: "source.md",
          source_span: "L1",
          attachment_refs: [],
          children_block_ids: [],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "点击率下降时需要判断入口吸引力和流量质量。",
          heading_level: 0,
          source_file: "source.md",
          source_span: "L2",
          attachment_refs: [],
          children_block_ids: [],
        },
        {
          block_id: "b3",
          block_type: "table",
          text_content: "| 指标 | 判断标准 |\n| --- | --- |\n| 点击率下降 | 连续 3 天低于均值 |",
          heading_level: 0,
          source_file: "source.md",
          source_span: "L3",
          attachment_refs: [],
          children_block_ids: [],
        },
      ],
    });
    writeJson(join(runDir, "structured_draft.v0.json"), {
      doc_id: "doc-baseline",
      version_id: "v0",
      judgment_basis: [
        {
          content: "点击率下降",
          status: "Drafted",
          confidence: 0.8,
          source_refs: [{ block_id: "b2" }],
        },
      ],
      gaps_structured: { missing_fields: [], weak_fields: [], inferred_fields: [], needs_confirmation_fields: [] },
      source_refs: {},
    });
    writeJson(join(runDir, "field_score_diagnostics.v0.json"), {
      fields: {
        judgment_basis: {
          field_key: "judgment_basis",
          filled: true,
          required: true,
          critical: true,
          validation_status: "pass",
          item_count: 1,
          source_ref_count: 1,
          risk_reasons: [],
        },
      },
    });

    const payload = buildReviewWorkbench({ runDir });

    assert.equal(payload.block_annotations.length, 3);
    assert.equal(payload.block_annotations.some((annotation) => annotation.primary_label === "未分类"), false);
    assert.equal(payload.block_annotations.some((annotation) => annotation.semantic_unit_id), false);
    assert.equal(payload.block_annotations.find((annotation) => annotation.block_id === "b1")?.primary_label, "标题/主题");
    assert.equal(payload.block_annotations.find((annotation) => annotation.block_id === "b2")?.primary_label, "判断依据");
    assert.equal(payload.block_annotations.find((annotation) => annotation.block_id === "b3")?.primary_label, "判断/验证规则");
  });
});
