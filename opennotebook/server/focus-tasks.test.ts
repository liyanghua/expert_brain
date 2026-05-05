import { describe, expect, it } from "vitest";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import type { DocumentIR } from "@ebs/document-ir";
import { buildRetrievalIndex } from "./retrieval.js";
import { buildNotebookFocusTasks } from "./focus-tasks.js";

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

describe("buildNotebookFocusTasks", () => {
  it("returns only top three tasks and keeps primary schema priorities first", () => {
    const ir = createIr([
      { id: "b1", text: "执行步骤：先打开后台，再搜索订单，最后提交。" },
      { id: "b2", text: "判断依据包括风控标签、用户备注和收货地址。" },
      { id: "b3", text: "判断标准：金额大于1000且地址异常时，需要升级处理。" },
      { id: "b4", text: "使用《异常订单检查表》模板记录结果。" },
      { id: "b5", text: "验证方法：复核处理后页面状态是否已更新。" },
    ]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const index = buildRetrievalIndex(ir);

    const tasks = buildNotebookFocusTasks({
      ir,
      draft,
      retrievalIndex: index,
    });

    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.field_key)).toEqual([
      "execution_steps",
      "judgment_basis",
      "judgment_criteria",
    ]);
  });

  it("keeps weak evidence tasks ranked below stronger primary tasks", () => {
    const ir = createIr([
      { id: "b1", text: "只提到了风控标签和地址，需要经验判断。" },
      { id: "b2", text: "本说明仅包含操作背景，没有附带任何记录表、检查表或模板链接。" },
    ]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const index = buildRetrievalIndex(ir);

    const tasks = buildNotebookFocusTasks({
      ir,
      draft,
      retrievalIndex: index,
      limit: 4,
    });

    expect(tasks.find((task) => task.field_key === "tool_templates")?.status).toBe("weak");
    expect(tasks.find((task) => task.field_key === "judgment_basis")?.status).toBe("weak");
  });
});
