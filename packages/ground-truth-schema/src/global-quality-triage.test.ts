import { describe, expect, it } from "vitest";
import { GlobalQualityTriageSchema } from "./schema.js";

describe("GlobalQualityTriageSchema", () => {
  it("parses a lightweight global quality triage payload", () => {
    const parsed = GlobalQualityTriageSchema.parse({
      summary: "文档已有流程描述，但缺少判断标准和验证方式。",
      major_gaps: [
        {
          field_key: "judgment_criteria",
          severity: "high",
          message: "需要补充什么情况下判定为通过或异常。",
          source_refs: [{ block_id: "b1", source_span: "L1-L3" }],
        },
      ],
      recommended_tasks: [
        {
          title: "补充判断标准",
          reason: "当前文档只有动作，没有给出判断口径。",
          question: "这里的异常判断标准是什么？",
          target_field: "judgment_criteria",
          source_block_ids: ["b1"],
          priority: "high",
        },
      ],
      suggested_questions: [
        {
          question: "执行完成后如何验证结果有效？",
          target_field: "validation_methods",
          source_block_ids: ["b2"],
        },
      ],
      source_refs: [{ block_id: "b1" }],
    });

    expect(parsed.major_gaps[0]?.source_refs[0]?.block_id).toBe("b1");
    expect(parsed.recommended_tasks[0]?.question).toContain("异常判断标准");
    expect(parsed.suggested_questions[0]?.target_field).toBe("validation_methods");
  });

  it("defaults optional arrays for fast fallback payloads", () => {
    const parsed = GlobalQualityTriageSchema.parse({
      summary: "规则诊断发现文档仍需专家补充关键字段。",
    });

    expect(parsed.major_gaps).toEqual([]);
    expect(parsed.recommended_tasks).toEqual([]);
    expect(parsed.suggested_questions).toEqual([]);
    expect(parsed.source_refs).toEqual([]);
  });
});
