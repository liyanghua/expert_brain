import { join } from "node:path";
import { writeSemanticUnitEvaluationReport } from "../evaluation/semantic-unit-evaluator.js";
import {
  baselineUnderstandingAdapter,
  profileTableUnderstandingAdapter,
  structuredContextUnderstandingAdapter,
} from "../understanding/understanding-adapters.js";
import type { UnderstandingAdapter } from "../understanding/understanding-adapter.js";
import type { PipelineState, StepMetric, UnderstandingProfile } from "../types.js";

const UNDERSTANDING_ADAPTERS: Record<UnderstandingProfile, UnderstandingAdapter> = {
  baseline: baselineUnderstandingAdapter,
  profile_table: profileTableUnderstandingAdapter,
  structured_context: structuredContextUnderstandingAdapter,
};

export function runStep2Understanding(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  if (!state.document_ir) throw new Error("Step 2 requires document_ir");
  const profile = state.understanding_profile ?? "baseline";
  const adapter = UNDERSTANDING_ADAPTERS[profile];
  const result = adapter.understand({
    ir: state.document_ir,
    schemaProfile: state.schema_profile,
    expertGuidanceProfile: state.expert_guidance_profile,
    semanticCoherenceProfile: state.semantic_coherence_profile,
    semanticUnitEnhancementProfile: state.semantic_unit_enhancement_profile,
    semanticUnitMatchProfile: state.semantic_unit_match_profile,
    semanticUnitEvalReport: state.semantic_unit_eval_report,
  });
  const { documentMap, sectionCards, understanding, coverage } = result;
  state.document_map = documentMap;
  state.section_cards = sectionCards;
  state.structured_sections = result.structuredSections;
  state.structured_section_summaries = result.structuredSectionSummaries;
  state.document_synthesis = result.documentSynthesis;
  state.contextualized_blocks = result.contextualizedBlocks;
  state.semantic_units = result.semanticUnits;
  state.continuity_decision_trace = result.continuityDecisionTrace;
  state.semantic_segments = result.semanticSegments;
  state.block_role_map = result.blockRoleMap;
  state.section_evidence_hints = result.evidenceHints;
  state.document_understanding = understanding;
  const semanticUnitEvaluationReport = result.extraArtifacts?.semantic_unit_evaluation_report;
  if (semanticUnitEvaluationReport && typeof semanticUnitEvaluationReport === "object") {
    writeSemanticUnitEvaluationReport({
      outputDir: join(process.cwd(), "apps/agent-mode-runner/report"),
      report: semanticUnitEvaluationReport as Parameters<typeof writeSemanticUnitEvaluationReport>[0]["report"],
    });
  }
  return {
    artifacts: {
      document_map: documentMap,
      section_cards: sectionCards,
      document_understanding: understanding,
      "coverage.step2": coverage,
      ...(result.extraArtifacts ?? {}),
    },
    metrics: result.metrics,
  };
}
