import type { DocumentUnderstanding, SectionCard } from "../types.js";

export function synthesizeDocumentUnderstanding(
  sectionCards: SectionCard[],
): DocumentUnderstanding {
  const first = sectionCards[0];
  const keySignals = [...new Set(sectionCards.flatMap((card) => card.key_signals))].slice(
    0,
    10,
  );
  const likelyGaps = [...new Set(sectionCards.flatMap((card) => card.likely_gaps))];
  const avgConfidence =
    sectionCards.length === 0
      ? 0
      : sectionCards.reduce((sum, card) => sum + card.confidence, 0) /
        sectionCards.length;

  return {
    document_theme: first?.title ?? "未命名文档",
    business_scene: keySignals.includes("场景") ? "业务场景文档" : "业务知识文档",
    primary_goal: first?.summary ?? "从文档中抽取可复用的业务知识",
    section_summaries: sectionCards,
    key_signals: keySignals,
    likely_gaps: likelyGaps,
    confidence: Number(avgConfidence.toFixed(2)),
  };
}
