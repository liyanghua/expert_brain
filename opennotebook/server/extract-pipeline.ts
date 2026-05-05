import { AgentOrchestrator } from "@ebs/agent-core";
import { emptyGroundTruthDraft, type GroundTruthDraft, type StructuredFieldKey } from "@ebs/ground-truth-schema";
import { buildRetrievalIndex } from "./retrieval.js";
import { buildFocusTasksFromAssessments, buildFieldAssessments, buildSourceViewModel, ORDERED_FIELDS } from "./workbench.js";
import {
  buildContentListFromIr,
  buildDocumentUnderstanding,
  buildEvidencePack,
  buildScopedStructuringIr,
  type NotebookDocumentUnderstanding,
  type NotebookEvidencePack,
} from "./evidence-pack.js";
import { NotebookRagClient } from "./rag-client.js";
import type { FieldAssessment, SourceViewModel } from "./workbench.js";
import type { NotebookFocusTask } from "./focus-tasks.js";
import type { DocumentIR } from "@ebs/document-ir";

export type NotebookExtractDiagnostics = {
  parse_mode: string;
  retrieval_mode: string;
  fallback_reason?: string | null;
  full_document_blocks_sent: boolean;
  evidence_pack_stats: Array<{
    field_key: string;
    total_blocks: number;
    manual_blocks: number;
    retrieval_blocks: number;
  }>;
  structuring_requests: Array<{
    field_key: string;
    block_count: number;
  }>;
};

export type NotebookExtractResult = {
  draft: GroundTruthDraft;
  source_view: SourceViewModel;
  document_understanding: NotebookDocumentUnderstanding;
  field_assessments: FieldAssessment[];
  focus_tasks: NotebookFocusTask[];
  retrieval_index: ReturnType<typeof buildRetrievalIndex>;
  evidence_packs: Record<string, NotebookEvidencePack>;
  diagnostics: NotebookExtractDiagnostics;
};

function cloneDraft(draft: GroundTruthDraft) {
  return structuredClone(draft) as GroundTruthDraft;
}

function selectDraftValue(scopedDraft: GroundTruthDraft, fieldKey: StructuredFieldKey) {
  return scopedDraft[fieldKey];
}

function applyFieldValue(target: GroundTruthDraft, fieldKey: StructuredFieldKey, value: GroundTruthDraft[StructuredFieldKey]) {
  if (value === undefined) return;
  (target as Record<string, unknown>)[fieldKey] = value;
}

function gapSeverity(status: FieldAssessment["status"]) {
  switch (status) {
    case "missing":
      return "high" as const;
    case "conflicting":
      return "high" as const;
    case "weak":
    case "inferred":
      return "medium" as const;
    case "covered":
    default:
      return "low" as const;
  }
}

function rebuildDraftGaps(draft: GroundTruthDraft, assessments: FieldAssessment[]) {
  draft.gaps = assessments
    .filter((item) => item.status !== "covered")
    .map((item) => ({
      field_key: item.field_key,
      severity: gapSeverity(item.status),
      message: item.reason,
    }));
  draft.gaps_structured = {
    missing_fields: assessments
      .filter((item) => item.status === "missing")
      .map((item) => ({ field_key: item.field_key, message: item.reason })),
    weak_fields: assessments
      .filter((item) => item.status === "weak")
      .map((item) => ({ field_key: item.field_key, message: item.reason })),
    inferred_fields: assessments
      .filter((item) => item.status === "inferred")
      .map((item) => ({ field_key: item.field_key, message: item.reason })),
    needs_confirmation_fields: assessments
      .filter((item) => item.status === "conflicting")
      .map((item) => ({ field_key: item.field_key, message: item.reason })),
  };
  draft.confidence_by_field = Object.fromEntries(
    assessments.map((item) => [
      item.field_key,
      item.status === "covered"
        ? 0.84
        : item.status === "weak"
          ? 0.58
          : item.status === "inferred"
            ? 0.46
            : 0.22,
    ]),
  );
  return draft;
}

export async function runNotebookExtractPipeline(input: {
  docId: string;
  versionId: string;
  ir: DocumentIR;
  existingDraft?: GroundTruthDraft | null;
  requestedMode?: string;
  ragClient?: NotebookRagClient;
  orchestrator?: AgentOrchestrator;
}): Promise<NotebookExtractResult> {
  const orchestrator = input.orchestrator ?? new AgentOrchestrator();
  const ragClient = input.ragClient ?? new NotebookRagClient();
  const source_view = buildSourceViewModel(input.ir);
  const retrieval_index = buildRetrievalIndex(input.ir);
  const contentList = buildContentListFromIr(input.ir);

  let parse_mode = "content_list_fallback";
  let retrieval_mode = "local_keyword";
  let fallback_reason: string | null = "sidecar_unavailable";
  try {
    if (await ragClient.health()) {
      const ingest = await ragClient.ingestContentList({
        docId: input.docId,
        versionId: input.versionId,
        contentList,
      });
      parse_mode = ingest.parse_mode;
      retrieval_mode = ingest.retrieval_mode;
      fallback_reason = ingest.fallback_reason ?? null;
    }
  } catch (error) {
    fallback_reason = error instanceof Error ? error.message : String(error);
  }

  const document_understanding = buildDocumentUnderstanding({
    ir: input.ir,
    sourceView: source_view,
    retrievalIndex: retrieval_index,
  });

  const initialDraft = cloneDraft(
    input.existingDraft ?? emptyGroundTruthDraft(input.docId, input.versionId),
  );
  const initialAssessments = buildFieldAssessments({
    draft: initialDraft,
    retrievalIndex: retrieval_index,
  });

  const evidence_packs: Record<string, NotebookEvidencePack> = {};
  const structuring_requests: NotebookExtractDiagnostics["structuring_requests"] = [];
  const evidence_pack_stats: NotebookExtractDiagnostics["evidence_pack_stats"] = [];
  const nextDraft = cloneDraft(initialDraft);

  for (const assessment of initialAssessments) {
    if (assessment.status === "missing" && assessment.evidence_block_ids.length === 0) continue;
    const pack = buildEvidencePack({
      docId: input.docId,
      versionId: input.versionId,
      ir: input.ir,
      draft: nextDraft,
      fieldKey: assessment.field_key,
      manualBlockIds: [],
      retrievalHits: retrieval_index
        .filter((entry) => (entry.keyword_scores[assessment.field_key] ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.keyword_scores[assessment.field_key] ?? 0) -
            (a.keyword_scores[assessment.field_key] ?? 0),
        )
        .slice(0, 6),
      sourceView: source_view,
      documentUnderstanding: document_understanding,
      parseMode: parse_mode,
      retrievalMode: retrieval_mode,
      fallbackReason: fallback_reason,
    });
    evidence_packs[assessment.field_key] = pack;
    evidence_pack_stats.push({
      field_key: assessment.field_key,
      total_blocks: pack.stats.total_blocks,
      manual_blocks: pack.stats.manual_blocks,
      retrieval_blocks: pack.stats.retrieval_blocks,
    });

    if (pack.blocks.length === 0) continue;
    const scopedIr = buildScopedStructuringIr({
      docId: input.docId,
      versionId: input.versionId,
      fieldKey: assessment.field_key,
      originalIr: input.ir,
      evidencePack: pack,
    });
    structuring_requests.push({
      field_key: assessment.field_key,
      block_count: scopedIr.blocks.length,
    });
    const scopedResult = await orchestrator.runA1StructuringAsync(scopedIr);
    applyFieldValue(nextDraft, assessment.field_key, selectDraftValue(scopedResult.draft, assessment.field_key));
  }

  const field_assessments = buildFieldAssessments({
    draft: rebuildDraftGaps(nextDraft, buildFieldAssessments({ draft: nextDraft, retrievalIndex: retrieval_index })),
    retrievalIndex: retrieval_index,
  });
  rebuildDraftGaps(nextDraft, field_assessments);

  return {
    draft: nextDraft,
    source_view,
    document_understanding,
    field_assessments,
    focus_tasks: buildFocusTasksFromAssessments(field_assessments),
    retrieval_index,
    evidence_packs,
    diagnostics: {
      parse_mode,
      retrieval_mode,
      fallback_reason,
      full_document_blocks_sent: false,
      evidence_pack_stats,
      structuring_requests,
    },
  };
}
