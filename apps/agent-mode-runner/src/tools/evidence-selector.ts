import type { ContextCoverage, SectionCard } from "../types.js";

export function selectEvidenceForField(input: {
  fieldKey: string;
  sectionCards: SectionCard[];
  totalBlockCount: number;
  maxBlocks?: number;
}): { block_ids: string[]; coverage: ContextCoverage } {
  const maxBlocks = input.maxBlocks ?? 6;
  const matched = input.sectionCards.filter((card) =>
    card.covered_schema_fields.includes(input.fieldKey),
  );
  const fallback = matched.length > 0 ? matched : input.sectionCards.slice(0, 1);
  const blockIds = [
    ...new Set(fallback.flatMap((card) => card.source_block_ids)),
  ].slice(0, maxBlocks);
  const coveredSections = fallback.map((card) => card.section_id);
  const scannedBlocks = blockIds.length;
  const ratio = input.totalBlockCount === 0 ? 1 : scannedBlocks / input.totalBlockCount;
  const risk = ratio >= 0.6 ? "low" : ratio >= 0.2 ? "medium" : "high";
  return {
    block_ids: blockIds,
    coverage: {
      total_blocks: input.totalBlockCount,
      scanned_blocks: scannedBlocks,
      cited_blocks: blockIds,
      covered_sections: coveredSections,
      uncovered_sections: input.sectionCards
        .filter((card) => !coveredSections.includes(card.section_id))
        .map((card) => card.section_id),
      risk,
    },
  };
}
