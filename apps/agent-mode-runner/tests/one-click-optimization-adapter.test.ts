import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  generateOneClickOptimizationArtifact,
  generateOneClickOptimizationPlanArtifact,
} from "../src/review/one-click-optimization-adapter.js";

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

describe("one-click optimization adapter", () => {
  it("writes a deterministic optimization plan before generating preview patches", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-one-click-plan-"));
    writeJson(join(runDir, "review_workbench.json"), {
      run_id: "run-optimize-plan",
      document_summary: {
        document_theme: "商品诊断流程说明",
        core_idea: "文档说明商品诊断方向。",
        review_focuses: ["补充判断标准"],
      },
      schema_fields: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          status: "missing",
          source_block_ids: ["b2"],
          reason: "还没有看到明确的判断标准。",
        },
      ],
      hints: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          priority: "high",
          why_it_matters: "判断标准能帮助专家复核。",
          what_to_ask: "请补充点击率下降的判断阈值。",
          recommended_structure: "判断标准 = 指标 + 阈值 + 适用条件 + 验证方式",
          source_block_ids: ["b2"],
          status: "todo",
        },
      ],
    });

    const plan = await generateOneClickOptimizationPlanArtifact({ runDir });

    assert.equal(plan.goal, "先补齐这篇文档中最影响落地的关键缺口");
    assert.equal(plan.todos.length, 1);
    assert.equal(plan.todos[0]?.target_field_label, "判断标准");
    assert.equal(plan.todos[0]?.status, "pending");
    assert.match(plan.todos[0]?.recommended_structure ?? "", /判断标准/);
    assert.equal(plan.observability?.provider, "deterministic");
    assert.equal(plan.observability?.model, "rule-based-plan-v1");
    assert.match(plan.observability?.prompt.user ?? "", /schema_fields_to_check/);
    assert.match(plan.observability?.raw_response ?? "", /todos/);
    assert.equal(plan.observability?.parsed_result.todos[0]?.target_field_key, "judgment_criteria");
    assert.ok(existsSync(join(runDir, "one_click_optimization_plan.v0.json")));
  });

  it("uses semantic segments and LLM to refine the optimization plan", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-one-click-llm-plan-"));
    writeJson(join(runDir, "review_workbench.json"), {
      run_id: "run-llm-plan",
      document_summary: {
        document_theme: "商品诊断流程说明",
        core_idea: "文档说明商品诊断方向。",
        review_focuses: ["补充判断标准"],
      },
      schema_fields: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          status: "missing",
          source_block_ids: ["h1", "p1"],
          reason: "还没有看到明确的判断标准。",
        },
      ],
      hints: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          priority: "high",
          why_it_matters: "判断标准能帮助专家复核。",
          what_to_ask: "请补充点击率下降的判断阈值。",
          recommended_structure: "判断标准 = 指标 + 阈值 + 适用条件 + 验证方式",
          source_block_ids: ["h1", "p1"],
          semantic_unit_ids: ["unit_judgment"],
          status: "todo",
        },
      ],
      semantic_units: [
        {
          unit_id: "unit_judgment",
          source_block_ids: ["p1", "p2"],
          anchor_block_id: "p1",
          semantic_text: "点击率下降时需要判断入口吸引力。\n同时对比流量质量变化。",
          summary: "这一组正文共同说明点击率下降判断。",
          continuity_edges: [],
          related_schema_fields: ["judgment_basis", "judgment_criteria"],
          missing_or_weak_fields: ["judgment_criteria"],
          confidence: 0.91,
        },
      ],
      semantic_segments: [
        {
          segment_id: "seg_judgment",
          title: "点击率下降判断",
          summary: "这一组段落说明点击率下降时要看入口吸引力和流量质量，但缺少明确阈值。",
          source_block_ids: ["p1", "p2"],
          anchor_block_id: "p1",
          primary_role: "metric_basis",
          related_schema_fields: ["judgment_basis", "judgment_criteria"],
          missing_or_weak_fields: ["judgment_criteria"],
          coherence_reason: "连续段落共同说明同一个点击率判断问题",
          confidence: 0.9,
        },
      ],
    });

    const plan = await generateOneClickOptimizationPlanArtifact({
      runDir,
      completion: async (prompt) => {
        assert.match(prompt.user, /semantic_units_shortlist/);
        assert.match(prompt.user, /semantic_segments_shortlist/);
        return JSON.stringify({
          goal: "补齐点击率下降判断标准",
          summary: "优先优化说明点击率下降判断的语义段落，而不是标题。",
          todos: [
            {
              todo_id: "todo_1",
              title: "补充点击率下降判断标准",
              target_field_key: "judgment_criteria",
              target_field_label: "判断标准",
              semantic_unit_id: "unit_judgment",
              semantic_segment_id: "seg_judgment",
              reason: "该段落已经说明判断方向，但缺少可复核阈值。",
              why_this_segment: "这组连续段落共同描述点击率下降判断，适合作为补充位置。",
              recommended_structure: "判断标准 = 指标 + 阈值 + 适用条件 + 验证方式",
              source_block_ids: ["p1", "p2"],
              priority: "high",
              status: "pending",
            },
          ],
        });
      },
    });

    assert.equal(plan.provider, "mock");
    assert.equal(plan.model, "mock");
    assert.equal(plan.todos[0]?.semantic_unit_id, "unit_judgment");
    assert.equal(plan.todos[0]?.semantic_segment_id, "seg_judgment");
    assert.deepEqual(plan.todos[0]?.source_block_ids, ["p1", "p2"]);
    assert.match(plan.todos[0]?.why_this_segment ?? "", /连续段落/);
    assert.equal(plan.observability?.parsed_result.fallback_used, false);
    assert.match(plan.observability?.raw_response ?? "", /seg_judgment/);
  });

  it("falls back to the deterministic segment shortlist when LLM plan generation fails", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-one-click-fallback-plan-"));
    writeJson(join(runDir, "review_workbench.json"), {
      run_id: "run-fallback-plan",
      document_summary: { document_theme: "商品诊断", review_focuses: ["补充判断标准"] },
      schema_fields: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          status: "missing",
          source_block_ids: ["h1"],
          semantic_unit_ids: ["unit_judgment"],
          reason: "还没有看到明确的判断标准。",
        },
      ],
      hints: [],
      semantic_units: [
        {
          unit_id: "unit_judgment",
          source_block_ids: ["p1", "p2"],
          anchor_block_id: "p1",
          semantic_text: "段落说明点击率下降判断。\n后续补充流量质量对照。",
          summary: "连续正文共同说明点击率下降判断。",
          continuity_edges: [],
          related_schema_fields: ["judgment_criteria"],
          missing_or_weak_fields: ["judgment_criteria"],
          confidence: 0.9,
        },
      ],
      semantic_segments: [
        {
          segment_id: "seg_judgment",
          title: "点击率下降判断",
          summary: "段落说明点击率下降判断，但缺少阈值。",
          source_block_ids: ["p1", "p2"],
          anchor_block_id: "p1",
          primary_role: "metric_basis",
          related_schema_fields: ["judgment_criteria"],
          missing_or_weak_fields: ["judgment_criteria"],
          coherence_reason: "连续段落共同说明一个判断问题",
          confidence: 0.88,
        },
      ],
    });

    const plan = await generateOneClickOptimizationPlanArtifact({
      runDir,
      completion: async () => {
        throw new Error("mock LLM timeout");
      },
    });

    assert.equal(plan.provider, "deterministic");
    assert.equal(plan.todos[0]?.semantic_unit_id, "unit_judgment");
    assert.equal(plan.todos[0]?.semantic_segment_id, "seg_judgment");
    assert.deepEqual(plan.todos[0]?.source_block_ids, ["p1", "p2"]);
    assert.equal(plan.observability?.parsed_result.fallback_used, true);
    assert.match(plan.observability?.parsed_result.fallback_reason ?? "", /mock LLM timeout/);
  });

  it("writes preview patches and LLM observability from a mocked response", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-one-click-optimize-"));
    writeJson(join(runDir, "document_ir.json"), {
      doc_id: "doc-optimize",
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
      ],
    });
    writeJson(join(runDir, "document_synthesis.json"), {
      document_theme: "商品诊断流程说明",
      business_scene: "商品诊断",
      primary_goal: "定位点击率下降原因",
      process_spine: [{ section_id: "s1", role: "先判断指标，再给出动作" }],
      key_signals: ["点击率下降", "流量质量"],
      likely_gaps: ["缺少判断标准"],
      quality_risks: ["判断标准不可复现"],
      summary_for_agent: "文档说明了诊断方向，但缺少明确判断阈值。",
      confidence: 0.82,
    });
    writeJson(join(runDir, "review_workbench.json"), {
      run_id: "run-optimize",
      document_summary: {
        document_theme: "商品诊断流程说明",
        core_idea: "文档说明商品诊断方向。",
        method_spine: ["先判断点击率问题", "再补充阈值"],
        expert_commentary: "需要补足判断标准。",
        review_focuses: ["补充判断标准"],
      },
      document: { blocks: [] },
      schema_fields: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          status: "missing",
          source_block_ids: ["b2"],
          item_count: 0,
          source_count: 0,
          reason: "还没有看到明确的判断标准。",
        },
      ],
      hints: [
        {
          field_key: "judgment_criteria",
          label: "判断标准",
          priority: "high",
          why_it_matters: "判断标准能帮助专家复核。",
          what_to_ask: "请补充点击率下降的判断阈值。",
          recommended_structure: "判断标准 = 指标 + 阈值 + 适用条件 + 验证方式",
          source_block_ids: ["b2"],
          status: "todo",
        },
      ],
      block_annotations: [
        {
          block_id: "b2",
          primary_role: "metric_basis",
          primary_label: "指标依据",
          supporting_field_refs: [],
          confidence: 0.86,
          reason: "包含点击率下降信号。",
        },
      ],
    });

    const artifact = await generateOneClickOptimizationArtifact({
      runDir,
      completion: async () =>
        JSON.stringify({
          goal: "补齐商品诊断中的判断标准",
          summary: "建议先补充点击率下降的阈值和验证方式。",
          patches: [
            {
              patch_id: "patch_1",
              title: "补充点击率下降判断标准",
              patch_type: "clarify_metric",
              target_field_key: "judgment_criteria",
              target_field_label: "判断标准",
              suggested_location: { block_id: "b2", position: "after" },
              draft_text: "建议补充：当点击率连续 3 天低于同类商品均值 20% 时，优先判断入口吸引力和流量质量，并用改前改后点击率变化验证。",
              rationale: "原文已经提出点击率下降，但缺少可复核阈值。",
              source_block_ids: ["b2"],
              expected_improvement: "提升判断标准的清晰度和可验证性。",
            },
          ],
        }),
    });

    assert.equal(artifact.goal, "补齐商品诊断中的判断标准");
    assert.equal(artifact.patches.length, 1);
    assert.equal(artifact.patches[0]?.status, "preview");
    assert.equal(artifact.patches[0]?.target_field_key, "judgment_criteria");
    assert.deepEqual(artifact.patches[0]?.source_block_ids, ["b2"]);
    assert.equal(artifact.observability?.model, "mock");
    assert.match(artifact.observability?.prompt.user ?? "", /review_focuses/);
    assert.match(artifact.observability?.raw_response ?? "", /patches/);
    assert.equal(artifact.observability?.parsed_result.summary, artifact.summary);
    assert.ok(existsSync(join(runDir, "one_click_optimization.v0.json")));
    const persisted = JSON.parse(readFileSync(join(runDir, "one_click_optimization.v0.json"), "utf8")) as {
      patches: { draft_text: string }[];
    };
    assert.match(persisted.patches[0]?.draft_text ?? "", /点击率/);
  });
});
