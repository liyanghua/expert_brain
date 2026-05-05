import type { DocumentIR } from "@ebs/document-ir";
import type {
  ExpertNote,
  ExpertMemory,
  GTCandidate,
  GroundTruthDraft,
  PublishReadinessResponse,
  QAResponse,
  QuestionRefinementResponse,
  TaskThread,
  VersionActionResponse,
  VersionRecord,
} from "@ebs/ground-truth-schema";
import type { NotebookDashboardResponse } from "../../server/types.js";
import type { NotebookTaskSession } from "../../server/types.js";
import type { NotebookFocusTask } from "../../server/focus-tasks.js";

const API_PREFIX = "/api";

async function handleJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export type DocumentMeta = {
  doc_id: string;
  title: string;
  document_status: string;
  current_version_id: string;
  audit: { at: string; action: string; detail?: string }[];
};

export type CandidateQuestion = {
  metric: string;
  metric_label: string;
  question: string;
  target_field?: string;
  source_block_id?: string;
};

export type ImprovementPlan = {
  document_id: string;
  version_id: string;
  priority_actions: Array<{
    metric: string;
    reason: string;
    actions: string[];
    metric_display_name?: string;
    actions_display?: string[];
  }>;
  candidate_questions: CandidateQuestion[];
};

export type ExtractResponse = {
  draft: GroundTruthDraft;
  improvement_plan?: ImprovementPlan;
  scorecard?: unknown;
  global_quality_triage?: unknown;
  document_understanding?: unknown;
  field_assessments?: unknown;
  focus_tasks?: NotebookFocusTask[];
  structuring_diagnostics?: unknown;
};

export type ThreadsResponse = { threads: TaskThread[] };
export type NotesResponse = { notes: ExpertNote[] };
export type CandidatesResponse = { candidates: GTCandidate[] };
export type VersionsResponse = {
  current_version_id: string;
  versions: VersionRecord[];
};

export type FocusTasksResponse = {
  focus_tasks: NotebookFocusTask[];
};

export async function createDocument(title: string) {
  return handleJson<DocumentMeta>(
    await fetch(`${API_PREFIX}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

export async function uploadSource(docId: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  return handleJson<DocumentMeta & { job_id: string }>(
    await fetch(`${API_PREFIX}/documents/${docId}/sources`, {
      method: "POST",
      body: form,
    }),
  );
}

export async function processNextJob(docId: string) {
  return handleJson<{ ok: boolean }>(
    await fetch(`${API_PREFIX}/documents/${docId}/jobs/process-next`, {
      method: "POST",
    }),
  );
}

export async function runExtract(docId: string) {
  return handleJson<ExtractResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "deep" }),
    }),
  );
}

export async function getDocument(docId: string) {
  return handleJson<DocumentMeta>(await fetch(`${API_PREFIX}/documents/${docId}`));
}

export async function getDashboard(docId: string) {
  return handleJson<NotebookDashboardResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/dashboard`),
  );
}

export async function getIR(docId: string) {
  return handleJson<DocumentIR>(await fetch(`${API_PREFIX}/documents/${docId}/ir`));
}

export async function getDraft(docId: string) {
  return handleJson<GroundTruthDraft>(await fetch(`${API_PREFIX}/documents/${docId}/draft`));
}

export async function getImprovementPlan(docId: string) {
  return handleJson<ImprovementPlan>(
    await fetch(`${API_PREFIX}/documents/${docId}/improvement-plan`),
  );
}

export async function getFocusTasks(docId: string) {
  return handleJson<FocusTasksResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/focus-tasks`),
  );
}

export async function getThreads(docId: string) {
  return handleJson<ThreadsResponse>(await fetch(`${API_PREFIX}/documents/${docId}/threads`));
}

export async function getNotes(docId: string) {
  return handleJson<NotesResponse>(await fetch(`${API_PREFIX}/documents/${docId}/notes`));
}

export async function getCandidates(docId: string) {
  return handleJson<CandidatesResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/gt-candidates`),
  );
}

export async function createThread(input: {
  docId: string;
  title: string;
  fieldKey?: string | null;
  sourceBlockIds?: string[];
  recommendedQuestion?: string;
}) {
  return handleJson<TaskThread>(
    await fetch(`${API_PREFIX}/documents/${input.docId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        field_key: input.fieldKey,
        source_block_ids: input.sourceBlockIds ?? [],
        recommended_question: input.recommendedQuestion,
      }),
    }),
  );
}

export async function focusTaskSession(input: {
  docId: string;
  taskId: string;
  title: string;
  fieldKey?: string | null;
  sourceBlockIds?: string[];
  recommendedQuestion?: string;
}) {
  return handleJson<{
    thread: TaskThread;
    reused: boolean;
    task_session: NotebookTaskSession;
  }>(
    await fetch(`${API_PREFIX}/documents/${input.docId}/tasks/${input.taskId}/focus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        field_key: input.fieldKey,
        source_block_ids: input.sourceBlockIds ?? [],
        recommended_question: input.recommendedQuestion,
      }),
    }),
  );
}

export async function refineQuestion(input: {
  docId: string;
  threadId?: string | null;
  targetField?: string | null;
  evidenceBlockIds?: string[];
  questionSeed?: string;
  gapReason?: string;
}) {
  return handleJson<QuestionRefinementResponse & { thread_id: string }>(
    await fetch(`${API_PREFIX}/documents/${input.docId}/qa/refine-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: input.threadId,
        target_field: input.targetField,
        source_block_ids: input.evidenceBlockIds ?? [],
        question_seed: input.questionSeed,
        gap_reason: input.gapReason,
      }),
    }),
  );
}

export async function askQa(input: {
  docId: string;
  threadId?: string | null;
  targetField?: string | null;
  evidenceBlockIds?: string[];
  questionSeed?: string;
  question: string;
  gapReason?: string;
}) {
  return handleJson<QAResponse & { thread_id: string; gt_candidate?: GTCandidate | null }>(
    await fetch(`${API_PREFIX}/documents/${input.docId}/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: input.threadId,
        target_field: input.targetField,
        source_block_ids: input.evidenceBlockIds ?? [],
        question_seed: input.questionSeed,
        question: input.question,
        gap_reason: input.gapReason,
      }),
    }),
  );
}

export async function saveNote(input: {
  docId: string;
  threadId?: string | null;
  content: string;
  sourceBlockIds?: string[];
}) {
  return handleJson<ExpertNote>(
    await fetch(`${API_PREFIX}/documents/${input.docId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: input.threadId,
        content: input.content,
        source_block_ids: input.sourceBlockIds ?? [],
      }),
    }),
  );
}

export async function confirmCandidate(input: {
  docId: string;
  candidateId: string;
  editedText?: string;
  mode?: "append" | "replace";
}) {
  return handleJson<{
    candidate: GTCandidate;
    draft: GroundTruthDraft;
    scorecard?: unknown;
    improvement_plan?: ImprovementPlan | null;
  }>(
    await fetch(
      `${API_PREFIX}/documents/${input.docId}/gt-candidates/${input.candidateId}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edited_text: input.editedText,
          mode: input.mode ?? "append",
        }),
      },
    ),
  );
}

export async function createVersion(docId: string) {
  return handleJson<VersionActionResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/versions`, {
      method: "POST",
    }),
  );
}

export async function getVersions(docId: string) {
  return handleJson<VersionsResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/versions`),
  );
}

export async function getPublishReadiness(docId: string) {
  return handleJson<PublishReadinessResponse>(
    await fetch(`${API_PREFIX}/documents/${docId}/publish-readiness`),
  );
}

export async function getExpertMemory(docId: string) {
  return handleJson<ExpertMemory>(
    await fetch(`${API_PREFIX}/documents/${docId}/expert-memory`),
  );
}

export async function updateExpertMemory(input: {
  docId: string;
  profile: Record<string, unknown>;
}) {
  return handleJson<ExpertMemory>(
    await fetch(`${API_PREFIX}/documents/${input.docId}/expert-memory`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: input.profile }),
    }),
  );
}
