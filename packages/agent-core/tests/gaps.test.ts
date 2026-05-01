import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { FIELD_DEFINITIONS_ZH } from "@ebs/ground-truth-schema";
import { runStructuring } from "../src/agents.js";

const ir: DocumentIR = {
  doc_id: "doc-gap",
  version_id: "v1",
  blocks: [
    {
      block_id: "b1",
      block_type: "heading",
      text_content: "商品诊断 SOP",
      heading_level: 1,
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
      block_type: "paragraph",
      text_content: "目标：帮助运营判断商品问题并输出处理动作。",
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

describe("business-friendly gaps", () => {
  it("defines Chinese labels and guidance for structured fields", () => {
    expect(FIELD_DEFINITIONS_ZH.key_node_rationales.label).toBe(
      "关键节点判断理由",
    );
    expect(FIELD_DEFINITIONS_ZH.resolution_methods.gap_guidance).toContain(
      "处理动作",
    );
  });

  it("generates Chinese business gap messages instead of English placeholders", () => {
    const draft = runStructuring(ir);
    const judgmentGap = draft.gaps.find(
      (gap) => gap.field_key === "judgment_basis",
    );

    expect(judgmentGap?.message).toContain("判断依据");
    expect(judgmentGap?.message).toContain("需要专家补充");
    expect(draft.gaps.map((gap) => gap.message).join("\n")).not.toContain(
      "needs expert input",
    );
  });
});
