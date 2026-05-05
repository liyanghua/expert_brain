import { describe, expect, it } from "vitest";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import type { DocumentIR } from "@ebs/document-ir";
import { buildRetrievalIndex, classifyTaskStatus, retrieveFieldEvidence } from "./retrieval.js";

function createIr(blocks: Array<{ id: string; text: string; type?: string }>): DocumentIR {
  return {
    doc_id: "doc-1",
    version_id: "v1",
    blocks: blocks.map((block, index) => ({
      block_id: block.id,
      block_type: block.type ?? "paragraph",
      text_content: block.text,
      heading_level: 0,
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

describe("retrieval index", () => {
  it("indexes block text and retrieves strongest evidence for a priority field", () => {
    const ir = createIr([
      { id: "b1", text: "执行步骤：首先打开后台，然后搜索订单号，最后提交处理。" },
      { id: "b2", text: "判断标准：如果金额大于1000且地址异常，需要人工复核。" },
      { id: "b3", text: "记录在异常订单检查表模板中。" },
    ]);

    const index = buildRetrievalIndex(ir);
    const evidence = retrieveFieldEvidence({
      index,
      fieldKey: "execution_steps",
      limit: 2,
    });

    expect(index).toHaveLength(3);
    expect(index[0]?.tokens.length).toBeGreaterThan(0);
    expect(evidence.map((item) => item.block_id)).toEqual(["b1"]);
    expect(evidence[0]?.score).toBeGreaterThan(0);
  });

  it("classifies task status as weak when evidence exists but draft is still empty", () => {
    const ir = createIr([
      { id: "b1", text: "判断依据包括风控标签、收货地址、用户备注和金额区间。" },
    ]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const index = buildRetrievalIndex(ir);
    const evidence = retrieveFieldEvidence({
      index,
      fieldKey: "judgment_basis",
    });

    const status = classifyTaskStatus({
      fieldKey: "judgment_basis",
      draft,
      evidence,
    });

    expect(status).toBe("weak");
  });
});
