import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import type { RetrievalIndexEntry } from "./retrieval.js";
import {
  buildContentListFromIr,
  buildDocumentUnderstanding,
  buildEvidencePack,
  buildScopedStructuringIr,
} from "./evidence-pack.js";
import { buildSourceViewModel } from "./workbench.js";

function createIr(): DocumentIR {
  return {
    doc_id: "doc-1",
    version_id: "v1",
    blocks: [
      {
        block_id: "h1",
        block_type: "heading",
        text_content: "一、处理总览",
        heading_level: 1,
        source_file: "doc.pdf",
        source_span: "P1",
        page_no: 1,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
      {
        block_id: "b1",
        block_type: "paragraph",
        text_content: "执行步骤：先打开后台，再搜索订单号，最后提交处理。",
        heading_level: 0,
        source_file: "doc.pdf",
        source_span: "P1",
        page_no: 1,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
      {
        block_id: "b2",
        block_type: "table",
        text_content: "| 指标 | 阈值 |\n| 金额 | > 1000 |",
        heading_level: 0,
        source_file: "doc.pdf",
        source_span: "P2",
        page_no: 2,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
      },
      {
        block_id: "b3",
        block_type: "image",
        text_content: "风险提示截图",
        heading_level: 0,
        source_file: "doc.pdf",
        source_span: "P3",
        page_no: 3,
        sheet_name: null,
        node_path: null,
        attachment_refs: [],
        parent_block_id: null,
        children_block_ids: [],
        media_uri: "/documents/doc-1/versions/v1/assets/risk.png",
      },
    ],
  };
}

function createRetrieval(): RetrievalIndexEntry[] {
  return [
    {
      block_id: "b1",
      block_type: "paragraph",
      source_file: "doc.pdf",
      source_span: "P1",
      text: "执行步骤：先打开后台，再搜索订单号，最后提交处理。",
      normalized_text: "执行步骤：先打开后台，再搜索订单号，最后提交处理。",
      tokens: ["执行步骤", "后台", "搜索订单号"],
      section_hints: ["一、处理总览"],
      keyword_scores: { execution_steps: 3.5, judgment_basis: 0.4 },
    },
    {
      block_id: "b2",
      block_type: "table",
      source_file: "doc.pdf",
      source_span: "P2",
      text: "| 指标 | 阈值 |\n| 金额 | > 1000 |",
      normalized_text: "| 指标 | 阈值 |\n| 金额 | > 1000 |",
      tokens: ["指标", "阈值", "金额"],
      section_hints: ["二、判断标准"],
      keyword_scores: { judgment_criteria: 2.8, judgment_basis: 2.2 },
    },
    {
      block_id: "b3",
      block_type: "image",
      source_file: "doc.pdf",
      source_span: "P3",
      text: "风险提示截图",
      normalized_text: "风险提示截图",
      tokens: ["风险提示截图"],
      section_hints: ["截图"],
      keyword_scores: { tool_templates: 1.4, judgment_basis: 0.6 },
    },
  ];
}

describe("evidence pack", () => {
  it("builds content-list items that preserve multimodal block metadata", () => {
    const items = buildContentListFromIr(createIr());

    expect(items.map((item) => item.node_type)).toEqual([
      "outline",
      "text",
      "table",
      "image",
    ]);
    expect(items.find((item) => item.block_id === "b3")?.media_uri).toContain("risk.png");
  });

  it("prioritizes manual attachments ahead of retrieved evidence and de-duplicates blocks", () => {
    const ir = createIr();
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const sourceView = buildSourceViewModel(ir);
    const understanding = buildDocumentUnderstanding({
      ir,
      sourceView,
      retrievalIndex: createRetrieval(),
    });

    const pack = buildEvidencePack({
      docId: "doc-1",
      versionId: "v1",
      ir,
      draft,
      fieldKey: "judgment_basis",
      manualBlockIds: ["b3", "b2"],
      retrievalHits: createRetrieval(),
      sourceView,
      documentUnderstanding: understanding,
      parseMode: "content_list_fallback",
      retrievalMode: "local_keyword",
      fallbackReason: "sidecar_unavailable",
    });

    expect(pack.blocks.map((item) => item.block_id)).toEqual(["b3", "b2", "b1"]);
    expect(pack.context_budget.manual_limit).toBe(2);
    expect(pack.completion_criteria).toContain("判断依据");
    expect(pack.fallback_reason).toBe("sidecar_unavailable");
  });

  it("builds scoped structuring IR from evidence packs instead of the full document", () => {
    const ir = createIr();
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const sourceView = buildSourceViewModel(ir);
    const understanding = buildDocumentUnderstanding({
      ir,
      sourceView,
      retrievalIndex: createRetrieval(),
    });
    const pack = buildEvidencePack({
      docId: "doc-1",
      versionId: "v1",
      ir,
      draft,
      fieldKey: "execution_steps",
      manualBlockIds: [],
      retrievalHits: createRetrieval(),
      sourceView,
      documentUnderstanding: understanding,
      parseMode: "content_list_fallback",
      retrievalMode: "local_keyword",
      fallbackReason: "sidecar_unavailable",
    });

    const scoped = buildScopedStructuringIr({
      docId: "doc-1",
      versionId: "v1",
      fieldKey: "execution_steps",
      originalIr: ir,
      evidencePack: pack,
    });

    expect(scoped.blocks.length).toBeLessThanOrEqual(10);
    expect(scoped.blocks.some((block) => block.block_id === "understanding-summary")).toBe(
      true,
    );
    expect(scoped.blocks.some((block) => block.block_id === "b1")).toBe(true);
    expect(scoped.blocks.some((block) => block.block_id === "h1")).toBe(false);
  });
});
