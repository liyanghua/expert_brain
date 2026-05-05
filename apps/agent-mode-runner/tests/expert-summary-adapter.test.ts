import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { generateExpertSummaryArtifact } from "../src/review/expert-summary-adapter.js";

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

describe("expert summary adapter", () => {
  it("writes a business-friendly expert summary artifact from a mocked LLM response", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-expert-summary-"));
    writeJson(join(runDir, "document_ir.json"), {
      doc_id: "doc-summary",
      version_id: "v0",
      blocks: [
        {
          block_id: "b1",
          block_type: "heading",
          text_content: "商品链接增长诊断方法论",
          heading_level: 1,
          source_file: "source.md",
          source_span: "L1",
          attachment_refs: [],
          children_block_ids: [],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "核心是按问题、方案、任务、增长形成闭环。",
          heading_level: 0,
          source_file: "source.md",
          source_span: "L2",
          attachment_refs: [],
          children_block_ids: [],
        },
      ],
    });
    writeJson(join(runDir, "document_synthesis.json"), {
      document_theme: "商品链接增长诊断方法论",
      business_scene: "商品链接诊断",
      primary_goal: "提升商品链接增长诊断质量",
      process_spine: [{ section_id: "s1", role: "framework: 方法论总述" }],
      key_signals: ["问题", "方案", "任务", "增长"],
      likely_gaps: ["缺少验证方法"],
      quality_risks: ["判断标准不够清晰"],
      summary_for_agent: "文档说明了商品链接诊断框架。",
      confidence: 0.82,
    });
    writeJson(join(runDir, "review_workbench.json"), {
      run_id: "run-summary",
      document_summary: {
        document_theme: "商品链接增长诊断方法论",
        core_idea: "这篇文档说明商品链接诊断方法。",
        method_spine: ["先定义方法，再拆解问题。"],
        review_focuses: ["补充验证方法"],
      },
      schema_fields: [],
      hints: [],
    });

    const artifact = await generateExpertSummaryArtifact({
      runDir,
      completion: async () =>
        JSON.stringify({
          core_idea: "这篇文档的核心思想是把商品链接诊断从看数据升级为围绕增长闭环的方法论。",
          method_spine: ["1. 先定义诊断场景", "2. 再按问题、方案、任务、增长组织判断"],
          strengths: ["- 主线明确"],
          gaps: ["1）需要补充可验证的判断标准"],
          expert_commentary: "适合作为方法论草稿，但还需要补足专家可执行的判断口径。",
        }),
    });

    assert.equal(
      artifact.core_idea,
      "这篇文档的核心思想是把商品链接诊断从看数据升级为围绕增长闭环的方法论。",
    );
    assert.ok(artifact.method_spine.some((item) => item.includes("增长")));
    assert.equal(artifact.method_spine.some((item) => /^\d/.test(item)), false);
    assert.equal(artifact.model, "mock");
    assert.equal(artifact.observability?.model, "mock");
    assert.match(artifact.observability?.prompt.system ?? "", /业务文档批改专家/);
    assert.match(artifact.observability?.prompt.user ?? "", /representative_blocks/);
    assert.match(artifact.observability?.raw_response ?? "", /core_idea/);
    assert.equal(artifact.observability?.parsed_summary.core_idea, artifact.core_idea);
    assert.ok(existsSync(join(runDir, "expert_summary.v0.json")));
    const persisted = JSON.parse(readFileSync(join(runDir, "expert_summary.v0.json"), "utf8")) as {
      expert_commentary: string;
    };
    assert.match(persisted.expert_commentary, /方法论草稿/);
  });

  it("normalizes imperfect LLM JSON into a usable expert summary", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "agent-expert-summary-imperfect-"));
    writeJson(join(runDir, "document_ir.json"), {
      doc_id: "doc-summary",
      version_id: "v0",
      blocks: [
        {
          block_id: "b1",
          block_type: "heading",
          text_content: "商品链接增长诊断方法论",
          heading_level: 1,
          source_file: "source.md",
          source_span: "L1",
          attachment_refs: [],
          children_block_ids: [],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "核心是按问题、方案、任务、增长形成闭环。",
          heading_level: 0,
          source_file: "source.md",
          source_span: "L2",
          attachment_refs: [],
          children_block_ids: [],
        },
      ],
    });
    writeJson(join(runDir, "document_synthesis.json"), {
      document_theme: "商品链接增长诊断方法论",
      business_scene: "商品链接诊断",
      primary_goal: "提升商品链接增长诊断质量",
      process_spine: [{ section_id: "s1", role: "framework: 方法论总述" }],
      key_signals: ["问题", "方案", "任务", "增长"],
      likely_gaps: ["缺少验证方法"],
      quality_risks: ["判断标准不够清晰"],
      summary_for_agent: "文档说明了商品链接诊断框架。",
      confidence: 0.82,
    });
    writeJson(join(runDir, "review_workbench.json"), {
      run_id: "run-summary",
      document_summary: {
        core_idea: "默认核心思想",
        method_spine: ["默认方法主线"],
        expert_commentary: "默认批语",
        review_focuses: ["补充验证方法"],
      },
      schema_fields: [],
      hints: [],
    });

    const artifact = await generateExpertSummaryArtifact({
      runDir,
      completion: async () =>
        JSON.stringify({
          core_idea: "核心是商品链接诊断增长闭环。",
          method_spine: "先定义场景；再拆解问题；最后验证结果",
          strengths: "主线明确",
          gaps: "需要补充判断标准",
          expert_commentary: "可以作为专家批改的第一版摘要。",
        }),
    });

    assert.deepEqual(artifact.method_spine, ["先定义场景", "再拆解问题", "最后验证结果"]);
    assert.deepEqual(artifact.strengths, ["主线明确"]);
    assert.deepEqual(artifact.gaps, ["需要补充判断标准"]);
  });
});
