import { randomUUID } from "node:crypto";
import type { DocumentIR } from "@ebs/document-ir";
import type { SuggestionRecord } from "@ebs/ground-truth-schema";

export function heuristicSuggestionsForBlock(
  ir: DocumentIR,
  blockId: string,
): SuggestionRecord[] {
  const block = ir.blocks.find((b) => b.block_id === blockId);
  if (!block) return [];
  const out: SuggestionRecord[] = [];
  if (block.text_content.length > 400) {
    out.push({
      suggestion_id: randomUUID(),
      target_block_id: blockId,
      target_field: null,
      suggestion_type: "split",
      suggestion_text:
        "Consider splitting this block into shorter paragraphs for clarity.",
      rationale: "Long blocks reduce scanability in expert review.",
      source_refs: [{ block_id: blockId }],
      status: "draft",
      confidence: 0.4,
    });
  }
  if (block.block_type === "paragraph" && block.text_content.includes("TODO")) {
    out.push({
      suggestion_id: randomUUID(),
      target_block_id: blockId,
      target_field: null,
      suggestion_type: "clarify",
      suggestion_text: "Replace TODO markers with concrete operational detail.",
      rationale: "TODOs block Ground Truth completeness.",
      source_refs: [{ block_id: blockId }],
      status: "draft",
      confidence: 0.7,
    });
  }
  return out;
}
