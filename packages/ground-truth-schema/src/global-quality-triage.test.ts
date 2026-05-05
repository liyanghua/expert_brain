import { describe, expect, it } from "vitest";
import {
  GlobalQualityTriageSchema,
  QualityIssueIndexSchema,
  SourceAnnotationSchema,
} from "./schema.js";

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

  it("parses block-level quality issues with primary and supporting evidence", () => {
    const parsed = QualityIssueIndexSchema.parse({
      doc_id: "doc-1",
      version_id: "v1",
      generated_at: "2026-05-02T07:00:00.000Z",
      global_context_summary: "文档描述了诊断流程，但判断标准没有落到可执行口径。",
      issues: [
        {
          issue_id: "issue-criteria",
          severity: "high",
          issue_type: "missing_judgment_criteria",
          summary: "缺少判断正常或异常的标准。",
          why_it_matters: "没有标准会导致专家回写时断章取义。",
          primary_block_ids: ["b4"],
          supporting_block_ids: ["b2", "b3"],
          target_field: "judgment_criteria",
          recommended_question: "这里的异常判断标准是什么？",
          suggested_action: "补充阈值、例外和验证方式。",
          confidence: 0.82,
          grounding_reason: "b4 提到判断动作，但没有给出阈值。",
        },
      ],
    });

    expect(parsed.issues[0]?.primary_block_ids).toEqual(["b4"]);
    expect(parsed.issues[0]?.supporting_block_ids).toEqual(["b2", "b3"]);
  });

  it("keeps expert writeback annotations compatible and supports quality issue projections", () => {
    const expertWriteback = SourceAnnotationSchema.parse({
      annotation_id: "annotation-1",
      doc_id: "doc-1",
      version_id: "v1",
      block_id: "b4",
      field_key: "judgment_basis",
      content: "专家补充内容",
      created_at: "2026-05-02T07:00:00.000Z",
      updated_at: "2026-05-02T07:00:00.000Z",
    });
    const qualityIssue = SourceAnnotationSchema.parse({
      annotation_id: "annotation-2",
      doc_id: "doc-1",
      version_id: "v1",
      block_id: "b4",
      field_key: "judgment_criteria",
      content: "缺少判断正常或异常的标准。",
      annotation_type: "quality_issue",
      issue_id: "issue-criteria",
      severity: "high",
      issue_type: "missing_judgment_criteria",
      block_role: "primary",
      recommended_question: "这里的异常判断标准是什么？",
      created_at: "2026-05-02T07:00:00.000Z",
      updated_at: "2026-05-02T07:00:00.000Z",
    });

    expect(expertWriteback.annotation_type).toBe("expert_writeback");
    expect(qualityIssue.annotation_type).toBe("quality_issue");
    expect(qualityIssue.issue_id).toBe("issue-criteria");
  });
});
