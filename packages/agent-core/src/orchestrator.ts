import type { DocumentIR } from "@ebs/document-ir";
import type {
  ExpertMemory,
  GroundTruthDraft,
  SuggestionRecord,
  VersionActionResponse,
} from "@ebs/ground-truth-schema";
import { textDiff } from "@ebs/diff-engine";
import { heuristicSuggestionsForBlock } from "@ebs/suggestions";
import {
  evaluatePublishReadiness,
  runDocQAAsync,
  runQuestionRefinementAsync,
  runDocQA,
  runGapDetection,
  runStructuring,
} from "./agents.js";
import type {
  StructuringDiagnostics,
  StructuringMode,
} from "./structuring-llm.js";
import { runStructuringWithLlmOrFallback } from "./structuring-llm.js";

export type AgentMode =
  | "QA"
  | "Suggest"
  | "Rewrite"
  | "Add Missing Field"
  | "Explain Mapping";

export class AgentOrchestrator {
  runA1Structuring(ir: DocumentIR): GroundTruthDraft {
    return runStructuring(ir);
  }

  async runA1StructuringAsync(ir: DocumentIR): Promise<{
    draft: GroundTruthDraft;
    structuring_mode: StructuringMode;
    diagnostics: StructuringDiagnostics;
  }> {
    return runStructuringWithLlmOrFallback(ir);
  }

  runA2QA(
    ir: DocumentIR,
    draft: GroundTruthDraft,
    blockId: string | null,
    question: string,
    targetField?: string | null,
  ) {
    return runDocQA({ ir, draft, blockId, question, targetField });
  }

  async runA2QAAsync(input: {
    ir: DocumentIR;
    draft: GroundTruthDraft;
    blockId: string | null;
    evidenceBlockIds?: string[];
    question: string;
    questionSeed?: string | null;
    gapReason?: string | null;
    targetField?: string | null;
    metric?: string | null;
    expertMemory?: ExpertMemory;
  }) {
    return runDocQAAsync(input);
  }

  async runA2QuestionRefinementAsync(input: {
    ir: DocumentIR;
    draft: GroundTruthDraft;
    blockId: string | null;
    evidenceBlockIds?: string[];
    questionSeed?: string | null;
    gapReason?: string | null;
    targetField?: string | null;
    metric?: string | null;
    expertMemory?: ExpertMemory;
  }) {
    return runQuestionRefinementAsync(input);
  }

  runA3Suggestions(ir: DocumentIR, blockId: string): SuggestionRecord[] {
    return heuristicSuggestionsForBlock(ir, blockId);
  }

  runA5Gaps(draft: GroundTruthDraft) {
    return runGapDetection(draft);
  }

  runA6Publish(draft: GroundTruthDraft) {
    return evaluatePublishReadiness(draft);
  }

  /** A4 — apply accepted suggestion text into draft field or conceptual merge (MVP). */
  applySuggestionToDraft(
    draft: GroundTruthDraft,
    suggestion: SuggestionRecord,
    editedText?: string,
  ): { draft: GroundTruthDraft; summary: string } {
    const text = editedText ?? suggestion.suggestion_text;
    const targetField = suggestion.target_field ?? "business_scenario";
    const next = structuredClone(draft) as GroundTruthDraft;
    const item = {
      content: { applied_suggestion: text, from: suggestion.suggestion_id },
      status: "Drafted" as const,
      confidence: 0.55,
      source_refs: suggestion.source_refs,
    };
    if (targetField === "deliverables") {
      next.deliverables = [...next.deliverables, item];
    } else if (targetField in next && targetField !== "gaps") {
      (next as Record<string, unknown>)[targetField] = item;
    } else {
      next.business_scenario = item;
    }
    const summary = `Applied suggestion ${suggestion.suggestion_id} to ${targetField}`;
    return { draft: next, summary };
  }

  summarizeVersionDiff(prevText: string, nextText: string): string {
    return textDiff(prevText, nextText).slice(0, 4000);
  }

  versionActionStub(newVersionId: string): VersionActionResponse {
    return {
      new_version_id: newVersionId,
      summary_of_changes: "New snapshot created",
      affected_fields: [],
      diff_available: true,
    };
  }
}

export * from "./agents.js";
