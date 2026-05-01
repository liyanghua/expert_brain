import { describe, expect, it } from "vitest";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import {
  ARRAY_STRUCTURED_FIELD_KEYS,
  collectDraftQualityIssues,
  normalizeLlmStructuredFields,
} from "../src/structuring-llm.js";

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
