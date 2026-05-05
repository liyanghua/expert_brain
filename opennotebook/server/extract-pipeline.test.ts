import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import { runNotebookExtractPipeline } from "./extract-pipeline.js";

function createIr(blocks: Array<{ id: string; type?: "heading" | "paragraph" | "list" | "table" | "image" | "outline"; text: string }>): DocumentIR {
  return {
    doc_id: "doc-1",
    version_id: "v1",
    blocks: blocks.map((block, index) => ({
      block_id: block.id,
      block_type: block.type ?? "paragraph",
      text_content: block.text,
      heading_level: block.type === "heading" ? 1 : 0,
      source_file: "doc.md",
      source_span: `L${index + 1}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    })),
  };
}

describe("runNotebookExtractPipeline", () => {
  it("returns understanding, field assessments and top tasks from evidence-packed structuring", async () => {
    const ir = createIr([
      { id: "h1", type: "heading", text: "一、异常订单处理" },
      { id: "b1", text: "执行步骤：先打开后台，再搜索订单号，最后提交处理。" },
      { id: "b2", text: "判断依据包括风控标签、收货地址和订单金额。" },
      { id: "b3", text: "判断标准：金额大于1000且地址异常时，需要人工复核。" },
      { id: "b4", text: "使用《异常订单检查表》模板记录结果。" },
    ]);

    const result = await runNotebookExtractPipeline({
      docId: "doc-1",
      versionId: "v1",
      ir,
      existingDraft: emptyGroundTruthDraft("doc-1", "v1"),
      requestedMode: "deep",
    });

    expect(result.document_understanding.summary).toContain("异常订单处理");
    expect(result.field_assessments.length).toBeGreaterThan(0);
    expect(result.focus_tasks).toHaveLength(3);
    expect(result.diagnostics.full_document_blocks_sent).toBe(false);
    expect(result.diagnostics.structuring_requests.every((item) => item.block_count <= 10)).toBe(
      true,
    );
  });
});
