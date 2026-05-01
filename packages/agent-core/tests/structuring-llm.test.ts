import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import type { DocumentIR } from "@ebs/document-ir";
import { chatCompletionText } from "../src/llm-client.js";
import {
  buildCompactDocumentContext,
  buildGlobalQualityTriagePromptInput,
} from "../src/structuring-prompt.js";
import {
  ARRAY_STRUCTURED_FIELD_KEYS,
  collectDraftQualityIssues,
  normalizeLlmStructuredFields,
  runGlobalQualityTriageWithLlmOrFallback,
  runStructuringWithLlmOrFallback,
} from "../src/structuring-llm.js";

vi.mock("../src/llm-client.js", () => ({
  chatCompletionText: vi.fn(async () => {
    throw new Error("TimeoutError: structuring request timed out");
  }),
  resolveLlmRequestConfig: vi.fn((opts: { label?: string; timeoutMs?: number }) => ({
    provider: "deepseek",
    base: "https://api.deepseek.com/v1",
    apiKey: "test-key",
    model:
      opts.label === "structuring.global_triage"
        ? "deepseek-v4-flash"
        : "deepseek-v4-pro",
    timeoutMs: opts.timeoutMs ?? 30000,
    responseJson: true,
    label: opts.label ?? "chat.completions",
    route:
      opts.label === "structuring.global_triage" ? "triage" : "default",
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.EBS_LLM_STRUCTURING;
  delete process.env.EBS_LLM_STRUCTURING_TIMEOUT_MS;
  delete process.env.EBS_TRIAGE_INDEX_MAX_BLOCKS;
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_MODEL;
});

function sampleIr(text = "普通业务流程 目标 输入 输出 执行动作"): DocumentIR {
  return {
    doc_id: "doc-timeout",
    version_id: "v1",
    blocks: [
      {
        block_id: "b1",
        block_type: "paragraph",
        text_content: text,
        heading_level: 0,
        source_file: "doc.md",
        page_no: null,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
    ],
  };
}

function sampleLargeIr(): DocumentIR {
  return {
    doc_id: "doc-large",
    version_id: "v1",
    blocks: Array.from({ length: 12 }, (_, index) => ({
      block_id: `b${index + 1}`,
      block_type: index % 5 === 0 ? "heading" : "paragraph",
      text_content:
        index === 6
          ? "判断标准：" + "转化率和加购率需要结合生命周期判断。".repeat(60)
          : `普通段落 ${index + 1}`,
      heading_level: index % 5 === 0 ? 1 : 0,
      source_file: "large.md",
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

function priorityFieldIr(): DocumentIR {
  return {
    doc_id: "doc-priority",
    version_id: "v1",
    blocks: [
      {
        block_id: "b-steps",
        block_type: "paragraph",
        text_content: "执行流程：先检查商品状态，再完成诊断动作。",
        heading_level: 0,
        source_file: "priority.md",
        page_no: null,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
      {
        block_id: "b-basis",
        block_type: "paragraph",
        text_content: "判断依据包含转化率、加购率、ROI、GMV 等核心指标。",
        heading_level: 0,
        source_file: "priority.md",
        page_no: null,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
      {
        block_id: "b-criteria",
        block_type: "paragraph",
        text_content: "判断标准需要明确正常、异常、通过条件和阈值。",
        heading_level: 0,
        source_file: "priority.md",
        page_no: null,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
      {
        block_id: "b-tools",
        block_type: "paragraph",
        text_content: "工具模板包括诊断表单、检查清单和记录表。",
        heading_level: 0,
        source_file: "priority.md",
        page_no: null,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
    ],
  };
}

describe("normalizeLlmStructuredFields", () => {
  it("wraps single field items for schema array fields", () => {
    const item = {
      content: { text: "Ship a report" },
      status: "Drafted",
      confidence: 0.9,
      source_refs: [],
    };

    const normalized = normalizeLlmStructuredFields({
      business_scenario: item,
      deliverables: item,
    });

    expect(normalized.business_scenario).toEqual(item);
    expect(normalized.deliverables).toEqual([item]);
  });

  it("unwraps singleton arrays for schema object fields", () => {
    const item = {
      content: { text: "商品诊断" },
      status: "Drafted",
      confidence: 0.82,
      source_refs: [],
    };

    const normalized = normalizeLlmStructuredFields({
      business_scenario: [item],
      scenario_goal: [item],
      process_flow_or_business_model: [item],
    });

    expect(normalized.business_scenario).toEqual(item);
    expect(normalized.scenario_goal).toEqual(item);
    expect(normalized.process_flow_or_business_model).toEqual(item);
  });

  it("keeps existing arrays intact", () => {
    const item = {
      content: { text: "Validate output" },
      status: "Drafted",
      source_refs: [],
    };

    const normalized = normalizeLlmStructuredFields({
      validation_methods: [item],
    });

    expect(normalized.validation_methods).toEqual([item]);
  });

  it("normalizes root gaps and source_refs returned in common LLM shapes", () => {
    const sourceRef = {
      block_id: "block-1",
      source_file: "sample.md",
    };

    const normalized = normalizeLlmStructuredFields({
      gaps: "Missing owner confirmation.",
      source_refs: [sourceRef],
    });

    expect(normalized.gaps).toEqual([
      {
        field_key: "general",
        message: "Missing owner confirmation.",
      },
    ]);
    expect(normalized.source_refs).toEqual({
      general: [sourceRef],
    });
  });

  it("tracks the schema fields expected to be arrays", () => {
    expect(ARRAY_STRUCTURED_FIELD_KEYS).toContain("deliverables");
    expect(ARRAY_STRUCTURED_FIELD_KEYS).not.toContain("business_scenario");
  });
});

describe("runStructuringWithLlmOrFallback", () => {
  it("uses a 60 second default timeout for structuring LLM calls", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    const ir = sampleIr();

    const result = await runStructuringWithLlmOrFallback(ir);

    expect(result.structuring_mode).toBe("rules_fallback");
    expect(chatCompletionText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        label: "structuring.knowledge_skeleton",
        timeoutMs: 60000,
      }),
    );
    expect(chatCompletionText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        label: "structuring.draft",
        timeoutMs: 60000,
      }),
    );
  });

  it("uses a dedicated short timeout for structuring LLM calls before fallback", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    process.env.EBS_LLM_STRUCTURING_TIMEOUT_MS = "12345";
    process.env.DASHSCOPE_API_KEY = "dashscope-key";
    process.env.DASHSCOPE_MODEL = "qwen-plus";
    const ir = sampleIr();

    const result = await runStructuringWithLlmOrFallback(ir);

    expect(result.structuring_mode).toBe("rules_fallback");
    expect(chatCompletionText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        label: "structuring.knowledge_skeleton",
        timeoutMs: 12345,
        promptDiagnostics: expect.objectContaining({
          stage: "knowledge_skeleton",
          selectedBlockCount: 1,
          totalBlockCount: 1,
        }),
      }),
    );
    expect(chatCompletionText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        label: "structuring.knowledge_skeleton.fallback_dashscope",
        provider: "dashscope",
        timeoutMs: 12345,
      }),
    );
    expect(chatCompletionText).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        label: "structuring.draft",
        timeoutMs: 12345,
        promptDiagnostics: expect.objectContaining({
          stage: "draft",
          selectedBlockCount: 1,
          totalBlockCount: 1,
        }),
      }),
    );
    expect(chatCompletionText).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        label: "structuring.draft.fallback_dashscope",
        provider: "dashscope",
        timeoutMs: 12345,
      }),
    );
  });

  it("uses DashScope fallback after DeepSeek timeout and keeps LLM mode on success", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    process.env.EBS_LLM_STRUCTURING_TIMEOUT_MS = "12345";
    process.env.DASHSCOPE_API_KEY = "dashscope-key";
    process.env.DASHSCOPE_MODEL = "qwen-plus";
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText
      .mockRejectedValueOnce(new Error("TimeoutError: primary skeleton timed out"))
      .mockResolvedValueOnce(
        JSON.stringify({
          lifecycle_stages: ["输入", "处理", "输出"],
          source_block_ids: ["b1"],
        }),
      )
      .mockRejectedValueOnce(new Error("TimeoutError: primary draft timed out"))
      .mockResolvedValueOnce(
        JSON.stringify({
          business_scenario: {
            content: { summary: "普通业务流程结构化" },
            status: "Drafted",
            confidence: 0.8,
            source_refs: [{ block_id: "b1", source_file: "doc.md" }],
          },
          scenario_goal: {
            content: { summary: "明确目标、输入、输出和执行动作" },
            status: "Drafted",
            confidence: 0.8,
            source_refs: [{ block_id: "b1", source_file: "doc.md" }],
          },
          deliverables: [
            {
              content: { summary: "结构化流程草稿" },
              status: "Drafted",
              confidence: 0.8,
              source_refs: [{ block_id: "b1", source_file: "doc.md" }],
            },
          ],
        }),
      );

    const result = await runStructuringWithLlmOrFallback(sampleIr());

    expect(result.structuring_mode).toBe("llm");
    expect(mockedChatCompletionText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: "dashscope",
        label: "structuring.knowledge_skeleton.fallback_dashscope",
      }),
    );
    expect(mockedChatCompletionText).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        provider: "dashscope",
        label: "structuring.draft.fallback_dashscope",
      }),
    );
  });
});

describe("runGlobalQualityTriageWithLlmOrFallback", () => {
  it("runs a single lightweight LLM triage call on success", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText.mockResolvedValueOnce(
      JSON.stringify({
        summary: "文档缺少判断标准和验证方式。",
        major_gaps: [
          {
            field_key: "judgment_criteria",
            severity: "high",
            message: "判断标准不清晰。",
            source_refs: [{ block_id: "b1" }],
          },
        ],
        recommended_tasks: [
          {
            title: "补充判断标准",
            reason: "当前只有执行动作。",
            question: "这个动作的异常判断标准是什么？",
            target_field: "judgment_criteria",
            source_block_ids: ["b1"],
            priority: "high",
          },
        ],
        suggested_questions: [],
        source_refs: [{ block_id: "b1" }],
      }),
    );

    const result = await runGlobalQualityTriageWithLlmOrFallback(sampleLargeIr());

    expect(result.triage_mode).toBe("llm");
    expect(result.triage.recommended_tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "补充判断标准" }),
      ]),
    );
    expect(result.diagnostics.attempts[0]).toEqual(
      expect.objectContaining({
        stage: "global_triage",
        label: "structuring.global_triage",
        status: "ok",
        user_prompt_chars: expect.any(Number),
        system_prompt: expect.stringContaining("quality triage"),
        user_prompt: expect.stringContaining("Compact document context"),
        request_params: expect.objectContaining({
          route: "triage",
        }),
      }),
    );
    expect(mockedChatCompletionText).toHaveBeenCalledTimes(1);
    expect(mockedChatCompletionText).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "structuring.global_triage",
        promptDiagnostics: expect.objectContaining({
          stage: "global_triage",
          selectedBlockCount: expect.any(Number),
        }),
      }),
    );
  });

  it("returns local heuristic triage after one failed LLM call", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";

    const result = await runGlobalQualityTriageWithLlmOrFallback(sampleIr());

    expect(result.triage_mode).toBe("rules_fallback");
    expect(result.triage.summary).toContain("规则诊断");
    expect(result.triage.recommended_tasks.length).toBeGreaterThan(0);
    expect(result.diagnostics.attempts[0]).toEqual(
      expect.objectContaining({
        stage: "global_triage",
        label: "structuring.global_triage",
        status: "failed",
        user_prompt_chars: expect.any(Number),
      }),
    );
    expect(chatCompletionText).toHaveBeenCalledTimes(1);
    expect(chatCompletionText).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "structuring.global_triage",
      }),
    );
  });

  it("normalizes common DeepSeek triage shapes before schema validation", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText.mockResolvedValueOnce(
      JSON.stringify({
        summary: "文档缺少恢复步骤和负责人。",
        major_gaps: [
          {
            field_key: "steps",
            severity: "critical",
            message: "步骤太少。",
            source_refs: ["b1"],
          },
        ],
        recommended_tasks: [
          {
            title: "补充恢复步骤",
            reason: "当前只有一句动作。",
            question: "具体恢复步骤是什么？",
            target_field: "steps",
            source_block_ids: ["b1"],
            priority: "urgent",
          },
        ],
        suggested_questions: [],
        source_refs: ["b1"],
      }),
    );

    const result = await runGlobalQualityTriageWithLlmOrFallback(sampleIr());

    expect(result.triage_mode).toBe("llm");
    expect(result.triage.major_gaps[0]?.severity).toBe("high");
    expect(result.triage.major_gaps[0]?.source_refs[0]?.block_id).toBe("b1");
    expect(result.triage.recommended_tasks[0]?.priority).toBe("high");
    expect(result.triage.source_refs[0]?.block_id).toBe("b1");
  });

  it("drops ungrounded LLM triage tasks that have no valid field or source block", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText.mockResolvedValueOnce(
      JSON.stringify({
        summary: "发现两个任务。",
        major_gaps: [],
        recommended_tasks: [
          {
            title: "泛泛补充方法",
            reason: "需要更多细节。",
            question: "还有什么要补充？",
            source_block_ids: ["missing-block"],
            priority: "medium",
          },
          {
            title: "补充判断标准",
            reason: "缺少判断口径。",
            question: "判断标准是什么？",
            target_field: "judgment_criteria",
            source_block_ids: ["b1", "missing-block"],
            priority: "high",
          },
        ],
        suggested_questions: [
          {
            question: "泛泛问题？",
            source_block_ids: ["missing-block"],
          },
        ],
        source_refs: ["missing-block", "b1"],
      }),
    );

    const result = await runGlobalQualityTriageWithLlmOrFallback(sampleIr());

    expect(result.triage.recommended_tasks).toHaveLength(3);
    expect(result.triage.recommended_tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "泛泛补充方法" }),
      ]),
    );
    expect(result.triage.recommended_tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "补充判断标准",
          target_field: "judgment_criteria",
          source_block_ids: ["b1"],
        }),
      ]),
    );
    expect(result.triage.suggested_questions).toHaveLength(3);
    expect(result.triage.source_refs).toEqual([{ block_id: "b1" }]);
  });

  it("prioritizes the four primary schema fields and returns at most three tasks", async () => {
    process.env.EBS_LLM_STRUCTURING = "1";
    const mockedChatCompletionText = vi.mocked(chatCompletionText);
    mockedChatCompletionText.mockResolvedValueOnce(
      JSON.stringify({
        summary: "返回了过多任务。",
        major_gaps: [],
        recommended_tasks: [
          {
            title: "补充交付物",
            reason: "交付物也不清楚。",
            question: "输出什么？",
            target_field: "deliverables",
            source_block_ids: ["b-tools"],
            priority: "high",
          },
          {
            title: "补充工具模板",
            reason: "工具模板不够具体。",
            question: "用什么表单？",
            target_field: "tool_templates",
            source_block_ids: ["b-tools"],
            priority: "high",
          },
          {
            title: "补充判断标准",
            reason: "标准不够明确。",
            question: "怎么判定正常异常？",
            target_field: "judgment_criteria",
            source_block_ids: ["b-criteria"],
            priority: "low",
          },
          {
            title: "补充指标依据",
            reason: "缺少指标。",
            question: "看哪些指标？",
            source_block_ids: ["b-basis"],
            priority: "medium",
          },
          {
            title: "补充执行步骤",
            reason: "步骤缺少细节。",
            question: "具体怎么执行？",
            target_field: "execution_steps",
            source_block_ids: ["b-steps"],
            priority: "low",
          },
        ],
        suggested_questions: [],
        source_refs: ["b-steps", "b-basis", "b-criteria", "b-tools"],
      }),
    );

    const result = await runGlobalQualityTriageWithLlmOrFallback(priorityFieldIr());

    expect(result.triage.recommended_tasks).toHaveLength(3);
    expect(result.triage.recommended_tasks.map((task) => task.target_field)).toEqual([
      "execution_steps",
      "judgment_basis",
      "judgment_criteria",
    ]);
    expect(result.triage.recommended_tasks[1]?.source_block_ids).toEqual([
      "b-basis",
    ]);
  });

  it("keeps heuristic fallback focused on at most three priority fields", async () => {
    const result = await runGlobalQualityTriageWithLlmOrFallback(sampleIr("普通说明"));

    expect(result.triage_mode).toBe("rules");
    expect(result.triage.recommended_tasks).toHaveLength(3);
    expect(result.triage.recommended_tasks.map((task) => task.target_field)).toEqual([
      "execution_steps",
      "judgment_basis",
      "judgment_criteria",
    ]);
    expect(result.triage.suggested_questions).toHaveLength(3);
  });
});

describe("buildCompactDocumentContext", () => {
  it("keeps a budgeted subset of blocks instead of the whole IR", () => {
    const context = buildCompactDocumentContext(sampleLargeIr(), {
      maxBlocks: 5,
      maxBlockChars: 80,
    });

    expect(context.selectedBlockCount).toBeLessThan(context.totalBlockCount);
    expect(context.selectedBlockCount).toBeLessThanOrEqual(5);
    expect(context.text).toContain("b1");
    expect(context.text).toContain("b6");
    expect(context.text).not.toContain("b12");
  });

  it("trims long block text while keeping block_id provenance", () => {
    const context = buildCompactDocumentContext(sampleLargeIr(), {
      maxBlocks: 8,
      maxBlockChars: 80,
    });

    expect(context.text).toContain("b7");
    expect(context.text).toContain("判断标准");
    expect(context.text).toContain("…");
    expect(context.text.length).toBeLessThan(5000);
  });
});

describe("buildGlobalQualityTriagePromptInput", () => {
  it("builds a short global triage prompt instead of a full structuring prompt", () => {
    const input = buildGlobalQualityTriagePromptInput(sampleLargeIr());

    expect(input.context.selectedBlockCount).toBeLessThanOrEqual(4);
    expect(input.prompt.length).toBeLessThan(3200);
    expect(input.prompt).toContain("b1");
    expect(input.prompt).toContain("Document navigation index");
    expect(input.prompt).toContain("b12");
    expect(input.prompt).toContain("recommended_tasks");
    expect(input.prompt).not.toContain("BusinessDocStructuredDraft");
    expect(input.prompt).not.toContain("GroundTruthDraft");
  });

  it("caps the navigation index for very large documents", () => {
    process.env.EBS_TRIAGE_INDEX_MAX_BLOCKS = "500";
    const largeIr: DocumentIR = {
      doc_id: "doc-huge",
      version_id: "v1",
      blocks: Array.from({ length: 500 }, (_, index) => ({
        block_id: `huge-${index + 1}`,
        block_type: index % 12 === 0 ? "heading" : "paragraph",
        text_content: `第 ${index + 1} 段：商品诊断流程内容。`,
        heading_level: index % 12 === 0 ? 2 : 0,
        source_file: "huge.md",
        source_span: `L${index + 1}`,
        page_no: null,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      })),
    };

    const input = buildGlobalQualityTriagePromptInput(largeIr);

    expect(input.prompt).toContain("total_blocks=500");
    expect(input.prompt).toContain("indexed_blocks=240");
    expect(input.prompt).toContain("omitted_blocks=260");
    expect(input.prompt).not.toContain("huge-500");
    expect(input.prompt.length).toBeLessThan(22000);
  });
});

describe("collectDraftQualityIssues", () => {
  it("flags placeholder field content", () => {
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    draft.deliverables = [
      {
        content: { text: "Deliverables to be confirmed by expert." },
        status: "Drafted",
        source_refs: [],
      },
    ];

    const issues = collectDraftQualityIssues(draft, {
      doc_id: "doc-1",
      version_id: "v1",
      blocks: [],
    });

    expect(issues.some((i) => i.includes("placeholder"))).toBe(true);
  });

  it("requires product diagnosis core elements when source is product diagnosis", () => {
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    draft.business_scenario = {
      content: { summary: "天猫商品诊断优化" },
      status: "Drafted",
      source_refs: [],
    };

    const issues = collectDraftQualityIssues(draft, {
      doc_id: "doc-1",
      version_id: "v1",
      blocks: [
        {
          block_id: "b1",
          block_type: "paragraph",
          text_content: "商品诊断 生命周期 新品 成长期 诊断维度 判断标准",
          heading_level: 0,
          source_file: "doc.docx",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
      ],
    });

    expect(issues.some((i) => i.includes("商品等级"))).toBe(true);
    expect(issues.some((i) => i.includes("排查方法"))).toBe(true);
  });
});
