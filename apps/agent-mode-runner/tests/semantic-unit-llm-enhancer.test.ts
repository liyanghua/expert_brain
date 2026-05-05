import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { enhanceSemanticUnitsWithLlm } from "../src/understanding/semantic-unit-llm-enhancer.js";
import { validateSemanticUnitMatches } from "../src/understanding/semantic-unit-match-validator.js";
import { evaluateSemanticUnits, writeSemanticUnitEvaluationReport } from "../src/evaluation/semantic-unit-evaluator.js";
import type { DocumentIR, SchemaProfile, SemanticUnit } from "../src/types.js";

const schemaProfile: SchemaProfile = {
  profile_id: "schema.semantic-test",
  version: "v1",
  required_fields: ["judgment_basis", "resolution_methods", "trigger_conditions"],
  optional_fields: ["termination_conditions", "tool_templates"],
  inferred_candidate_fields: [],
  field_definitions: {
    judgment_basis: {
      description: "用于诊断问题和验证效果的核心指标或信号",
      extraction_hint: "优先识别指标名、变量名、监控项、数据依据。",
    },
    resolution_methods: {
      description: "针对问题类型的具体解决方法与执行动作",
      extraction_hint: "优先识别优化动作、建议动作、问题解决方法。",
    },
    trigger_conditions: {
      description: "优化流程或诊断流程启动的前提条件",
      extraction_hint: "优先识别触发条件、达到何种数据阈值才进入诊断。",
    },
    termination_conditions: {
      description: "流程何时结束、停止、转入维持或退出",
      extraction_hint: "若原文未显式给出，可归纳 candidate，但不得直接 confirmed。",
    },
    tool_templates: {
      description: "可复用的工具、诊断表、执行模板、方案模板",
      extraction_hint: "注意区分工具与模板。工具是系统/平台，模板是可复用表单。",
    },
  },
  normalization_rules: [],
  output_requirements: [],
};

const ir: DocumentIR = {
  doc_id: "semantic-unit-test",
  version_id: "v0",
  blocks: [
    {
      block_id: "h1",
      block_type: "heading",
      text_content: "3. 客单价问题：用户买得少还是买得便宜",
      heading_level: 2,
      source_file: "source.md",
      source_span: "L1",
      page_no: null,
      sheet_name: null,
      node_path: null,
      parent_block_id: null,
      children_block_ids: ["b28", "b29"],
      attachment_refs: [],
    },
    {
      block_id: "b28",
      block_type: "paragraph",
      text_content: "客单价可以拆成：客单价 = 件单价 × 连带购买件数。",
      heading_level: 0,
      source_file: "source.md",
      source_span: "L2",
      page_no: null,
      sheet_name: null,
      node_path: null,
      parent_block_id: "h1",
      children_block_ids: [],
      attachment_refs: [],
    },
    {
      block_id: "b29",
      block_type: "table",
      text_content: "| 路径 | 经营动作 |\n| --- | --- |\n| 提升件单价 | 升级款、高端款、价值包装 |\n| 提升连带购买件数 | 搭配购、满减、套装 |",
      heading_level: 0,
      source_file: "source.md",
      source_span: "L3-L6",
      page_no: null,
      sheet_name: null,
      node_path: null,
      parent_block_id: "h1",
      children_block_ids: [],
      attachment_refs: [],
    },
  ],
};

const unit: SemanticUnit = {
  unit_id: "unit_9",
  source_block_ids: ["b28", "b29"],
  anchor_block_id: "b28",
  semantic_text: `${ir.blocks[1]!.text_content}\n${ir.blocks[2]!.text_content}`,
  summary: "3. 客单价问题：用户买得少还是买得便宜：客单价可以拆成：客单价 = 件单价 × 连带购买件数。 关键信号：执行、路径、目标、指标。",
  continuity_edges: [],
  related_schema_fields: ["judgment_basis", "resolution_methods", "trigger_conditions", "termination_conditions", "tool_templates"],
  missing_or_weak_fields: [],
  confidence: 0.72,
};

describe("semantic unit LLM enhancement", () => {
  it("separates parent heading from business summary and classifies schema fields", () => {
    const artifact = enhanceSemanticUnitsWithLlm({
      units: [unit],
      ir,
      schemaProfile,
      completion: () =>
        JSON.stringify({
          units: [
            {
              unit_id: "unit_9",
              unit_title: "客单价拆解与提升动作",
              unit_summary: "这组内容把客单价拆成件单价和连带购买件数，并给出提升路径。",
              primary_schema_fields: ["resolution_methods"],
              supporting_schema_fields: ["judgment_basis", "tool_templates"],
              context_schema_fields: ["trigger_conditions"],
              rejected_schema_fields: ["termination_conditions"],
              field_match_reasons: {
                resolution_methods: "表格给出提升件单价和连带件数的经营动作。",
                judgment_basis: "公式说明客单价拆解依据。",
                termination_conditions: "没有出现结束、停止或转入维持的条件。",
              },
            },
          ],
        }),
    });

    const enhanced = artifact.units[0]!;
    assert.equal(enhanced.parent_heading, "3. 客单价问题：用户买得少还是买得便宜");
    assert.equal(enhanced.unit_title, "客单价拆解与提升动作");
    assert.equal(enhanced.llm_summary?.includes("客单价问题：用户买得少还是买得便宜"), false);
    assert.equal(enhanced.schema_field_matches?.filter((match) => match.relation === "primary").length, 1);
    assert.equal(enhanced.schema_field_matches?.find((match) => match.field_key === "resolution_methods")?.relation, "primary");
    assert.equal(artifact.observability.status, "llm_generated");
  });

  it("validates boundaries and falls back when LLM output is invalid", () => {
    const artifact = enhanceSemanticUnitsWithLlm({
      units: [unit],
      ir,
      schemaProfile,
      completion: () => "{not-json",
    });
    const validated = validateSemanticUnitMatches({
      units: artifact.units,
      ir,
      schemaProfile,
    });

    const enhanced = validated.units[0]!;
    assert.equal(artifact.observability.status, "fallback_rule_based");
    assert.ok(enhanced.schema_field_matches?.some((match) => match.relation === "primary"));
    assert.equal(
      enhanced.schema_field_matches?.some(
        (match) => match.field_key === "termination_conditions" && match.relation === "primary",
      ),
      false,
    );
    assert.ok(validated.diagnostics.validation_pass_rate > 0);
  });

  it("evaluates semantic units and writes a markdown evaluation report", () => {
    const artifact = enhanceSemanticUnitsWithLlm({
      units: [unit],
      ir,
      schemaProfile,
      completion: () =>
        JSON.stringify({
          units: [
            {
              unit_id: "unit_9",
              unit_title: "客单价拆解与提升动作",
              unit_summary: "这组内容说明客单价拆解方式和对应提升动作。",
              primary_schema_fields: ["resolution_methods"],
              supporting_schema_fields: ["judgment_basis"],
              context_schema_fields: ["tool_templates"],
              rejected_schema_fields: ["termination_conditions"],
            },
          ],
        }),
    });
    const validated = validateSemanticUnitMatches({ units: artifact.units, ir, schemaProfile });
    const report = evaluateSemanticUnits({
      baselineUnits: [unit],
      enhancedUnits: validated.units,
      validation: validated,
      observability: artifact.observability,
    });
    const dir = mkdtempSync(join(tmpdir(), "semantic-unit-report-"));
    const path = writeSemanticUnitEvaluationReport({ outputDir: dir, report });

    assert.ok(report.semantic_navigation_score > 0);
    const markdown = readFileSync(path, "utf8");
    assert.match(markdown, /Semantic Unit & Schema Match Evaluation/);
    assert.match(markdown, /heading_overuse_rate/);
    assert.match(markdown, /semantic_navigation_score/);
  });
});
