import { describe, expect, it } from "vitest";
import { parseMarkdownToBlocks } from "@ebs/parsing";
import { DocumentIRSchema } from "@ebs/document-ir";
import { runStructuring } from "@ebs/agent-core";

describe("integration upload-parse-extract path", () => {
  it("markdown → IR → GroundTruthDraft", () => {
    const md = "# Title\n\nParagraph.";
    const blocks = parseMarkdownToBlocks(md, "t.md");
    const ir = DocumentIRSchema.parse({
      doc_id: "d",
      version_id: "v1",
      blocks,
    });
    const draft = runStructuring(ir);
    expect(draft.doc_id).toBe("d");
    expect(draft.gaps.length).toBeGreaterThan(0);
  });
});
