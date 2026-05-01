import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import { chatCompletionText } from "../src/llm-client.js";
import { runDocQAAsync } from "../src/agents.js";

vi.mock("../src/llm-client.js", () => ({
  chatCompletionText: vi.fn(async () => {
    throw new Error("TimeoutError: QA request timed out");
  }),
}));

const ir: DocumentIR = {
  doc_id: "doc-qa",
  version_id: "v1",
  blocks: [
    {
      block_id: "b1",
      block_type: "paragraph",
      text_content: "商品点击率下降，需要判断是流量问题还是转化问题。",
      heading_level: 0,
      source_file: "sample.md",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    },
  ],
};

describe("runDocQAAsync", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.EBS_LLM_QA_TIMEOUT_MS;
  });

  it("uses a short QA timeout and falls back when LLM is unavailable", async () => {
    process.env.EBS_LLM_QA_TIMEOUT_MS = "1234";
    const draft = emptyGroundTruthDraft("doc-qa", "v1");

    const qa = await runDocQAAsync({
      ir,
      draft,
      blockId: "b1",
      question: "这段内容应该怎么判断？",
      targetField: "judgment_basis",
    });

    expect(chatCompletionText).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 1234 }),
    );
    expect(qa.direct_answer).toContain("这段内容应该怎么判断");
    expect(qa.source_block_refs).toEqual(["b1"]);
    expect(qa.target_field).toBe("judgment_basis");
  });
});
