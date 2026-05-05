import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DocumentIR } from "../src/types.js";
import { buildDocumentMap, buildSectionCards } from "../src/tools/document-map.js";

const ir: DocumentIR = {
  doc_id: "doc-test",
  version_id: "v0",
  blocks: [
    {
      block_id: "h1",
      block_type: "heading",
      text_content: "商品诊断 SOP",
      heading_level: 1,
      source_file: "sample.md",
      source_span: "L1",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: ["p1", "h2"],
    },
    {
      block_id: "p1",
      block_type: "paragraph",
      text_content: "目标是判断商品链接流量是否异常。",
      heading_level: 0,
      source_file: "sample.md",
      source_span: "L2",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: "h1",
      children_block_ids: [],
    },
    {
      block_id: "h2",
      block_type: "heading",
      text_content: "判断标准",
      heading_level: 2,
      source_file: "sample.md",
      source_span: "L3",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: "h1",
      children_block_ids: ["p2"],
    },
    {
      block_id: "p2",
      block_type: "paragraph",
      text_content: "如果转化率下降且点击率稳定，需要检查主图和人群。",
      heading_level: 0,
      source_file: "sample.md",
      source_span: "L4",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: "h2",
      children_block_ids: [],
    },
  ],
};

describe("document map", () => {
  it("builds section ranges and grounded section cards", () => {
    const map = buildDocumentMap(ir);
    const cards = buildSectionCards(ir, map);

    assert.equal(map.sections.length, 2);
    assert.deepEqual(map.sections[0]?.block_ids, ["h1", "p1", "h2", "p2"]);
    assert.equal(map.sections[1]?.title, "判断标准");
    assert.equal(cards.length, 2);
    assert.ok(cards[1]?.source_block_ids.includes("p2"));
    assert.ok(cards[1]?.covered_schema_fields.includes("judgment_criteria"));
  });
});
