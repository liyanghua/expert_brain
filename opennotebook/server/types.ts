import type { DocumentIR } from "@ebs/document-ir";
import type {
  DocumentStatus,
  ExpertMemory,
  ExpertNote,
  GTCandidate,
  GroundTruthDraft,
  PublishReadinessResponse,
  QAResponse,
  QuestionRefinementResponse,
  TaskThread,
  VersionRecord,
} from "@ebs/ground-truth-schema";
import type { NotebookFocusTask } from "./focus-tasks.js";
import type { RetrievalIndexEntry } from "./retrieval.js";
import type {
  FieldAssessment,
  SourceViewModel,
} from "./workbench.js";
import type {
  NotebookDocumentUnderstanding,
  NotebookEvidencePack,
} from "./evidence-pack.js";
import type { SourceViewModel as SourceViewModelType } from "./workbench.js";
import type { TaskThreadStatus } from "@ebs/ground-truth-schema";

export type NotebookDocumentMeta = {
  doc_id: string;
  title: string;
  document_status: DocumentStatus;
  current_version_id: string;
  sources: { file_id: string; filename: string; stored_path: string }[];
  suggestion_ids: string[];
  audit: { at: string; action: string; detail?: string }[];
};

export type NotebookDashboardResponse = {
  meta: NotebookDocumentMeta;
  ir: DocumentIR | null;
  draft: GroundTruthDraft | null;
  source_view: SourceViewModel | null;
  document_understanding: NotebookDocumentUnderstanding | null;
  field_assessments: FieldAssessment[];
  focus_tasks: NotebookFocusTask[];
  improvement_plan: unknown | null;
  threads: TaskThread[];
  task_sessions: NotebookTaskSession[];
  notes: ExpertNote[];
  candidates: GTCandidate[];
  versions: VersionRecord[];
  readiness: PublishReadinessResponse | null;
  expert_memory: ExpertMemory;
};

export type CachedDocArtifacts = {
  source_view: SourceViewModel | null;
  document_understanding: NotebookDocumentUnderstanding | null;
  field_assessments: FieldAssessment[];
  focus_tasks: NotebookFocusTask[];
  improvement_plan: unknown | null;
  scorecard: unknown | null;
  readiness: PublishReadinessResponse | null;
  retrieval_index: RetrievalIndexEntry[];
  evidence_pack_cache: Record<string, NotebookEvidencePack>;
  diagnostics: {
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
  } | null;
};

export type NotebookTaskSession = {
  thread_id: string;
  task_id: string;
  field_key: string | null;
  title: string;
  status: TaskThreadStatus;
  source_block_ids: string[];
  recommended_question?: string;
  evidence_pack?: NotebookEvidencePack | null;
  source_view?: SourceViewModelType | null;
};

export type QaAgentRefineInput = {
  ir: DocumentIR;
  draft: GroundTruthDraft;
  targetField?: string | null;
  evidenceBlockIds: string[];
  blockId: string | null;
  questionSeed?: string | null;
  gapReason?: string | null;
  metric?: string | null;
  expertMemory: ExpertMemory;
  threadHistorySummary: string;
  evidencePackSummary?: string | null;
};

export type QaAgentAnswerInput = {
  ir: DocumentIR;
  draft: GroundTruthDraft;
  targetField?: string | null;
  evidenceBlockIds: string[];
  blockId: string | null;
  question: string;
  questionSeed?: string | null;
  gapReason?: string | null;
  metric?: string | null;
  expertMemory: ExpertMemory;
  threadHistorySummary: string;
  evidencePackSummary?: string | null;
};

export type NotebookQaAgent = {
  refineQuestion(input: QaAgentRefineInput): Promise<QuestionRefinementResponse>;
  answerQuestion(input: QaAgentAnswerInput): Promise<QAResponse>;
  proposeWriteback(input: {
    qa: QAResponse;
    requestedTargetField?: string | null;
    evidenceBlockIds: string[];
    question: string;
  }): {
    fieldKey: string;
    content: unknown;
    sourceBlockIds: string[];
  };
};
