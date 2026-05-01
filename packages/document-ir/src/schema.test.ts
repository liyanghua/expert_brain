import { describe, expect, it } from "vitest";
import { DocumentIRSchema } from "./schema.js";

describe("DocumentIRSchema", () => {
  it("parses minimal IR", () => {
    const ir = DocumentIRSchema.parse({
      doc_id: "d1",
      version_id: "v1",
      blocks: [
        {
          block_id: "b1",
          block_type: "paragraph",
          text_content: "hello",
          heading_level: 0,
          source_file: "x.md",
          attachment_refs: [],
          children_block_ids: [],
          parent_block_id: null,
          page_no: null,
          sheet_name: null,
          node_path: null,
        },
      ],
    });
    expect(ir.blocks).toHaveLength(1);
  });
});
