import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import { chatCompletionText } from "../src/llm-client.js";
import { runDocQAAsync, runQuestionRefinementAsync } from "../src/agents.js";

vi.mock("../src/llm-client.js", () => ({
  chatCompletionText: vi.fn(async () => {
    throw new Error("TimeoutError: QA request timed out");
  }),
  resolveLlmRequestConfig: vi.fn((opts: { label?: string; timeoutMs?: number }) => ({
    provider: "deepseek",
    base: "https://api.deepseek.com/v1",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    timeoutMs:
      opts.timeoutMs ??
      (opts.label === "qa.refine_question"
        ? Number(process.env.EBS_LLM_REFINE_TIMEOUT_MS ?? 30000)
        : opts.label === "qa.answer"
          ? Number(process.env.EBS_LLM_QA_TIMEOUT_MS ?? 30000)
          : 30000),
    responseJson: true,
    label: opts.label ?? "chat.completions",
    route:
      opts.label === "qa.refine_question"
        ? "refine"
        : opts.label === "qa.answer"
          ? "qa"
          : "default",
  })),
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
    {
      block_id: "b2",
      block_type: "table",
      text_content: "指标 | 现象\n点击率 | 下降\n转化率 | 持平",
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

function largeQaIr(): DocumentIR {
  return {
    doc_id: "doc-qa-large",
    version_id: "v1",
    blocks: Array.from({ length: 12 }, (_, index) => ({
      block_id: `b${index + 1}`,
      block_type: "paragraph",
      text_content: `全局段落 ${index + 1} ` + "补充说明".repeat(120),
      heading_level: 0,
      source_file: "large.md",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    })),
  };
}

describe("runDocQAAsync", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.EBS_LLM_QA;
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
    expect(qa.llm_diagnostics).toEqual(
      expect.objectContaining({
        label: "qa.answer",
        status: "failed",
        reason: "timeout",
        user_prompt_chars: expect.any(Number),
      }),
    );
  });

  it("uses multiple evidence blocks and a refined question in fallback QA", async () => {
    process.env.EBS_LLM_QA = "0";
    const draft = emptyGroundTruthDraft("doc-qa", "v1");

    const qa = await runDocQAAsync({
      ir,
      draft,
      blockId: "b1",
      evidenceBlockIds: ["b1", "b2"],
      question: "怎么判断？",
      questionSeed: "请结合指标表判断点击率下降原因。",
      gapReason: "缺少判断依据",
      targetField: "judgment_basis",
    });

    expect(qa.refined_question).toContain("请结合指标表判断点击率下降原因");
    expect(qa.direct_answer).toContain("商品点击率下降");
    expect(qa.direct_answer).toContain("转化率 | 持平");
    expect(qa.source_block_refs).toEqual(["b1", "b2"]);
    expect(qa.target_field).toBe("judgment_basis");
  });

  it("generates a question draft from evidence blocks and gap context", async () => {
    process.env.EBS_LLM_QA = "0";
    const draft = emptyGroundTruthDraft("doc-qa", "v1");

    const refined = await runQuestionRefinementAsync({
      ir,
      draft,
      blockId: "b1",
      evidenceBlockIds: ["b1", "b2"],
      questionSeed: "请结合指标表判断点击率下降原因。",
      gapReason: "缺少判断依据",
      targetField: "judgment_basis",
      metric: "field_coverage",
    });

    expect(refined.refined_question).toContain("请结合指标表判断点击率下降原因");
    expect(refined.refined_question).toContain("判断依据");
    expect(refined.context_summary).toContain("商品点击率下降");
    expect(refined.context_summary).toContain("转化率 | 持平");
    expect(refined.source_block_refs).toEqual(["b1", "b2"]);
    expect(refined.rationale).toContain("缺少判断依据");
  });

  it("adds LLM diagnostics to a successful question refinement", async () => {
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText.mockResolvedValueOnce(
      JSON.stringify({
        refined_question: "请说明点击率下降时的判断依据和验证标准是什么？",
        context_summary: "商品点击率下降，转化率持平。",
        source_block_refs: ["b1", "b2"],
        rationale: "结合指标表生成。",
      }),
    );
    const draft = emptyGroundTruthDraft("doc-qa", "v1");

    const refined = await runQuestionRefinementAsync({
      ir,
      draft,
      blockId: "b1",
      evidenceBlockIds: ["b1", "b2"],
      questionSeed: "请结合指标表判断点击率下降原因。",
      gapReason: "缺少判断依据",
      targetField: "judgment_basis",
    });

    expect(refined.llm_diagnostics).toEqual(
      expect.objectContaining({
        label: "qa.refine_question",
        status: "ok",
        user_prompt_chars: expect.any(Number),
      }),
    );
  });

  it("sends only selected local evidence blocks to QA answer", async () => {
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText.mockResolvedValueOnce(
      JSON.stringify({
        refined_question: "请补充判断依据。",
        direct_answer: "可根据当前证据补充判断依据。",
        rationale: "只引用选中证据。",
        source_block_refs: ["b1"],
        target_field: "judgment_basis",
      }),
    );
    const qaIr = largeQaIr();
    const draft = emptyGroundTruthDraft("doc-qa-large", "v1");

    await runDocQAAsync({
      ir: qaIr,
      draft,
      blockId: "b1",
      evidenceBlockIds: ["b1"],
      question: "请补充判断依据",
      targetField: "judgment_basis",
    });

    const call = mockedChatCompletionText.mock.calls[0]?.[0];
    expect(call?.label).toBe("qa.answer");
    expect(call?.user).toContain('"evidence_blocks"');
    expect(call?.user).toContain('"block_id": "b1"');
    expect(call?.user).not.toContain('"document_context"');
    expect(call?.user).not.toContain('"block_id": "b10"');
    expect(call?.user.length ?? 0).toBeLessThan(2500);
  });
});
