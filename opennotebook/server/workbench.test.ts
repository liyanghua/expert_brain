import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import type { RetrievalIndexEntry } from "./retrieval.js";
import {
  buildFieldAssessments,
  buildFocusTasksFromAssessments,
  buildSourceViewModel,
} from "./workbench.js";

function createIr(blocks: Array<{ id: string; type?: string; text: string; span?: string }>): DocumentIR {
  return {
    doc_id: "doc-1",
    version_id: "v1",
    blocks: blocks.map((block, index) => ({
      block_id: block.id,
      block_type: block.type ?? "paragraph",
      text_content: block.text,
      heading_level: block.type === "heading" ? 1 : 0,
      source_file: "doc.md",
      source_span: block.span ?? `L${index + 1}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    })),
  };
}

function createRetrieval(entries: Array<{
  block_id: string;
  text: string;
  scores: Partial<Record<string, number>>;
  block_type?: string;
}>): RetrievalIndexEntry[] {
  return entries.map((entry) => ({
    block_id: entry.block_id,
    block_type: entry.block_type ?? "paragraph",
    source_file: "doc.md",
    source_span: entry.block_id,
    text: entry.text,
    normalized_text: entry.text.toLowerCase(),
    tokens: entry.text.split(/\s+/).filter(Boolean),
    section_hints: [],
    keyword_scores: entry.scores as Record<string, number>,
  }));
}

describe("workbench domain", () => {
  it("builds source view sections from headings and keeps block mapping", () => {
    const ir = createIr([
      { id: "h1", type: "heading", text: "一、总览" },
      { id: "p1", text: "这是第一段。" },
      { id: "h2", type: "heading", text: "二、标准" },
      { id: "t1", type: "table", text: "| 指标 | 阈值 |" },
    ]);

    const sourceView = buildSourceViewModel(ir);

    expect(sourceView.sections.map((item) => item.title)).toEqual(["一、总览", "二、标准"]);
    expect(sourceView.block_node_map.p1).toBe("node-p1");
    expect(sourceView.nodes.find((item) => item.block_id === "t1")?.node_type).toBe("table");
  });

  it("classifies missing, weak and covered assessments from retrieval + draft", () => {
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    draft.judgment_criteria = [
      {
        content: { text: "金额大于 1000 需要人工复核" },
        status: "Drafted",
        confidence: 0.82,
        source_refs: [{ block_id: "b3" }],
      },
    ];
    const retrieval = createRetrieval([
      {
        block_id: "b1",
        text: "先打开系统，然后搜索订单号。",
        scores: { execution_steps: 3.2 },
      },
      {
        block_id: "b2",
        text: "需要查看标签、地址和金额作为判断依据。",
        scores: { judgment_basis: 2.4 },
      },
      {
        block_id: "b3",
        text: "金额大于 1000 需要人工复核。",
        scores: { judgment_criteria: 2.8 },
      },
    ]);

    const assessments = buildFieldAssessments({ draft, retrievalIndex: retrieval });

    expect(assessments.find((item) => item.field_key === "execution_steps")?.status).toBe("weak");
    expect(assessments.find((item) => item.field_key === "judgment_basis")?.status).toBe("weak");
    expect(assessments.find((item) => item.field_key === "judgment_criteria")?.status).toBe("covered");
    expect(assessments.find((item) => item.field_key === "tool_templates")?.status).toBe("missing");
  });

  it("derives top 3 tasks from assessments with primary-field priority", () => {
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const retrieval = createRetrieval([
      {
        block_id: "b1",
        text: "流程步骤是：首先打开系统，然后搜索订单号。",
        scores: { execution_steps: 3.5 },
      },
      {
        block_id: "b2",
        text: "需要看标签、地址、金额。",
        scores: { judgment_basis: 2.6 },
      },
      {
        block_id: "b4",
        text: "触发条件：退款率异常。",
        scores: { trigger_conditions: 2.2 },
      },
    ]);

    const tasks = buildFocusTasksFromAssessments(
      buildFieldAssessments({ draft, retrievalIndex: retrieval }),
    );

    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.field_key)).toEqual([
      "judgment_criteria",
      "tool_templates",
      "execution_steps",
    ]);
  });
});
