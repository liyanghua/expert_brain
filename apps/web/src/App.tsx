import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { DocumentIR } from "@ebs/document-ir";
import type {
  ExpertNote,
  GTCandidate,
  GlobalQualityTriage,
  GroundTruthDraft,
  GroundTruthFieldItem,
  SuggestionRecord,
  TaskThread,
  ThreadStep,
} from "@ebs/ground-truth-schema";
import {
  FIELD_DEFINITIONS_ZH,
  GROUND_TRUTH_FIELD_KEYS,
  MAX_PRIMARY_TASKS,
} from "@ebs/ground-truth-schema";

const api = (path: string) => `/api${path}`;

type EvalScorecard = {
  mode?: string;
  scores: Record<string, number | null | undefined>;
  threshold_check?: Record<string, string>;
  metric_definitions?: Record<
    string,
    {
      label: string;
      meaning: string;
      calculation: string;
      thresholds: string;
      low_score_reason: string;
    }
  >;
  overall_status: string;
};

type PublishInfo = {
  readiness_status: "ready" | "not_ready" | "blocked";
  blocking_issues: string[];
  completeness_summary: Record<string, number>;
  review_summary: string;
};

type EvalPlan = {
  priority_actions: {
    metric: string;
    metric_display_name?: string;
    reason: string;
    actions: string[];
    actions_display?: string[];
  }[];
  candidate_questions?: CandidateQuestion[];
};

type CandidateQuestion = {
  metric: string;
  metric_label: string;
  question: string;
  target_field?: string;
  source_block_id?: string;
};

type ParseDiagnostics = {
  block_count?: number;
  block_counts?: Record<string, number>;
  has_section_hierarchy?: boolean;
  table_line_counts?: number[];
  likely_issues?: string[];
};

type StructuringDiagnostics = {
  attempts?: {
    stage:
      | "global_triage"
      | "knowledge_skeleton"
      | "draft"
      | "strict_retry"
      | "rules";
    status: "ok" | "failed" | "skipped";
    reason?: string;
    message?: string;
    label?: string;
    provider?: string;
    model?: string;
    timeout_ms?: number;
    request_params?: Record<string, unknown>;
    system_prompt_chars?: number;
    user_prompt_chars?: number;
    system_prompt?: string;
    user_prompt?: string;
    elapsed_ms?: number;
  }[];
  llm_failure_reason?: string;
  llm_failure_message?: string;
  schema_issues?: string[];
  quality_issues?: string[];
};

type LlmDebugDiagnostics = {
  label?: string;
  stage?: string;
  provider?: string;
  model?: string;
  timeout_ms?: number;
  request_params?: Record<string, unknown>;
  system_prompt_chars?: number;
  user_prompt_chars?: number;
  system_prompt?: string;
  user_prompt?: string;
  elapsed_ms?: number;
  status?: "ok" | "failed" | "skipped";
  reason?: string;
  message?: string;
};

type LlmDebugEntry = LlmDebugDiagnostics & {
  id: string;
  at: string;
  source: "quality" | "refine" | "qa";
};

type ExtractResponse = {
  draft: GroundTruthDraft;
  scorecard?: EvalScorecard;
  improvement_plan?: EvalPlan;
  structuring_mode?: string;
  quality_triage_mode?: string;
  global_quality_triage?: GlobalQualityTriage;
  parse_diagnostics?: ParseDiagnostics;
  structuring_diagnostics?: StructuringDiagnostics;
};

type QAResponse = {
  refined_question?: string;
  direct_answer: string;
  rationale: string;
  source_block_refs: string[];
  next_step_suggestion?: string;
  target_field?: string | null;
  suggested_writeback?: {
    field_key: string;
    content: unknown;
  } | null;
  thread_id?: string;
  gt_candidate?: GTCandidate | null;
  llm_diagnostics?: LlmDebugDiagnostics;
};

type QuestionRefinementResponse = {
  refined_question: string;
  context_summary: string;
  source_block_refs: string[];
  rationale: string;
  thread_id?: string;
  llm_diagnostics?: LlmDebugDiagnostics;
};

type ApplyQaResponse = {
  draft: GroundTruthDraft;
  field_key: string;
  updated_field?: string;
  updated_item?: GroundTruthFieldItem;
  audit_entry?: { at: string; action: string; detail?: string };
  scorecard?: EvalScorecard;
  improvement_plan?: EvalPlan;
};

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt?: string;
  qa?: QAResponse;
  question?: string;
  blockId?: string | null;
  targetField?: string | null;
  status?: "pending" | "error";
};

type FieldQualityRow = {
  fieldKey: string;
  label: string;
  definition: string;
  status: "covered" | "missing" | "weak_source" | "needs_confirmation";
  statusLabel: string;
  items: GroundTruthFieldItem[];
  sourceBlockIds: string[];
  gaps: { field_key: string; message: string; severity?: string }[];
  candidateQuestions: CandidateQuestion[];
  reason: string;
};

type RecommendedTaskRow = {
  id: string;
  title: string;
  reason: string;
  question: string;
  targetField?: string | null;
  sourceBlockIds: string[];
  status: "pending" | "active" | "completed";
  origin: "quality" | "field" | "global";
};

type QaContextSource =
  | "none"
  | "raw_block"
  | "task"
  | "field"
  | "candidate"
  | "question";

type QaContextMode = "direct_qa" | "task_refine_then_qa";

type QaContext = {
  source: QaContextSource;
  mode: QaContextMode;
  blockId: string | null;
  targetField?: string | null;
  metric?: string | null;
  evidenceBlockIds?: string[];
  questionSeed?: string;
  gapReason?: string | null;
  threadId?: string | null;
};

type ActiveWorkbenchContext = {
  source: QaContextSource;
  mode: QaContextMode;
  title: string;
  fieldKey?: string | null;
  blockId?: string | null;
  evidenceBlockIds: string[];
  recommendedQuestion?: string;
  gapReason?: string | null;
  metric?: string | null;
  threadId?: string | null;
};

type FocusContext = {
  kind: "none" | "field" | "gap" | "block";
  fieldKey?: string | null;
  blockId?: string | null;
  gapMessage?: string;
  evidenceBlockIds: string[];
  recommendedQuestion?: string;
  metric?: string | null;
};

type MetricTableRow = {
  name: string;
  definition: string;
  value: string;
  status?: string;
};

type VersionRecord = {
  version_id: string;
  parent_version_id: string | null;
  change_summary: string;
  created_by: string;
  created_at: string;
};

type VersionListResponse = {
  current_version_id: string;
  versions: VersionRecord[];
};

type ScoreCompareResponse = {
  delta_scores: Record<string, number | null>;
  summary_zh: string;
};

type ThreadListResponse = {
  threads: TaskThread[];
};

type GTCandidateListResponse = {
  candidates: GTCandidate[];
};

type ExpertNoteListResponse = {
  notes: ExpertNote[];
};

type LlmProgressStatus = "idle" | "running" | "success" | "error";

type LlmProgress = {
  status: LlmProgressStatus;
  stepIndex: number;
  startedAt?: number;
  elapsedMs: number;
  message: string;
  diagnostics?: StructuringDiagnostics;
  parseDiagnostics?: ParseDiagnostics;
  globalQualityTriage?: GlobalQualityTriage;
};

type QuestionRefineProgress = {
  status: LlmProgressStatus;
  stepIndex: number;
  startedAt?: number;
  elapsedMs: number;
  message: string;
  contextSummary?: string;
  sourceBlockRefs?: string[];
  rationale?: string;
};

type ConversationEvent =
  | {
      id: string;
      kind: "turn";
      at: string;
      sort: number;
      thread: TaskThread;
      questionStep?: ThreadStep;
      answerStep?: ThreadStep;
      candidate?: GTCandidate;
      writebackStep?: ThreadStep;
      completionStep?: ThreadStep;
    }
  | {
      id: string;
      kind: "step";
      at: string;
      sort: number;
      thread: TaskThread;
      step: ThreadStep;
    }
  | {
      id: string;
      kind: "candidate";
      at: string;
      sort: number;
      candidate: GTCandidate;
    }
  | {
      id: string;
      kind: "note";
      at: string;
      sort: number;
      note: ExpertNote;
    }
  | {
      id: string;
      kind: "message";
      at: string;
      sort: number;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "question_refine_progress";
      at: string;
      sort: number;
      progress: QuestionRefineProgress;
    }
  | {
      id: string;
      kind: "quality_progress";
      at: string;
      sort: number;
      progress: LlmProgress;
    };

type ParseStatus = "idle" | "uploading" | "processing" | "waiting_ir" | "ready";

const LLM_STEPS = [
  "读取文档结构",
  "发现主要质量缺口",
  "生成推荐任务",
] as const;

const QUESTION_REFINE_STEPS = [
  "读取证据 block",
  "理解缺口与目标字段",
  "改写成专家可确认的问题",
  "等待专家确认",
] as const;

const idleLlmProgress: LlmProgress = {
  status: "idle",
  stepIndex: 0,
  elapsedMs: 0,
  message: "等待质量检测",
};

const idleQuestionRefineProgress: QuestionRefineProgress = {
  status: "idle",
  stepIndex: 0,
  elapsedMs: 0,
  message: "等待生成追问草稿",
};

const METRIC_CHIP_LABELS: Record<string, string> = {
  field_coverage: "字段完整度",
  source_grounding_rate: "出处绑定",
  structural_consistency: "结构一致性",
  gap_detection_accuracy: "缺口检测",
  inference_handling_accuracy: "推断确认",
  human_revision_rate: "人工修订",
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson<T>(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("QA Agent 响应超时，请稍后重试或缩短问题上下文。");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_DEFINITIONS_ZH).map(([key, definition]) => [
    key,
    definition.label,
  ]),
);

const ENGLISH_WORDING_HINTS: Record<string, string> = {
  methodology: "诊断方法",
  method: "诊断方法",
  diagnostic: "诊断方法",
  diagnosis: "诊断方法",
  pre_listing: "上架前诊断",
  listing: "上架前诊断",
  step: "执行步骤",
  workflow: "执行流程",
  criteria: "判断标准",
  standard: "判断标准",
  validation: "验证方法",
  deliverable: "输出成果",
  audience: "适用对象",
  problem: "问题定义",
  growth: "增长目标",
};

const emptyFocusContext: FocusContext = {
  kind: "none",
  evidenceBlockIds: [],
};

const emptyWorkbenchContext: ActiveWorkbenchContext = {
  source: "none",
  mode: "direct_qa",
  title: "未选择上下文",
  evidenceBlockIds: [],
};

function uniqueStrings(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function summarizeContent(content: unknown, maxLength = 260) {
  const text =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  if (!text) return "—";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function looksLikeInternalOrEnglish(text: string) {
  if (!text) return false;
  if (/global_triage|structuring|fallback|schema|prompt|model|stage/i.test(text)) {
    return true;
  }
  const latinChars = (text.match(/[A-Za-z]/g) ?? []).length;
  const cjkChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return latinChars > 12 && latinChars > cjkChars * 2;
}

function friendlyFieldLabel(fieldKey?: string | null) {
  if (!fieldKey) return "当前要素";
  if (FIELD_LABELS[fieldKey]) return FIELD_LABELS[fieldKey];
  const normalized = fieldKey.toLowerCase().replace(/[-\s]+/g, "_");
  for (const [hint, label] of Object.entries(ENGLISH_WORDING_HINTS)) {
    if (normalized.includes(hint)) return label;
  }
  return "当前要素";
}

function friendlyTaskTitle(input: {
  title?: string | null;
  targetField?: string | null;
  fallback?: string;
}) {
  const title = input.title?.trim();
  if (title && !looksLikeInternalOrEnglish(title)) return title;
  const fieldLabel = friendlyFieldLabel(input.targetField);
  return input.fallback ?? `补强“${fieldLabel}”`;
}

function friendlyReason(input: {
  reason?: string | null;
  fieldKey?: string | null;
  fallback?: string;
}) {
  const reason = input.reason?.trim();
  if (reason && !looksLikeInternalOrEnglish(reason)) return reason;
  return (
    input.fallback ??
    `这里还需要补充“${friendlyFieldLabel(input.fieldKey)}”的判断依据、步骤或可直接写入的内容。`
  );
}

function friendlyQuestion(input: {
  question?: string | null;
  fieldKey?: string | null;
  fallback?: string;
}) {
  const question = input.question?.trim();
  if (question && !looksLikeInternalOrEnglish(question)) return question;
  return (
    input.fallback ??
    `请结合当前原文证据，补充“${friendlyFieldLabel(input.fieldKey)}”可以写入结构化草稿的内容。`
  );
}

function llmDiagnosticSummary(
  diagnostic?: Pick<LlmDebugDiagnostics, "status" | "reason" | "message">,
) {
  if (!diagnostic) return "";
  const status = diagnostic.status ? `status=${diagnostic.status}` : "";
  const reason = diagnostic.reason ? `reason=${diagnostic.reason}` : "";
  const message = diagnostic.message ? `message=${diagnostic.message}` : "";
  return [status, reason, message].filter(Boolean).join(" · ");
}

function qaErrorMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  let body = raw;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        llm_diagnostics?: LlmDebugDiagnostics;
        error?: string;
        message?: string;
      };
      const summary = llmDiagnosticSummary(parsed.llm_diagnostics);
      if (summary) return `QA 失败：${summary}`;
      body = parsed.message ?? parsed.error ?? raw;
    } catch {
      body = raw;
    }
  }
  if (/响应超时|timeout|AbortError/i.test(body)) {
    return `QA 失败：请求超时。${body}`;
  }
  if (/empty_response|empty message|空响应/i.test(body)) {
    return `QA 失败：模型空响应。${body}`;
  }
  if (/schema_validation_error|QAResponseSchema|schema/i.test(body)) {
    return `QA 失败：模型返回结构校验失败。${body}`;
  }
  if (/^\d{3}\s/.test(body) || /HTTP/i.test(body)) {
    return `QA 失败：后端 HTTP 错误。${body}`;
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(body)) {
    return `QA 失败：前端请求未成功发出或网络异常。${body}`;
  }
  return `QA 失败：${body}`;
}

function friendlyQualitySummary(progress: LlmProgress) {
  if (progress.status === "running") return progress.message;
  if (progress.status === "error") return progress.message;
  const triage = progress.globalQualityTriage;
  if (!triage) return "质量检测已完成，我会把优先补强点整理成任务，方便逐项处理。";
  const points = [
    ...(triage.recommended_tasks ?? []).map((task) =>
      friendlyTaskTitle({
        title: task.title,
        targetField: task.target_field,
      }),
    ),
    ...(triage.major_gaps ?? []).map((gap) =>
      friendlyTaskTitle({
        title: gap.message,
        targetField: gap.field_key,
        fallback: `补强“${friendlyFieldLabel(gap.field_key)}”`,
      }),
    ),
  ]
    .filter(Boolean)
    .slice(0, 3);
  if (points.length === 0) {
    return "质量检测已完成，当前没有发现必须优先处理的全局缺口。";
  }
  return `我发现 ${points.length} 个优先补强点：${points.join("、")}。`;
}

function stepLabel(step: ThreadStep) {
  const labels: Record<ThreadStep["type"], string> = {
    task_started: "建议处理的任务",
    question_suggested: "追问草稿已生成",
    question_edited: "你调整了问题",
    question_sent: "你提问",
    agent_answered: "Agent 回答",
    note_saved: "保存为专家笔记",
    gt_candidate_created: "生成候选补充内容",
    writeback_confirmed: "已写入结构化草稿",
    writeback_rejected: "暂不采用候选内容",
    task_completed: "处理完成",
  };
  return labels[step.type] ?? step.type;
}

function stepSummary(step: ThreadStep) {
  const payload = step.payload as Record<string, unknown>;
  if (step.type === "task_started") {
    const fieldKey = typeof payload.field_key === "string" ? payload.field_key : null;
    const question =
      typeof payload.recommended_question === "string"
        ? payload.recommended_question
        : null;
    return `建议先围绕“${friendlyFieldLabel(fieldKey)}”补齐信息。${
      question ? `推荐追问：${friendlyQuestion({ question, fieldKey })}` : ""
    }`;
  }
  if (step.type === "question_suggested") {
    return "草稿已写入输入框，可编辑确认后发送。";
  }
  if (step.type === "task_completed") {
    const fieldKey = typeof payload.field_key === "string" ? payload.field_key : null;
    return `“${friendlyFieldLabel(fieldKey)}”已完成一次写回，可以继续处理下一个任务。`;
  }
  const value =
    payload.refined_question ??
    payload.question ??
    payload.answer ??
    payload.content ??
    payload.candidate_id ??
    payload.field_key ??
    payload.rationale ??
    payload;
  return summarizeContent(value, 320);
}

function dateToSort(value: string | undefined, fallback = 0) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function candidateStatusLabel(status: GTCandidate["status"]) {
  const labels: Record<GTCandidate["status"], string> = {
    draft: "待确认",
    confirmed: "已写入",
    rejected: "暂不采用",
    edited: "已编辑",
  };
  return labels[status] ?? status;
}

function sourceBlockSummary(candidate: GTCandidate) {
  return (
    candidate.source_refs
      .map((ref) => ref.block_id)
      .filter(Boolean)
      .join(", ") || "暂无来源 block"
  );
}

type LeftMode = "original" | "structured" | "compare";
type DrawerTab = "suggestions" | "diff" | "fields" | "audit" | "eval";
type PagePhase =
  | "empty"
  | "imported"
  | "extracted"
  | "qa"
  | "suggestions"
  | "version";

export function App() {
  const [docId, setDocId] = useState<string | null>(null);
  const [title, setTitle] = useState("未命名文档");
  const [meta, setMeta] = useState<{
    document_status: string;
    current_version_id: string;
    audit: { at: string; action: string; detail?: string }[];
  } | null>(null);
  const [ir, setIr] = useState<DocumentIR | null>(null);
  const [draft, setDraft] = useState<GroundTruthDraft | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [focusContext, setFocusContext] =
    useState<FocusContext>(emptyFocusContext);
  const [activeWorkbenchContext, setActiveWorkbenchContext] =
    useState<ActiveWorkbenchContext>(emptyWorkbenchContext);
  const [leftMode, setLeftMode] = useState<LeftMode>("original");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("suggestions");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingAnswer, setEditingAnswer] = useState("");
  const [writebackTargets, setWritebackTargets] = useState<Record<string, string>>(
    {},
  );
  const [writebackModes, setWritebackModes] = useState<
    Record<string, "append" | "replace">
  >({});
  const [writebackStatus, setWritebackStatus] = useState<
    Record<string, "idle" | "running" | "success" | "error">
  >({});
  const [input, setInput] = useState("");
  const [qaContext, setQaContext] = useState<QaContext>({
    source: "none",
    mode: "direct_qa",
    blockId: null,
  });
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>([]);
  const [publishInfo, setPublishInfo] = useState<PublishInfo | null>(null);
  const [diffPreview, setDiffPreview] = useState<string>("");
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [scoreCompare, setScoreCompare] = useState<ScoreCompareResponse | null>(
    null,
  );
  const [threads, setThreads] = useState<TaskThread[]>([]);
  const [gtCandidates, setGtCandidates] = useState<GTCandidate[]>([]);
  const [expertNotes, setExpertNotes] = useState<ExpertNote[]>([]);
  const [candidateEdits, setCandidateEdits] = useState<Record<string, string>>({});
  const [candidateModes, setCandidateModes] = useState<
    Record<string, "append" | "replace">
  >({});
  const [candidateStatus, setCandidateStatus] = useState<
    Record<string, "idle" | "running" | "success" | "error">
  >({});
  const [noteDraft, setNoteDraft] = useState("");
  const [phase, setPhase] = useState<PagePhase>("empty");
  const [saveHint, setSaveHint] = useState("Saved");
  const [scorecard, setScorecard] = useState<EvalScorecard | null>(null);
  const [improvementPlan, setImprovementPlan] = useState<EvalPlan | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isQaRunning, setIsQaRunning] = useState(false);
  const [parseStatus, setParseStatus] = useState<ParseStatus>("idle");
  const [llmProgress, setLlmProgress] =
    useState<LlmProgress>(idleLlmProgress);
  const [questionRefineProgress, setQuestionRefineProgress] =
    useState<QuestionRefineProgress>(idleQuestionRefineProgress);
  const [statusbarExpanded, setStatusbarExpanded] = useState(false);
  const [llmDebugOpen, setLlmDebugOpen] = useState(false);
  const [llmDebugEntries, setLlmDebugEntries] = useState<LlmDebugEntry[]>([]);
  const [leftPanePercent, setLeftPanePercent] = useState(58);
  const [bottomDrawerHeight, setBottomDrawerHeight] = useState(240);
  const [autoFollowConversation, setAutoFollowConversation] = useState(true);
  const [hasUnseenConversationUpdate, setHasUnseenConversationUpdate] =
    useState(false);
  const conversationTimelineRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);

  const appStyle = useMemo(
    () =>
      ({
        "--left-pane-fr": `${leftPanePercent}fr`,
        "--right-pane-fr": `${100 - leftPanePercent}fr`,
        "--drawer-h": `${bottomDrawerHeight}px`,
      }) as CSSProperties,
    [bottomDrawerHeight, leftPanePercent],
  );

  const isInteractionLocked =
    isUploading || llmProgress.status === "running";
  const isQuestionRefining = questionRefineProgress.status === "running";

  const refreshDoc = useCallback(async (id: string) => {
    const m = await fetchJson<typeof meta & { doc_id: string; title: string }>(
      api(`/documents/${id}`),
    );
    setMeta({
      document_status: m!.document_status,
      current_version_id: m!.current_version_id,
      audit: m!.audit ?? [],
    });
    setTitle(m!.title);
    try {
      const i = await fetchJson<DocumentIR>(api(`/documents/${id}/ir`));
      setIr(i);
      if (i.blocks.length) {
        setParseStatus("ready");
        setPhase((p) => (p === "empty" ? "imported" : p));
      }
    } catch {
      setIr(null);
    }
    try {
      const d = await fetchJson<GroundTruthDraft | null>(
        api(`/documents/${id}/draft`),
      );
      setDraft(d);
      if (d) setPhase((p) => (p !== "empty" ? "extracted" : p));
      if (d) {
        try {
          const [sc, pl] = await Promise.all([
            fetchJson<EvalScorecard>(api(`/documents/${id}/scorecard`)),
            fetchJson<EvalPlan>(api(`/documents/${id}/improvement-plan`)),
          ]);
          setScorecard(sc);
          setImprovementPlan(pl);
        } catch {
          setScorecard(null);
          setImprovementPlan(null);
        }
      } else {
        setScorecard(null);
        setImprovementPlan(null);
      }
    } catch {
      setDraft(null);
      setScorecard(null);
      setImprovementPlan(null);
    }
    try {
      const pub = await fetchJson<PublishInfo>(
        api(`/documents/${id}/publish-readiness`),
      );
      setPublishInfo(pub);
    } catch {
      setPublishInfo(null);
    }
    try {
      const versionInfo = await fetchJson<VersionListResponse>(
        api(`/documents/${id}/versions`),
      );
      setVersions(versionInfo.versions ?? []);
    } catch {
      setVersions([]);
    }
    try {
      const [threadInfo, candidateInfo, noteInfo] = await Promise.all([
        fetchJson<ThreadListResponse>(api(`/documents/${id}/threads`)),
        fetchJson<GTCandidateListResponse>(api(`/documents/${id}/gt-candidates`)),
        fetchJson<ExpertNoteListResponse>(api(`/documents/${id}/notes`)),
      ]);
      setThreads(threadInfo.threads ?? []);
      setGtCandidates(candidateInfo.candidates ?? []);
      setExpertNotes(noteInfo.notes ?? []);
    } catch {
      setThreads([]);
      setGtCandidates([]);
      setExpertNotes([]);
    }
  }, []);

  useEffect(() => {
    if (!docId) return;
    const t = setInterval(() => void refreshDoc(docId), 4000);
    return () => clearInterval(t);
  }, [docId, refreshDoc]);

  const startPaneResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      const next = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setLeftPanePercent(Math.min(68, Math.max(38, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  const startDrawerResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      const maxHeight = Math.min(520, window.innerHeight * 0.55);
      const next = window.innerHeight - moveEvent.clientY;
      setBottomDrawerHeight(Math.min(maxHeight, Math.max(140, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  const handlePaneResizerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = 3;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setLeftPanePercent((value) =>
          Math.min(
            68,
            Math.max(38, value + (event.key === "ArrowLeft" ? -step : step)),
          ),
        );
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setLeftPanePercent(event.key === "Home" ? 38 : 68);
      }
    },
    [],
  );

  const handleDrawerResizerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const maxHeight = Math.min(520, window.innerHeight * 0.55);
      const step = 24;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        setBottomDrawerHeight((value) =>
          Math.min(
            maxHeight,
            Math.max(140, value + (event.key === "ArrowUp" ? step : -step)),
          ),
        );
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setBottomDrawerHeight(event.key === "Home" ? 140 : maxHeight);
      }
    },
    [],
  );

  const selectedBlock = useMemo(
    () => ir?.blocks.find((b) => b.block_id === selectedBlockId),
    [ir, selectedBlockId],
  );

  const fieldItems = useMemo(() => {
    if (!draft) return [];
    return GROUND_TRUTH_FIELD_KEYS.flatMap((fieldKey) => {
      const raw = draft[fieldKey as keyof GroundTruthDraft];
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return items.map((item, index) => ({
        fieldKey,
        label: FIELD_LABELS[fieldKey] ?? fieldKey,
        index,
        item: item as GroundTruthFieldItem,
      }));
    });
  }, [draft]);

  const blockFieldIndex = useMemo(() => {
    const map = new Map<string, typeof fieldItems>();
    for (const entry of fieldItems) {
      for (const ref of entry.item.source_refs ?? []) {
        if (!ref.block_id) continue;
        const list = map.get(ref.block_id) ?? [];
        list.push(entry);
        map.set(ref.block_id, list);
      }
    }
    return map;
  }, [fieldItems]);

  const selectedBlockFields = selectedBlockId
    ? (blockFieldIndex.get(selectedBlockId) ?? [])
    : [];

  const candidateQuestions = improvementPlan?.candidate_questions ?? [];

  const fieldQualityRows = useMemo<FieldQualityRow[]>(() => {
    if (!draft) return [];
    const gapByField = new Map<string, FieldQualityRow["gaps"]>();
    for (const gap of draft.gaps ?? []) {
      const list = gapByField.get(gap.field_key) ?? [];
      list.push(gap);
      gapByField.set(gap.field_key, list);
    }
    for (const gap of draft.gaps_structured?.missing_fields ?? []) {
      const list = gapByField.get(gap.field_key) ?? [];
      const normalizedGap = {
        field_key: gap.field_key,
        message:
          gap.message ??
          `缺少“${FIELD_LABELS[gap.field_key] ?? gap.field_key}”：需要专家补充可回写内容。`,
      };
      if (!list.some((g) => g.message === normalizedGap.message)) {
        list.push(normalizedGap);
      }
      gapByField.set(gap.field_key, list);
    }

    return GROUND_TRUTH_FIELD_KEYS.map((fieldKey) => {
      const raw = draft[fieldKey as keyof GroundTruthDraft];
      const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as GroundTruthFieldItem[];
      const sourceBlockIds = [
        ...new Set(
          items.flatMap((item) =>
            (item.source_refs ?? [])
              .map((ref) => ref.block_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ),
      ];
      const gaps = gapByField.get(fieldKey) ?? [];
      const questions = candidateQuestions.filter(
        (q) =>
          q.target_field === fieldKey ||
          (!q.target_field &&
            q.source_block_id != null &&
            sourceBlockIds.includes(q.source_block_id)),
      );
      const isMissing = items.length === 0 || gaps.length > 0;
      const weakSource = items.length > 0 && sourceBlockIds.length === 0;
      const needsConfirmation = items.some(
        (item) => item.status === "InferredCandidate" || item.status === "Partial",
      );
      const status: FieldQualityRow["status"] = isMissing
        ? "missing"
        : weakSource
          ? "weak_source"
          : needsConfirmation
            ? "needs_confirmation"
            : "covered";
      const statusLabel =
        status === "missing"
          ? "缺失"
          : status === "weak_source"
            ? "弱出处"
            : status === "needs_confirmation"
              ? "待确认"
              : "已覆盖";
      const definition = FIELD_DEFINITIONS_ZH[fieldKey].gap_guidance;
      return {
        fieldKey,
        label: FIELD_DEFINITIONS_ZH[fieldKey].label,
        definition,
        status,
        statusLabel,
        items,
        sourceBlockIds,
        gaps,
        candidateQuestions: questions,
        reason:
          gaps[0]?.message ??
          (weakSource
            ? "该要素已有内容，但缺少可追溯原文 block 绑定。"
            : needsConfirmation
              ? "该要素包含推断候选，需要专家确认。"
              : "该核心要素已有结构化内容和出处。"),
      };
    });
  }, [candidateQuestions, draft]);

  const fieldQualityByKey = useMemo(
    () => new Map(fieldQualityRows.map((row) => [row.fieldKey, row])),
    [fieldQualityRows],
  );

  const activeFieldQuality =
    (focusContext.fieldKey
      ? fieldQualityByKey.get(focusContext.fieldKey)
      : undefined) ??
    (activeFieldKey ? fieldQualityByKey.get(activeFieldKey) : undefined) ??
    (selectedBlockFields[0]
      ? fieldQualityByKey.get(selectedBlockFields[0]!.fieldKey)
      : undefined);

  const focusTaskRows = useMemo(
    () =>
      fieldQualityRows
        .filter((row) => row.status !== "covered")
        .sort((a, b) => {
          const priority = {
            missing: 0,
            weak_source: 1,
            needs_confirmation: 2,
            covered: 3,
          };
          return priority[a.status] - priority[b.status];
        }),
    [fieldQualityRows],
  );

  const activeFieldBlocks = useMemo(() => {
    if (!ir || !activeFieldQuality) return [];
    return activeFieldQuality.sourceBlockIds
      .map((blockId) => ir.blocks.find((block) => block.block_id === blockId))
      .filter((block): block is DocumentIR["blocks"][number] => Boolean(block));
  }, [activeFieldQuality, ir]);

  const focusEvidenceBlockIds = useMemo(() => {
    if (focusContext.evidenceBlockIds.length) {
      return focusContext.evidenceBlockIds;
    }
    if (focusContext.blockId) return [focusContext.blockId];
    if (activeFieldQuality?.sourceBlockIds.length) {
      return activeFieldQuality.sourceBlockIds.slice(0, 3);
    }
    return selectedBlockId ? [selectedBlockId] : [];
  }, [activeFieldQuality, focusContext, selectedBlockId]);

  const focusEvidenceBlocks = useMemo(() => {
    if (!ir) return [];
    return focusEvidenceBlockIds
      .map((blockId) => ir.blocks.find((block) => block.block_id === blockId))
      .filter((block): block is DocumentIR["blocks"][number] => Boolean(block));
  }, [focusEvidenceBlockIds, ir]);

  const neighborBlockIds = useCallback(
    (blockId: string, radius = 2) => {
      if (!ir) return [blockId];
      const index = ir.blocks.findIndex((block) => block.block_id === blockId);
      if (index < 0) return [blockId];
      const start = Math.max(0, index - radius);
      const end = Math.min(ir.blocks.length, index + radius + 1);
      return ir.blocks.slice(start, end).map((block) => block.block_id);
    },
    [ir],
  );

  const focusRecommendedQuestion =
    focusContext.recommendedQuestion ??
    activeFieldQuality?.candidateQuestions[0]?.question ??
    (activeFieldQuality
      ? `请补充“${activeFieldQuality.label}”：${activeFieldQuality.definition}`
      : selectedBlock
        ? "请判断这段原文是否能补充当前结构化草稿，并给出可写入内容。"
        : "");

  const sortedThreads = useMemo(
    () =>
      [...threads].sort((a, b) =>
        b.latest_step_at.localeCompare(a.latest_step_at),
      ),
    [threads],
  );

  const activeThread =
    sortedThreads.find(
      (thread) =>
        thread.status !== "completed" &&
        (activeFieldQuality?.fieldKey
          ? thread.field_key === activeFieldQuality.fieldKey
          : true),
    ) ?? sortedThreads[0];

  const completedTaskFields = useMemo(() => {
    const fields = new Set<string>();
    for (const candidate of gtCandidates) {
      if (candidate.status === "confirmed" || candidate.status === "edited") {
        fields.add(candidate.field_key);
      }
    }
    for (const thread of threads) {
      if (thread.status === "completed" && thread.field_key) fields.add(thread.field_key);
      for (const step of thread.steps) {
        if (step.type !== "writeback_confirmed" && step.type !== "task_completed") {
          continue;
        }
        const payload = step.payload as Record<string, unknown>;
        if (typeof payload.field_key === "string") fields.add(payload.field_key);
      }
    }
    return fields;
  }, [gtCandidates, threads]);

  const completedTaskQuestions = useMemo(() => {
    const questions = new Set<string>();
    for (const thread of threads) {
      if (thread.status === "completed" && thread.recommended_question) {
        questions.add(thread.recommended_question);
      }
      for (const step of thread.steps) {
        if (step.type !== "task_completed") continue;
        const payload = step.payload as Record<string, unknown>;
        if (typeof payload.question === "string") questions.add(payload.question);
        if (thread.recommended_question) questions.add(thread.recommended_question);
      }
    }
    return questions;
  }, [threads]);

  const recommendedTaskQueue = useMemo<RecommendedTaskRow[]>(() => {
    const rows: RecommendedTaskRow[] = [];
    const seen = new Set<string>();
    const pushTask = (task: Omit<RecommendedTaskRow, "status">) => {
      const key = task.targetField ?? task.question ?? task.id;
      if (seen.has(key)) return;
      seen.add(key);
      const status: RecommendedTaskRow["status"] = task.targetField
        ? completedTaskFields.has(task.targetField)
          ? "completed"
          : activeFieldKey === task.targetField || focusContext.fieldKey === task.targetField
            ? "active"
            : "pending"
        : completedTaskQuestions.has(task.question)
          ? "completed"
          : focusContext.recommendedQuestion === task.question
            ? "active"
            : "pending";
      rows.push({ ...task, status });
    };

    for (const task of llmProgress.globalQualityTriage?.recommended_tasks ?? []) {
      const targetField = task.target_field ?? null;
      pushTask({
        id: task.task_id ?? `global-${targetField ?? task.title}`,
        title: friendlyTaskTitle({ title: task.title, targetField }),
        reason: friendlyReason({ reason: task.reason, fieldKey: targetField }),
        question: friendlyQuestion({ question: task.question, fieldKey: targetField }),
        targetField,
        sourceBlockIds: task.source_block_ids ?? [],
        origin: "global",
      });
    }

    for (const question of candidateQuestions) {
      pushTask({
        id: `quality-${question.target_field ?? question.question}`,
        title: friendlyTaskTitle({
          title: question.metric_label,
          targetField: question.target_field,
          fallback: `补强“${friendlyFieldLabel(question.target_field)}”`,
        }),
        reason: friendlyReason({
          reason: fieldQualityByKey.get(question.target_field ?? "")?.reason,
          fieldKey: question.target_field,
        }),
        question: friendlyQuestion({
          question: question.question,
          fieldKey: question.target_field,
        }),
        targetField: question.target_field ?? null,
        sourceBlockIds: uniqueStrings([question.source_block_id]),
        origin: "quality",
      });
    }

    for (const row of focusTaskRows) {
      pushTask({
        id: `field-${row.fieldKey}`,
        title: `补强“${row.label}”`,
        reason: row.reason,
        question: friendlyQuestion({
          question: row.candidateQuestions[0]?.question,
          fieldKey: row.fieldKey,
          fallback: `请补充“${row.label}”：${row.definition}`,
        }),
        targetField: row.fieldKey,
        sourceBlockIds: row.sourceBlockIds,
        origin: "field",
      });
    }

    return rows.sort((a, b) => {
      const priority = { active: 0, pending: 1, completed: 2 };
      return priority[a.status] - priority[b.status];
    });
  }, [
    activeFieldKey,
    candidateQuestions,
    completedTaskFields,
    completedTaskQuestions,
    fieldQualityByKey,
    focusContext.fieldKey,
    focusContext.recommendedQuestion,
    focusTaskRows,
    llmProgress.globalQualityTriage,
  ]);

  const visibleRecommendedTaskQueue = useMemo(
    () => recommendedTaskQueue.slice(0, MAX_PRIMARY_TASKS),
    [recommendedTaskQueue],
  );
  const hiddenRecommendedTaskCount = Math.max(
    0,
    recommendedTaskQueue.length - visibleRecommendedTaskQueue.length,
  );

  const nextRecommendedTask = visibleRecommendedTaskQueue.find(
    (task) => task.status !== "completed",
  );

  const taskQueueSummary = useMemo(() => {
    if (!draft) return "导入并完成质量检测后，这里会出现推荐任务。";
    const pending = visibleRecommendedTaskQueue.filter(
      (task) => task.status !== "completed",
    ).length;
    const completed = visibleRecommendedTaskQueue.filter(
      (task) => task.status === "completed",
    ).length;
    const folded =
      hiddenRecommendedTaskCount > 0
        ? `，另有 ${hiddenRecommendedTaskCount} 个待优化项已收起`
        : "";
    if (pending > 0) {
      return `还有 ${pending} 个主任务待处理，已完成 ${completed} 个${folded}。`;
    }
    return `全局主任务已处理完${folded}，可以回到左侧原文，选择局部 block 继续问答修订。`;
  }, [draft, hiddenRecommendedTaskCount, visibleRecommendedTaskQueue]);

  const conversationEvents = useMemo<ConversationEvent[]>(() => {
    const events: ConversationEvent[] = [];
    const candidateById = new Map(
      gtCandidates.map((candidate) => [candidate.candidate_id, candidate]),
    );
    const attachedCandidateIds = new Set<string>();
    const turnByCandidateId = new Map<
      string,
      Extract<ConversationEvent, { kind: "turn" }>
    >();
    const noteIds = new Set(expertNotes.map((note) => note.note_id));
    const representedQuestions = new Set<string>();
    const representedAnswers = new Set<string>();

    for (const thread of threads) {
      let activeTurn: Extract<ConversationEvent, { kind: "turn" }> | null = null;
      const ensureTurn = (step: ThreadStep) => {
        if (activeTurn) return activeTurn;
        activeTurn = {
          id: `turn-${thread.thread_id}-${step.step_id}`,
          kind: "turn",
          at: step.timestamp,
          sort: dateToSort(step.timestamp),
          thread,
        };
        events.push(activeTurn);
        return activeTurn;
      };

      for (const step of thread.steps) {
        const payload = step.payload as Record<string, unknown>;
        const question =
          typeof payload.question === "string"
            ? payload.question
            : typeof payload.refined_question === "string"
              ? payload.refined_question
              : null;
        const answer = typeof payload.answer === "string" ? payload.answer : null;
        if (question) representedQuestions.add(question);
        if (answer) representedAnswers.add(answer);

        if (step.type === "question_sent") {
          activeTurn = {
            id: `turn-${thread.thread_id}-${step.step_id}`,
            kind: "turn",
            at: step.timestamp,
            sort: dateToSort(step.timestamp),
            thread,
            questionStep: step,
          };
          events.push(activeTurn);
          continue;
        }
        if (step.type === "agent_answered") {
          ensureTurn(step).answerStep = step;
          continue;
        }
        if (step.type === "gt_candidate_created") {
          const candidateId =
            typeof payload.candidate_id === "string" ? payload.candidate_id : null;
          const candidate = candidateId ? candidateById.get(candidateId) : undefined;
          if (candidate) {
            const turn = ensureTurn(step);
            turn.candidate = candidate;
            turnByCandidateId.set(candidate.candidate_id, turn);
            attachedCandidateIds.add(candidate.candidate_id);
          }
          continue;
        }
        if (step.type === "writeback_confirmed" || step.type === "writeback_rejected") {
          const candidateId =
            typeof payload.candidate_id === "string" ? payload.candidate_id : null;
          const turn = candidateId ? turnByCandidateId.get(candidateId) : null;
          (turn ?? ensureTurn(step)).writebackStep = step;
          continue;
        }
        if (step.type === "task_completed") {
          const candidateId =
            typeof payload.candidate_id === "string" ? payload.candidate_id : null;
          const turn = candidateId ? turnByCandidateId.get(candidateId) : null;
          (turn ?? ensureTurn(step)).completionStep = step;
          continue;
        }
        if (
          step.type === "note_saved" &&
          typeof payload.note_id === "string" &&
          noteIds.has(payload.note_id)
        ) {
          continue;
        }
        events.push({
          id: `step-${step.step_id}`,
          kind: "step",
          at: step.timestamp,
          sort: dateToSort(step.timestamp),
          thread,
          step,
        });
      }

      if (thread.steps.length === 0) {
        events.push({
          id: `thread-${thread.thread_id}`,
          kind: "step",
          at: thread.created_at,
          sort: dateToSort(thread.created_at),
          thread,
          step: {
            step_id: `thread-${thread.thread_id}-task`,
            thread_id: thread.thread_id,
            type: "task_started",
            timestamp: thread.created_at,
            payload: {
              field_key: thread.field_key,
              recommended_question: thread.recommended_question,
            },
          },
        });
      }
    }

    for (const candidate of gtCandidates) {
      if (attachedCandidateIds.has(candidate.candidate_id)) continue;
      events.push({
        id: `candidate-${candidate.candidate_id}`,
        kind: "candidate",
        at: candidate.created_at,
        sort: dateToSort(candidate.created_at),
        candidate,
      });
    }

    for (const note of expertNotes) {
      events.push({
        id: `note-${note.note_id}`,
        kind: "note",
        at: note.created_at,
        sort: dateToSort(note.created_at),
        note,
      });
    }

    messages.forEach((message, index) => {
      const createdAt = message.createdAt ?? new Date(Date.now() + index).toISOString();
      const isRepresentedUserQuestion =
        message.role === "user" && representedQuestions.has(message.text);
      const isRepresentedAgentAnswer =
        message.role === "agent" && representedAnswers.has(message.text);
      const isLiveMessage = message.status === "pending" || message.status === "error";
      if (!isLiveMessage && (isRepresentedUserQuestion || isRepresentedAgentAnswer)) {
        return;
      }
      events.push({
        id: `message-${message.id}`,
        kind: "message",
        at: createdAt,
        sort: dateToSort(createdAt, Date.now() + index),
        message,
      });
    });

    if (
      questionRefineProgress.status === "running" ||
      questionRefineProgress.status === "error"
    ) {
      const at = questionRefineProgress.startedAt
        ? new Date(questionRefineProgress.startedAt).toISOString()
        : new Date().toISOString();
      events.push({
        id: "question-refine-progress",
        kind: "question_refine_progress",
        at,
        sort: questionRefineProgress.startedAt ?? Date.now(),
        progress: questionRefineProgress,
      });
    }

    if (llmProgress.status !== "idle") {
      const at = llmProgress.startedAt
        ? new Date(llmProgress.startedAt).toISOString()
        : new Date().toISOString();
      events.push({
        id: "quality-progress",
        kind: "quality_progress",
        at,
        sort: llmProgress.startedAt ?? Date.now(),
        progress: llmProgress,
      });
    }

    return events.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  }, [
    expertNotes,
    gtCandidates,
    llmProgress,
    messages,
    questionRefineProgress,
    threads,
  ]);

  const conversationUpdateKey = useMemo(
    () =>
      conversationEvents
        .map((event) => {
          if (event.kind === "turn") {
            return [
              event.id,
              event.questionStep?.step_id,
              event.answerStep?.step_id,
              event.candidate?.candidate_id,
              event.candidate?.status,
              event.writebackStep?.step_id,
              event.completionStep?.step_id,
            ].join(":");
          }
          return `${event.kind}:${event.id}`;
        })
        .join("|"),
    [conversationEvents],
  );

  const scrollConversationToLatest = useCallback(() => {
    const el = conversationTimelineRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAutoFollowConversation(true);
    setHasUnseenConversationUpdate(false);
  }, []);

  const handleConversationScroll = useCallback(() => {
    const el = conversationTimelineRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceToBottom < 96;
    setAutoFollowConversation(atBottom);
    if (atBottom) setHasUnseenConversationUpdate(false);
  }, []);

  useEffect(() => {
    const el = conversationTimelineRef.current;
    if (!el || conversationEvents.length === 0) return;
    if (autoFollowConversation) {
      window.requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
        setHasUnseenConversationUpdate(false);
      });
    } else {
      setHasUnseenConversationUpdate(true);
    }
  }, [autoFollowConversation, conversationEvents.length, conversationUpdateKey]);

  const metricRows = useMemo<MetricTableRow[]>(() => {
    if (!scorecard) return [];
    return Object.entries(scorecard.scores).map(([key, value]) => {
      const def = scorecard.metric_definitions?.[key];
      const status = scorecard.threshold_check?.[key] ?? "skipped";
      return {
        name: def?.label ?? METRIC_CHIP_LABELS[key] ?? key,
        definition: def?.meaning ?? "暂无指标定义",
        value: value == null ? "跳过" : `${Math.round(value * 100)}%`,
        status,
      };
    });
  }, [scorecard]);

  const readinessRows = useMemo<MetricTableRow[]>(() => {
    if (!publishInfo) return [];
    const statusText =
      publishInfo.readiness_status === "ready"
        ? "可进入复核 / 就绪"
        : publishInfo.readiness_status === "blocked"
          ? "阻塞"
          : "待补强";
    return [
      {
        name: "发布就绪状态",
        definition: "根据字段完整度和阻塞问题判断当前结构化草稿是否可进入复核。",
        value: statusText,
      },
      ...Object.entries(publishInfo.completeness_summary).map(([key, value]) => ({
        name: FIELD_LABELS[key] ?? key,
        definition:
          FIELD_DEFINITIONS_ZH[key as keyof typeof FIELD_DEFINITIONS_ZH]
            ?.gap_guidance ?? "核心 schema 要素是否已有结构化内容。",
        value: value >= 1 ? "已覆盖" : "缺失",
      })),
    ];
  }, [publishInfo]);

  const completeness = useMemo(() => {
    if (!draft) return 0;
    let n = 0;
    for (const k of GROUND_TRUTH_FIELD_KEYS) {
      const v = draft[k as keyof GroundTruthDraft];
      if (Array.isArray(v) && v.length) n++;
      else if (v && typeof v === "object" && "content" in (v as object)) n++;
    }
    return Math.round((n / GROUND_TRUTH_FIELD_KEYS.length) * 100);
  }, [draft]);

  function appendLlmDebugEntries(
    source: LlmDebugEntry["source"],
    diagnostics: LlmDebugDiagnostics | LlmDebugDiagnostics[] | undefined,
  ) {
    if (!diagnostics) return;
    const list = Array.isArray(diagnostics) ? diagnostics : [diagnostics];
    const entries = list
      .filter((item) => item.label || item.stage)
      .map((item) => ({
        ...item,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        source,
      }));
    if (entries.length === 0) return;
    setLlmDebugEntries((current) => [...entries, ...current].slice(0, 30));
  }

  function sourceLabel(source: LlmDebugEntry["source"]) {
    if (source === "quality") return "质量检测";
    if (source === "refine") return "问题改写";
    return "QA 回答";
  }

  function setRunningLlmStep(startedAt: number, stepIndex: number) {
    setLlmProgress({
      status: "running",
      stepIndex,
      startedAt,
      elapsedMs: Date.now() - startedAt,
      message: LLM_STEPS[stepIndex] ?? LLM_STEPS[LLM_STEPS.length - 1]!,
    });
  }

  async function createDoc() {
    if (isInteractionLocked) return;
    const m = await fetchJson<{ doc_id: string }>(api("/documents"), {
      method: "POST",
      body: JSON.stringify({ title: "新建文档" }),
    });
    setDocId(m.doc_id);
    setPhase("empty");
    setParseStatus("idle");
    setFocusContext(emptyFocusContext);
    setQaContext({ source: "none", mode: "direct_qa", blockId: null });
    setActiveWorkbenchContext(emptyWorkbenchContext);
    setSelectedBlockId(null);
    setActiveFieldKey(null);
    setLlmProgress(idleLlmProgress);
    setQuestionRefineProgress(idleQuestionRefineProgress);
    setLlmDebugEntries([]);
    setLlmDebugOpen(false);
    setMessages([]);
    setThreads([]);
    setGtCandidates([]);
    setExpertNotes([]);
    setNoteDraft("");
    await refreshDoc(m.doc_id);
  }

  async function onUpload(f: File) {
    if (!docId || isInteractionLocked) return;
    setIsUploading(true);
    setParseStatus("uploading");
    setSaveHint("Saving…");
    try {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(api(`/documents/${docId}/sources`), { method: "POST", body: fd });
      setParseStatus("processing");
      await fetch(api(`/documents/${docId}/jobs/process-next`), {
        method: "POST",
      });
      setParseStatus("waiting_ir");
      setSaveHint("Saved");
      setTimeout(() => void refreshDoc(docId), 500);
      setPhase("imported");
    } finally {
      setIsUploading(false);
    }
  }

  async function runExtract() {
    if (!docId || isInteractionLocked) return;
    if (!ir?.blocks.length) {
      setLlmProgress({
        ...idleLlmProgress,
        status: "error",
        message: "文档解析尚未完成，请等待原文切块出现后再做质量检测。",
      });
      return;
    }
    const startedAt = Date.now();
    setRunningLlmStep(startedAt, 0);
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextStep = Math.min(
        LLM_STEPS.length - 1,
        Math.floor(elapsed / 9000),
      );
      setRunningLlmStep(startedAt, nextStep);
    }, 1000);
    try {
      const r = await fetchJson<ExtractResponse>(api(`/documents/${docId}/extract`), {
        method: "POST",
        body: "{}",
      });
      setDraft(r.draft);
      if (r.scorecard) setScorecard(r.scorecard);
      if (r.improvement_plan) setImprovementPlan(r.improvement_plan);
      setPhase("extracted");
      setLlmProgress({
        status: "success",
        stepIndex: LLM_STEPS.length - 1,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        message:
          r.quality_triage_mode === "llm"
            ? "轻量质量检测完成，已生成主要缺口和推荐任务"
            : r.quality_triage_mode === "deep_structuring"
              ? "深度结构化抽取完成"
              : "轻量质量检测完成，已使用本地规则生成推荐任务",
        diagnostics: r.structuring_diagnostics,
        parseDiagnostics: r.parse_diagnostics,
        globalQualityTriage: r.global_quality_triage,
      });
      appendLlmDebugEntries("quality", r.structuring_diagnostics?.attempts);
      void refreshDoc(docId);
    } catch (err) {
      setLlmProgress({
        status: "error",
        stepIndex: 0,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        message:
          err instanceof Error
            ? err.message
            : "质量检测失败，请查看服务端日志。",
      });
    } finally {
      window.clearInterval(timer);
    }
  }

  function buildCurrentQaContextSnapshot() {
    const blockId =
      qaContext.blockId ??
      focusContext.blockId ??
      focusEvidenceBlockIds[0] ??
      selectedBlockId;
    const targetField =
      qaContext.targetField ?? focusContext.fieldKey ?? activeFieldKey;
    const metric = qaContext.metric ?? focusContext.metric;
    const evidenceBlockIds = uniqueStrings([
      ...(qaContext.evidenceBlockIds ?? focusEvidenceBlockIds),
      blockId,
    ]);
    const questionSeed =
      (qaContext.questionSeed ?? focusRecommendedQuestion) ||
      "请结合当前任务和证据原文，给出可写入结构化草稿的专家答案。";
    const gapReason =
      qaContext.gapReason ?? focusContext.gapMessage ?? activeFieldQuality?.reason ?? null;
    return {
      source: qaContext.source,
      mode: qaContext.mode,
      blockId: blockId ?? null,
      targetField,
      metric,
      evidenceBlockIds,
      questionSeed,
      gapReason,
      threadId: qaContext.threadId,
    };
  }

  async function runQaConversation(
    q: string,
    contextSnapshot: ReturnType<typeof buildCurrentQaContextSnapshot>,
  ) {
    if (!docId) throw new Error("请先创建或加载文档。");
    const askedAt = new Date().toISOString();
    const qaPayload = buildQaContextPayload(q, contextSnapshot);
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: q,
        createdAt: askedAt,
        blockId: contextSnapshot.blockId,
        targetField: contextSnapshot.targetField,
      },
    ]);
    setPhase("qa");
    const pendingId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      {
        id: pendingId,
        role: "agent",
        text: "QA Agent 正在回答，并生成候选内容用于更新知识库...",
        createdAt: new Date().toISOString(),
        question: q,
        blockId: contextSnapshot.blockId,
        targetField: contextSnapshot.targetField,
        status: "pending",
      },
    ]);
    setIsQaRunning(true);
    try {
      const qa = await fetchJsonWithTimeout<QAResponse>(
        api(`/documents/${docId}/qa`),
        {
          method: "POST",
          body: JSON.stringify(qaPayload),
        },
        65_000,
      );
      appendLlmDebugEntries("qa", qa.llm_diagnostics);
      setQaContext({
        ...contextSnapshot,
        targetField: qa.target_field ?? contextSnapshot.targetField,
        threadId: qa.thread_id ?? contextSnapshot.threadId,
      });
      setActiveWorkbenchContext((prev) => ({
        ...prev,
        source: prev.source === "none" ? "question" : prev.source,
        mode: prev.source === "none" ? contextSnapshot.mode : prev.mode,
        title:
          prev.title && prev.title !== "未选择上下文"
            ? prev.title
            : qa.target_field
              ? friendlyFieldLabel(qa.target_field)
              : "专家问答",
        fieldKey: qa.target_field ?? prev.fieldKey,
        threadId: qa.thread_id ?? prev.threadId,
      }));
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingId
            ? {
                id: pendingId,
                role: "agent",
                text: qa.direct_answer,
                createdAt: new Date().toISOString(),
                qa,
                question: q,
                blockId: contextSnapshot.blockId,
                targetField: qa.target_field ?? contextSnapshot.targetField,
              }
            : msg,
        ),
      );
    } catch (err) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingId
            ? {
                ...msg,
                text: qaErrorMessage(err),
                status: "error",
              }
            : msg,
        ),
      );
      throw err;
    } finally {
      setIsQaRunning(false);
      void refreshDoc(docId);
    }
  }

  async function sendMessage() {
    if (
      !docId ||
      !input.trim() ||
      isInteractionLocked ||
      isQaRunning ||
      isQuestionRefining
    ) {
      return;
    }
    const q = input.trim();
    const contextSnapshot = buildCurrentQaContextSnapshot();
    setInput("");
    try {
      await runQaConversation(q, contextSnapshot);
    } catch {
      // runQaConversation updates the pending message with the visible error.
    }
  }

  function buildQaContextPayload(
    question: string,
    contextSnapshot: ReturnType<typeof buildCurrentQaContextSnapshot>,
  ) {
    return {
      qa_source: contextSnapshot.source,
      qa_mode: contextSnapshot.mode,
      block_id: contextSnapshot.blockId,
      evidence_block_ids: contextSnapshot.evidenceBlockIds,
      question,
      question_seed: contextSnapshot.questionSeed || question,
      target_field: contextSnapshot.targetField,
      metric: contextSnapshot.metric,
      gap_reason: contextSnapshot.gapReason,
      thread_id: contextSnapshot.threadId,
    };
  }

  function addBlockToChat(blockId: string) {
    focusBlock(blockId);
    window.requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  }

  async function applySuggestion(s: SuggestionRecord, edited?: string) {
    if (!docId || isInteractionLocked) return;
    await fetchJson(api(`/documents/${docId}/suggestions/${s.suggestion_id}/apply`), {
      method: "POST",
      body: JSON.stringify({ edited_text: edited }),
    });
    setSuggestions((list) => list.filter((x) => x.suggestion_id !== s.suggestion_id));
    void refreshDoc(docId);
  }

  async function newVersion() {
    if (!docId || isInteractionLocked) return;
    const previous = meta?.current_version_id;
    const result = await fetchJson<{ new_version_id: string }>(
      api(`/documents/${docId}/versions`),
      {
        method: "POST",
        body: "{}",
      },
    );
    if (previous && result.new_version_id) {
      try {
        const compare = await fetchJson<ScoreCompareResponse>(
          api(
            `/documents/${docId}/scorecard/compare/${previous}/${result.new_version_id}`,
          ),
        );
        setScoreCompare(compare);
      } catch {
        setScoreCompare(null);
      }
    }
    setPhase("version");
    setDrawerTab("diff");
    void refreshDoc(docId);
  }

  async function compareLatestVersions() {
    if (!docId || versions.length < 2) return;
    const before = versions[versions.length - 2]!;
    const after = versions[versions.length - 1]!;
    const compare = await fetchJson<ScoreCompareResponse>(
      api(
        `/documents/${docId}/scorecard/compare/${before.version_id}/${after.version_id}`,
      ),
    );
    setScoreCompare(compare);
  }

  function useCandidateQuestion(q: CandidateQuestion) {
    setDrawerTab("eval");
    if (q.target_field) setActiveFieldKey(q.target_field);
    const evidenceBlockIds = uniqueStrings([
      q.source_block_id,
      ...(q.target_field
        ? (fieldQualityByKey.get(q.target_field)?.sourceBlockIds ?? [])
        : []),
    ]);
    setFocusContext({
      kind: q.target_field ? "gap" : "block",
      fieldKey: q.target_field,
      blockId: q.source_block_id ?? evidenceBlockIds[0] ?? selectedBlockId,
      evidenceBlockIds,
      recommendedQuestion: q.question,
      metric: q.metric,
    });
    setQaContext({
      source: "question",
      mode: "task_refine_then_qa",
      blockId: q.source_block_id ?? selectedBlockId,
      targetField: q.target_field,
      metric: q.metric,
      evidenceBlockIds,
      questionSeed: q.question,
      gapReason: q.target_field
        ? fieldQualityByKey.get(q.target_field)?.reason
        : null,
    });
    setActiveWorkbenchContext({
      source: "question",
      mode: "task_refine_then_qa",
      title: q.metric_label || "候选追问",
      fieldKey: q.target_field,
      blockId: q.source_block_id ?? selectedBlockId,
      evidenceBlockIds,
      recommendedQuestion: q.question,
      metric: q.metric,
      gapReason: q.target_field
        ? fieldQualityByKey.get(q.target_field)?.reason
        : null,
    });
    setInput(q.question);
  }

  function useRecommendedTask(task: RecommendedTaskRow) {
    setLeftMode("compare");
    setDrawerTab("eval");
    if (task.targetField) setActiveFieldKey(task.targetField);
    const evidenceBlockIds = uniqueStrings(task.sourceBlockIds);
    setFocusContext({
      kind: task.targetField ? "gap" : "block",
      fieldKey: task.targetField,
      blockId: evidenceBlockIds[0] ?? selectedBlockId,
      evidenceBlockIds,
      recommendedQuestion: task.question,
      gapMessage: task.reason,
    });
    setQaContext({
      source: "task",
      mode: "task_refine_then_qa",
      blockId: evidenceBlockIds[0] ?? selectedBlockId,
      targetField: task.targetField,
      evidenceBlockIds,
      questionSeed: task.question,
      gapReason: task.reason,
    });
    setActiveWorkbenchContext({
      source: "task",
      mode: "task_refine_then_qa",
      title: task.title,
      fieldKey: task.targetField,
      blockId: evidenceBlockIds[0] ?? selectedBlockId,
      evidenceBlockIds,
      recommendedQuestion: task.question,
      gapReason: task.reason,
    });
    setInput("");
  }

  function focusField(row: FieldQualityRow, kind: "field" | "gap" = "field") {
    setActiveFieldKey(row.fieldKey);
    if (row.sourceBlockIds[0]) setSelectedBlockId(row.sourceBlockIds[0]);
    const candidate =
      row.candidateQuestions[0]?.question ??
      `请补充“${row.label}”：${row.definition}`;
    setFocusContext({
      kind,
      fieldKey: row.fieldKey,
      blockId: row.sourceBlockIds[0] ?? null,
      gapMessage: row.reason,
      evidenceBlockIds: row.sourceBlockIds.slice(0, 3),
      recommendedQuestion: candidate,
      metric: row.status === "missing" ? "field_coverage" : undefined,
    });
    setQaContext({
      source: "field",
      mode: "task_refine_then_qa",
      blockId: row.sourceBlockIds[0] ?? selectedBlockId,
      targetField: row.fieldKey,
      evidenceBlockIds: row.sourceBlockIds.slice(0, 3),
      questionSeed: candidate,
      gapReason: row.reason,
      metric: row.status === "missing" ? "field_coverage" : undefined,
    });
    setActiveWorkbenchContext({
      source: "field",
      mode: "task_refine_then_qa",
      title: row.label,
      fieldKey: row.fieldKey,
      blockId: row.sourceBlockIds[0] ?? null,
      evidenceBlockIds: row.sourceBlockIds.slice(0, 3),
      recommendedQuestion: candidate,
      gapReason: row.reason,
      metric: row.status === "missing" ? "field_coverage" : undefined,
    });
  }

  function focusBlock(blockId: string) {
    setSelectedBlockId(blockId);
    const linkedField = blockFieldIndex.get(blockId)?.[0]?.fieldKey;
    if (linkedField) setActiveFieldKey(linkedField);
    const fieldKey = linkedField ?? null;
    const row = fieldKey ? fieldQualityByKey.get(fieldKey) : undefined;
    const evidenceBlockIds = neighborBlockIds(blockId);
    const recommendedQuestion =
      row?.candidateQuestions[0]?.question ??
      (fieldKey
        ? `请基于这段原文补充“${FIELD_LABELS[fieldKey] ?? fieldKey}”。`
        : "请判断这段原文能补充哪个结构化字段，并给出可写入内容。");
    const nextFocus: FocusContext = {
      kind: fieldKey ? "field" : "block",
      fieldKey,
      blockId,
      gapMessage: row?.reason,
      evidenceBlockIds,
      recommendedQuestion,
      metric: undefined,
    };
    setFocusContext(nextFocus);
    setQaContext({
      source: "raw_block",
      mode: "direct_qa",
      blockId,
      targetField: fieldKey,
      evidenceBlockIds,
      questionSeed: recommendedQuestion,
      gapReason: nextFocus.gapMessage ?? null,
      metric: nextFocus.metric,
      threadId: null,
    });
    setActiveWorkbenchContext({
      source: "raw_block",
      mode: "direct_qa",
      title: fieldKey ? friendlyFieldLabel(fieldKey) : "原文证据",
      fieldKey,
      blockId,
      evidenceBlockIds,
      recommendedQuestion,
      gapReason: nextFocus.gapMessage ?? null,
      metric: nextFocus.metric,
      threadId: null,
    });
  }

  function removeEvidenceBlockFromContext(blockId: string) {
    const evidenceBlockIds = focusEvidenceBlockIds.filter((id) => id !== blockId);
    setFocusContext((prev) => ({
      ...prev,
      blockId: prev.blockId === blockId ? evidenceBlockIds[0] ?? null : prev.blockId,
      evidenceBlockIds,
    }));
    setQaContext((prev) => ({
      ...prev,
      blockId: prev.blockId === blockId ? evidenceBlockIds[0] ?? null : prev.blockId,
      evidenceBlockIds,
    }));
    setActiveWorkbenchContext((prev) => ({
      ...prev,
      blockId: prev.blockId === blockId ? evidenceBlockIds[0] ?? null : prev.blockId,
      evidenceBlockIds,
    }));
  }

  function prepareDirectContextQuestion() {
    const question =
      focusRecommendedQuestion ||
      activeWorkbenchContext.recommendedQuestion ||
      "请基于已加入对话的原文证据，给出可写入结构化草稿的补充内容。";
    setInput((current) => current || question);
  }

  async function askWithFocus() {
    if (!docId || isInteractionLocked || isQuestionRefining) return;
    const fieldKey = focusContext.fieldKey ?? activeFieldQuality?.fieldKey;
    const blockId =
      focusContext.blockId ?? focusEvidenceBlockIds[0] ?? selectedBlockId;
    const contextSnapshot = {
      source: "task" as const,
      mode: "task_refine_then_qa" as const,
      blockId: blockId ?? null,
      targetField: fieldKey,
      metric: focusContext.metric,
      evidenceBlockIds: uniqueStrings([...focusEvidenceBlockIds, blockId]),
      threadId: qaContext.threadId ?? null,
      questionSeed:
        focusRecommendedQuestion ||
        "请结合当前任务和证据原文，给出可写入结构化草稿的专家答案。",
      gapReason: focusContext.gapMessage ?? activeFieldQuality?.reason ?? null,
    };
    setQaContext(contextSnapshot);
    setInput("");
    const startedAt = Date.now();
    setQuestionRefineProgress({
      status: "running",
      stepIndex: 0,
      startedAt,
      elapsedMs: 0,
      message: "正在读取证据 block",
    });
    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const stepIndex = Math.min(
        QUESTION_REFINE_STEPS.length - 2,
        Math.floor(elapsedMs / 1200),
      );
      setQuestionRefineProgress((prev) => ({
        ...prev,
        elapsedMs,
        stepIndex,
        message: QUESTION_REFINE_STEPS[stepIndex]!,
      }));
    }, 500);
    try {
      const refined = await fetchJsonWithTimeout<QuestionRefinementResponse>(
        api(`/documents/${docId}/qa/refine-question`),
        {
          method: "POST",
          body: JSON.stringify({
            block_id: contextSnapshot.blockId,
            evidence_block_ids: contextSnapshot.evidenceBlockIds,
            question_seed: contextSnapshot.questionSeed,
            target_field: contextSnapshot.targetField,
            metric: contextSnapshot.metric,
            gap_reason: contextSnapshot.gapReason,
          }),
        },
        65_000,
      );
      appendLlmDebugEntries("refine", refined.llm_diagnostics);
      setInput(refined.refined_question);
      setQaContext({
        ...contextSnapshot,
        questionSeed: refined.refined_question,
        threadId: refined.thread_id,
      });
      void refreshDoc(docId);
      setQuestionRefineProgress({
        status: "success",
        stepIndex: QUESTION_REFINE_STEPS.length - 1,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        message: "已生成追问草稿，可编辑后提交",
        contextSummary: refined.context_summary,
        sourceBlockRefs: refined.source_block_refs,
        rationale: refined.rationale,
      });
    } catch (err) {
      setInput(contextSnapshot.questionSeed);
      setQuestionRefineProgress({
        status: "error",
        stepIndex: 0,
        startedAt,
        elapsedMs: Date.now() - startedAt,
        message:
          err instanceof Error
            ? `问题改写失败：${err.message}`
            : "问题改写失败，仍可带上下文直接提问",
      });
    } finally {
      window.clearInterval(timer);
    }
  }

  async function generateSuggestionsForFocus() {
    if (!docId || isInteractionLocked) return;
    const blockId = focusEvidenceBlockIds[0] ?? selectedBlockId;
    if (!blockId) {
      setSaveHint("请先选择一个证据 block");
      return;
    }
    const sug = await fetchJson<{ suggestions: SuggestionRecord[] }>(
      api(`/documents/${docId}/suggestions`),
      {
        method: "POST",
        body: JSON.stringify({ block_id: blockId }),
      },
    );
    setSuggestions((prev) => [...sug.suggestions, ...prev]);
    setPhase("suggestions");
    setDrawerTab("suggestions");
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "agent",
        text: `已基于当前证据生成 ${sug.suggestions.length} 条补写建议，可在底部“待确认建议”查看。`,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  async function applyQaAnswer(message: ChatMessage, editedText?: string) {
    if (!docId || !message.qa || isInteractionLocked) return;
    const fieldKey =
      writebackTargets[message.id] ||
      message.qa.suggested_writeback?.field_key ||
      message.qa.target_field ||
      message.targetField;
    if (!fieldKey) {
      setWritebackStatus((s) => ({ ...s, [message.id]: "error" }));
      setSaveHint("请先选择回写字段");
      return;
    }
    setWritebackStatus((s) => ({ ...s, [message.id]: "running" }));
    try {
      const result = await fetchJson<ApplyQaResponse>(
        api(`/documents/${docId}/qa/apply`),
        {
          method: "POST",
          body: JSON.stringify({
            field_key: fieldKey,
            answer_text: message.text,
            edited_text: editedText,
            mode: writebackModes[message.id] ?? "append",
            question: message.question,
            block_id: message.blockId,
            thread_id: message.qa.thread_id,
          }),
        },
      );
      setDraft(result.draft);
      if (result.scorecard) setScorecard(result.scorecard);
      if (result.improvement_plan) setImprovementPlan(result.improvement_plan);
      await refreshDoc(docId);
      setWritebackStatus((s) => ({ ...s, [message.id]: "success" }));
      setEditingMessageId(null);
      setEditingAnswer("");
      setActiveFieldKey(fieldKey);
      setPhase("version");
      setSaveHint(`已回写：${FIELD_LABELS[fieldKey] ?? fieldKey}`);
    } catch (err) {
      setWritebackStatus((s) => ({ ...s, [message.id]: "error" }));
      setSaveHint(err instanceof Error ? err.message : "回写失败");
    }
  }

  async function confirmGTCandidate(candidate: GTCandidate) {
    if (!docId || isInteractionLocked) return;
    setCandidateStatus((s) => ({ ...s, [candidate.candidate_id]: "running" }));
    try {
      const result = await fetchJson<{
        candidate: GTCandidate;
        draft: GroundTruthDraft;
        scorecard?: EvalScorecard;
        improvement_plan?: EvalPlan;
      }>(api(`/documents/${docId}/gt-candidates/${candidate.candidate_id}/confirm`), {
        method: "POST",
        body: JSON.stringify({
          edited_text: candidateEdits[candidate.candidate_id],
          mode: candidateModes[candidate.candidate_id] ?? candidate.recommended_mode,
        }),
      });
      setDraft(result.draft);
      if (result.scorecard) setScorecard(result.scorecard);
      if (result.improvement_plan) setImprovementPlan(result.improvement_plan);
      setCandidateStatus((s) => ({ ...s, [candidate.candidate_id]: "success" }));
      setActiveFieldKey(candidate.field_key);
      setSaveHint(`已确认候选补充：${FIELD_LABELS[candidate.field_key] ?? candidate.field_key}`);
      await refreshDoc(docId);
    } catch (err) {
      setCandidateStatus((s) => ({ ...s, [candidate.candidate_id]: "error" }));
      setSaveHint(err instanceof Error ? err.message : "候选补充确认失败");
    }
  }

  async function rejectGTCandidate(candidate: GTCandidate) {
    if (!docId || isInteractionLocked) return;
    setCandidateStatus((s) => ({ ...s, [candidate.candidate_id]: "running" }));
    try {
      await fetchJson<GTCandidate>(
        api(`/documents/${docId}/gt-candidates/${candidate.candidate_id}/reject`),
        { method: "POST", body: "{}" },
      );
      setCandidateStatus((s) => ({ ...s, [candidate.candidate_id]: "success" }));
      setSaveHint("已暂不采用候选补充");
      await refreshDoc(docId);
    } catch (err) {
      setCandidateStatus((s) => ({ ...s, [candidate.candidate_id]: "error" }));
      setSaveHint(err instanceof Error ? err.message : "候选补充处理失败");
    }
  }

  async function saveExpertNote() {
    if (!docId || !noteDraft.trim() || isInteractionLocked) return;
    const threadId = activeThread?.thread_id ?? qaContext.threadId ?? null;
    await fetchJson<ExpertNote>(api(`/documents/${docId}/notes`), {
      method: "POST",
      body: JSON.stringify({
        thread_id: threadId,
        content: noteDraft.trim(),
        source_block_ids: focusEvidenceBlockIds,
      }),
    });
    setNoteDraft("");
    setSaveHint("已保存专家笔记");
    await refreshDoc(docId);
  }

  async function saveCandidateAsExpertNote(candidate: GTCandidate) {
    if (!docId || isInteractionLocked) return;
    const content =
      candidateEdits[candidate.candidate_id] ?? summarizeContent(candidate.content, 1200);
    await fetchJson<ExpertNote>(api(`/documents/${docId}/notes`), {
      method: "POST",
      body: JSON.stringify({
        thread_id: candidate.thread_id ?? activeThread?.thread_id ?? null,
        content,
        source_block_ids: candidate.source_refs
          .map((ref) => ref.block_id)
          .filter(Boolean),
      }),
    });
    setSaveHint("已保存为专家笔记");
    await refreshDoc(docId);
  }

  function renderQuestionRefineProgress(progress: QuestionRefineProgress) {
    return (
      <section className={`quality-inline-panel question-refine-panel ${progress.status}`}>
        <div className="quality-inline-header">
          <span className="llm-pulse" />
          <div>
            <strong>追问改写 Agent 正在生成问题草稿</strong>
            <p>
              {progress.message}
              {progress.elapsedMs > 0
                ? ` · ${Math.round(progress.elapsedMs / 1000)}s`
                : ""}
            </p>
          </div>
        </div>
        <div className="llm-steps" aria-label="问题草稿生成过程">
          {QUESTION_REFINE_STEPS.map((step, i) => (
            <span
              key={step}
              className={
                i < progress.stepIndex
                  ? "done"
                  : i === progress.stepIndex
                    ? "active"
                    : ""
              }
            >
              {step}
            </span>
          ))}
        </div>
        <div className="llm-diagnostics">
          {progress.contextSummary ??
            `证据 ${focusEvidenceBlocks.length} 个 block${
              activeFieldQuality ? ` · 目标字段：${activeFieldQuality.label}` : ""
            }`}
        </div>
      </section>
    );
  }

  function renderQualityProgress(progress: LlmProgress) {
    const title =
      progress.status === "running"
        ? "质量检测进行中"
        : progress.status === "error"
          ? "质量检测失败"
          : "质量检测完成";

    return (
      <section
        className={`quality-inline-panel quality-timeline-panel ${progress.status} ${
          statusbarExpanded ? "expanded" : "compact"
        }`}
      >
        <div className="quality-inline-header">
          <span className="llm-pulse" />
          <div>
            <strong>{title}</strong>
            <p>
              {friendlyQualitySummary(progress)}
              {progress.elapsedMs > 0
                ? ` · ${Math.round(progress.elapsedMs / 1000)}s`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="statusbar-toggle"
            onClick={() => setStatusbarExpanded((v) => !v)}
          >
            {statusbarExpanded ? "收起" : "展开"}
          </button>
        </div>
        <div className="llm-steps" aria-label="质量检测过程">
          {LLM_STEPS.map((step, i) => (
            <span
              key={step}
              className={
                i < progress.stepIndex
                  ? "done"
                  : i === progress.stepIndex
                    ? "active"
                    : ""
              }
            >
              {step}
            </span>
          ))}
        </div>
        <div className="llm-diagnostics">
          {nextRecommendedTask
            ? `建议下一步：${nextRecommendedTask.title}。`
            : "全局推荐任务已处理完，接下来可以选择原文中的局部段落继续修订。"}
        </div>
        {visibleRecommendedTaskQueue.length > 0 && (
          <div className="quality-task-chips">
            {visibleRecommendedTaskQueue.map((task) => (
              <button
                key={task.id}
                type="button"
                className={`task-chip task-${task.status}`}
                disabled={isInteractionLocked || task.status === "completed"}
                onClick={() => useRecommendedTask(task)}
              >
                <span>{task.status === "completed" ? "已完成" : "待处理"}</span>
                {task.title}
              </button>
            ))}
            {hiddenRecommendedTaskCount > 0 && (
              <small className="event-hint">
                还有 {hiddenRecommendedTaskCount} 个待优化项已收起，可在局部原文中继续处理。
              </small>
            )}
          </div>
        )}
      </section>
    );
  }

  function renderLlmDebugDrawer() {
    if (!llmDebugOpen) return null;
    return (
      <aside className="llm-debug-drawer" aria-label="LLM DEBUG 调用信息">
        <header>
          <div>
            <span>DEBUG</span>
            <strong>LLM 调用详情</strong>
            <p>仅用于排查：展示发送给模型的 prompts 与调用参数，不包含 API Key。</p>
          </div>
          <button type="button" onClick={() => setLlmDebugOpen(false)}>
            关闭
          </button>
        </header>
        {llmDebugEntries.length === 0 ? (
          <div className="empty-state compact">
            还没有可查看的 LLM 调用。触发质量检测、问题改写或 QA 后会出现在这里。
          </div>
        ) : (
          <div className="llm-debug-list">
            {llmDebugEntries.map((entry) => (
              <details key={entry.id} className="llm-debug-entry">
                <summary>
                  <strong>{entry.label ?? entry.stage ?? "llm.call"}</strong>
                  <span>{sourceLabel(entry.source)}</span>
                  <small>
                    {entry.model ?? "unknown model"} · {entry.status ?? "ok"}
                    {entry.elapsed_ms != null
                      ? ` · ${Math.round(entry.elapsed_ms / 1000)}s`
                      : ""}
                  </small>
                </summary>
                {entry.status === "failed" && (
                  <p className="llm-debug-failure">
                    失败诊断：{llmDiagnosticSummary(entry)}
                  </p>
                )}
                <div className="llm-debug-grid">
                  <section>
                    <h4>调用参数</h4>
                    <pre>
                      {JSON.stringify(
                        {
                          provider: entry.provider,
                          model: entry.model,
                          timeout_ms: entry.timeout_ms,
                          prompt_chars: {
                            system: entry.system_prompt_chars,
                            user: entry.user_prompt_chars,
                          },
                          status: entry.status,
                          reason: entry.reason,
                          message: entry.message,
                          ...entry.request_params,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </section>
                  <section>
                    <h4>System Prompt</h4>
                    <pre>{entry.system_prompt ?? "未返回 system prompt"}</pre>
                  </section>
                  <section className="llm-debug-user-prompt">
                    <h4>User Prompt</h4>
                    <pre>{entry.user_prompt ?? "未返回 user prompt"}</pre>
                  </section>
                </div>
              </details>
            ))}
          </div>
        )}
      </aside>
    );
  }

  function renderCandidateCard(candidate: GTCandidate) {
    const isRunning = candidateStatus[candidate.candidate_id] === "running";
    const isDraft = candidate.status === "draft";
    return (
      <article className={`gt-candidate-card candidate-${candidate.status}`}>
        <header>
          <div>
            <span>候选补充内容</span>
            <strong>{FIELD_LABELS[candidate.field_key] ?? candidate.field_key}</strong>
          </div>
          <small>{candidateStatusLabel(candidate.status)}</small>
        </header>
        <textarea
          value={
            candidateEdits[candidate.candidate_id] ??
            summarizeContent(candidate.content, 800)
          }
          disabled={isInteractionLocked || !isDraft || isRunning}
          onChange={(e) =>
            setCandidateEdits((edits) => ({
              ...edits,
              [candidate.candidate_id]: e.target.value,
            }))
          }
        />
        <small>来源 block：{sourceBlockSummary(candidate)}</small>
        {candidate.rationale && <small>依据：{candidate.rationale}</small>}
        <div className="qa-button-row">
          <select
            value={candidateModes[candidate.candidate_id] ?? candidate.recommended_mode}
            disabled={isInteractionLocked || !isDraft || isRunning}
            onChange={(e) =>
              setCandidateModes((modes) => ({
                ...modes,
                [candidate.candidate_id]: e.target.value as "append" | "replace",
              }))
            }
          >
            <option value="append">追加到字段</option>
            <option value="replace">替换字段</option>
          </select>
          <button
            type="button"
            disabled={isInteractionLocked || !isDraft || isRunning}
            onClick={() => void confirmGTCandidate(candidate)}
          >
            {isRunning ? "处理中..." : "确认写入"}
          </button>
          <button
            type="button"
            disabled={isInteractionLocked || !isDraft || isRunning}
            onClick={() => void rejectGTCandidate(candidate)}
          >
            暂不采用
          </button>
          <button
            type="button"
            disabled={isInteractionLocked || isRunning}
            onClick={() => void saveCandidateAsExpertNote(candidate)}
          >
            保存为专家笔记
          </button>
        </div>
        {candidate.status === "confirmed" && (
          <small className="writeback-hint success">已写入结构化草稿。</small>
        )}
      </article>
    );
  }

  function renderStepEvent(thread: TaskThread, step: ThreadStep, key?: string) {
    const payload = step.payload as Record<string, unknown>;
    const fieldKey = typeof payload.field_key === "string" ? payload.field_key : thread.field_key;
    const eventClass =
      step.type === "question_sent"
        ? "event-user"
        : step.type === "agent_answered"
          ? "event-agent"
          : step.type === "note_saved"
            ? "event-note"
            : "event-system";

    return (
      <article key={key} className={`conversation-event ${eventClass} step-${step.type}`}>
        <header>
          <strong>{stepLabel(step)}</strong>
          <small>
            {fieldKey ? FIELD_LABELS[fieldKey] ?? fieldKey : "当前处理记录"} ·{" "}
            {thread.source_block_ids.length} 个证据
          </small>
        </header>
        <p>{stepSummary(step)}</p>
        {step.type === "task_started" && (
          <div className="event-actions">
            <button
              type="button"
              disabled={isInteractionLocked || isQuestionRefining}
              onClick={() => void askWithFocus()}
            >
              生成追问草稿
            </button>
          </div>
        )}
        {step.type === "question_suggested" && (
          <small className="event-hint">问题已放入输入框，可修改后发送。</small>
        )}
      </article>
    );
  }

  function renderTurnEvent(event: Extract<ConversationEvent, { kind: "turn" }>) {
    const questionPayload = (event.questionStep?.payload ?? {}) as Record<string, unknown>;
    const answerPayload = (event.answerStep?.payload ?? {}) as Record<string, unknown>;
    const writebackPayload = (event.writebackStep?.payload ?? {}) as Record<string, unknown>;
    const question =
      typeof questionPayload.question === "string"
        ? questionPayload.question
        : typeof questionPayload.refined_question === "string"
          ? questionPayload.refined_question
          : event.thread.recommended_question ?? "围绕当前上下文的专家追问";
    const answer =
      typeof answerPayload.answer === "string"
        ? answerPayload.answer
        : "Agent 正在结合证据生成回答。";
    const fieldKey =
      (typeof answerPayload.target_field === "string"
        ? answerPayload.target_field
        : event.thread.field_key) ?? event.candidate?.field_key;
    return (
      <article key={event.id} className="conversation-turn">
        <header>
          <div>
            <span>问答回合</span>
            <strong>{fieldKey ? friendlyFieldLabel(fieldKey) : "当前上下文"}</strong>
          </div>
          <small>{event.thread.source_block_ids.length} 个证据</small>
        </header>
        {event.questionStep && (
          <section className="turn-message turn-user">
            <strong>你</strong>
            <p>{question}</p>
          </section>
        )}
        {event.answerStep && (
          <section className="turn-message turn-agent">
            <strong>Agent 回答</strong>
            <p>{answer}</p>
          </section>
        )}
        {event.candidate && (
          <section className="turn-candidate">
            <span>可确认的候选补充内容</span>
            {renderCandidateCard(event.candidate)}
          </section>
        )}
        {event.writebackStep && (
          <small
            className={`writeback-hint ${
              event.writebackStep.type === "writeback_confirmed" ? "success" : ""
            }`}
          >
            {event.writebackStep.type === "writeback_confirmed"
              ? `已写入${friendlyFieldLabel(
                  typeof writebackPayload.field_key === "string"
                    ? writebackPayload.field_key
                    : fieldKey,
                )}。`
              : "这条候选内容已暂不采用。"}
          </small>
        )}
        {event.completionStep && (
          <small className="event-hint">这个任务已完成，可继续处理下一个推荐任务。</small>
        )}
      </article>
    );
  }

  function renderConversationEvent(event: ConversationEvent) {
    if (event.kind === "turn") {
      return renderTurnEvent(event);
    }
    if (event.kind === "quality_progress") {
      return (
        <article key={event.id} className="conversation-event event-system">
          {renderQualityProgress(event.progress)}
        </article>
      );
    }
    if (event.kind === "question_refine_progress") {
      return (
        <article key={event.id} className="conversation-event event-agent">
          {renderQuestionRefineProgress(event.progress)}
        </article>
      );
    }
    if (event.kind === "candidate") {
      return (
        <article
          key={event.id}
          className="conversation-event event-candidate"
        >
          {renderCandidateCard(event.candidate)}
        </article>
      );
    }
    if (event.kind === "note") {
      return (
        <article key={event.id} className="conversation-event event-note">
          <header>
            <strong>专家笔记</strong>
            <small>{event.note.source_block_ids.length} 个来源证据</small>
          </header>
          <p>{event.note.content}</p>
        </article>
      );
    }
    if (event.kind === "message") {
      return (
        <article
          key={event.id}
          className={`conversation-event ${
            event.message.role === "user" ? "event-user" : "event-agent"
          } ${event.message.status ?? ""}`}
        >
          <header>
            <strong>{event.message.role === "user" ? "你" : "Agent"}</strong>
            {event.message.status === "pending" && <small>正在处理</small>}
            {event.message.status === "error" && <small>需要重试</small>}
          </header>
          <p>{event.message.text}</p>
          {event.message.qa?.llm_diagnostics?.status === "failed" && (
            <small className="qa-diagnostic-warning">
              LLM 诊断：{llmDiagnosticSummary(event.message.qa.llm_diagnostics)}
            </small>
          )}
        </article>
      );
    }
    return renderStepEvent(event.thread, event.step, event.id);
  }

  return (
    <div className="app-root" style={appStyle}>
      <header className="topbar">
        <div>
          <button
            type="button"
            disabled={isInteractionLocked}
            onClick={() => void createDoc()}
          >
            新建文档
          </button>
          <span style={{ marginLeft: 12, fontWeight: 600 }}>{title}</span>
        </div>
        <div className="meta">
          {docId ? (
            <>
              版本 {meta?.current_version_id ?? "—"} · 状态{" "}
              {meta?.document_status ?? "—"} · 完整度 {completeness}% ·{" "}
              {saveHint}
            </>
          ) : (
            "未加载文档"
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label>
            <span style={{ fontSize: 12, marginRight: 6 }}>导入</span>
            <input
              type="file"
              disabled={!docId || isInteractionLocked}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
              }}
            />
          </label>
          <button
            type="button"
            disabled={!docId || !ir?.blocks.length || isInteractionLocked}
            onClick={() => void runExtract()}
          >
            质量检测
          </button>
          <button
            type="button"
            disabled={!docId || isInteractionLocked}
            onClick={() => void newVersion()}
          >
            生成新版本
          </button>
        </div>
      </header>

      <div
        className={`shell-inner ${isInteractionLocked ? "interaction-locked" : ""}`}
        aria-busy={isInteractionLocked}
      >
        <section className="pane">
          {!docId || !ir?.blocks.length ? (
            <div className="empty-state">
              {docId && parseStatus !== "idle" ? (
                <div className="processing-card">
                  <strong>后台正在处理文档</strong>
                  <p>
                    {parseStatus === "uploading"
                      ? "正在上传源文件..."
                      : parseStatus === "processing"
                        ? "已上传，正在解析、切块并生成 Document IR..."
                        : "解析任务已提交，正在等待切块结果写入文档区..."}
                  </p>
                  <ol>
                    <li className="done">
                      接收源文件
                    </li>
                    <li
                      className={
                        parseStatus === "processing" ||
                        parseStatus === "waiting_ir" ||
                        parseStatus === "ready"
                          ? "done"
                          : ""
                      }
                    >
                      后台解析与切块
                    </li>
                    <li
                      className={
                        parseStatus === "waiting_ir" || parseStatus === "ready"
                          ? "active"
                          : ""
                      }
                    >
                      加载原文 block
                    </li>
                  </ol>
                </div>
              ) : (
                <>
                  <p>导入 Markdown / PDF / 图片 / Docx / Excel 开始。</p>
                  <p style={{ fontSize: 13 }}>右侧可与 Agent 协作问答与修订。</p>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="tabs">
                <button
                  type="button"
                  disabled={isInteractionLocked}
                  className={leftMode === "original" ? "active" : ""}
                  onClick={() => setLeftMode("original")}
                >
                  原文
                </button>
                <button
                  type="button"
                  disabled={isInteractionLocked}
                  className={leftMode === "structured" ? "active" : ""}
                  onClick={() => setLeftMode("structured")}
                >
                  结构化
                </button>
                <button
                  type="button"
                  disabled={isInteractionLocked}
                  className={leftMode === "compare" ? "active" : ""}
                  onClick={() => setLeftMode("compare")}
                >
                  对照
                </button>
              </div>

              {leftMode === "original" &&
                ir.blocks.map((b) => (
                  <div
                    key={b.block_id}
                    role="button"
                    tabIndex={isInteractionLocked ? -1 : 0}
                    className={`block ${selectedBlockId === b.block_id ? "selected" : ""} ${
                      blockFieldIndex.has(b.block_id) ? "mapped" : ""
                    }`}
                    onClick={() => {
                      if (!isInteractionLocked) setSelectedBlockId(b.block_id);
                    }}
                    onKeyDown={(e) => {
                      if (
                        !isInteractionLocked &&
                        (e.key === "Enter" || e.key === " ")
                      )
                        setSelectedBlockId(b.block_id);
                    }}
                  >
                    {selectedBlockId === b.block_id && (
                      <div
                        className="block-dialog-anchor"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="block-add-dialog-button"
                          disabled={isInteractionLocked || isQaRunning}
                          onClick={() => addBlockToChat(b.block_id)}
                        >
                          添加到对话
                        </button>
                      </div>
                    )}
                    {b.block_type === "image" && b.media_uri ? (
                      <img
                        src={api(b.media_uri)}
                        alt=""
                        style={{ maxWidth: "100%", display: "block" }}
                      />
                    ) : b.block_type === "table" ? (
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 12,
                        }}
                      >
                        {b.text_content}
                      </pre>
                    ) : b.block_type === "heading" ? (
                      <h3>{b.text_content}</h3>
                    ) : (
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {b.text_content}
                      </pre>
                    )}
                    <small style={{ color: "var(--muted)" }}>{b.block_type}</small>
                  </div>
                ))}

              {leftMode === "structured" && draft && (
                <div className="field-grid">
                  {fieldQualityRows.map((row) => (
                    <button
                      key={row.fieldKey}
                      type="button"
                      className={`field-card field-status-${row.status}`}
                      onClick={() => {
                        focusField(row, row.status === "covered" ? "field" : "gap");
                      }}
                    >
                      <header>
                        <span>{row.label}</span>
                        <span>{row.statusLabel}</span>
                      </header>
                      <p>{row.reason}</p>
                      <small>
                        内容 {row.items.length} 条 · 出处 {row.sourceBlockIds.length} 个
                      </small>
                    </button>
                  ))}
                </div>
              )}

              {leftMode === "compare" && draft && (
                <div className="compare-task-detail">
                  <section className="focus-hero">
                    <span>推荐任务列表</span>
                    <h3>对照区任务队列</h3>
                    <p>{taskQueueSummary}</p>
                    <div className="recommended-task-list">
                      {visibleRecommendedTaskQueue.length === 0 ? (
                        <div className="empty-state compact">
                          暂无推荐任务。可以先运行质量检测，或直接从原文选择局部 block 发问。
                        </div>
                      ) : (
                        <>
                          {visibleRecommendedTaskQueue.map((task, index) => (
                            <button
                              key={task.id}
                              type="button"
                              className={`recommended-task-row task-${task.status}`}
                              disabled={isInteractionLocked}
                              onClick={() => useRecommendedTask(task)}
                            >
                              <span>{index + 1}</span>
                              <strong>{task.title}</strong>
                              <small>
                                {task.status === "completed"
                                  ? "已完成"
                                  : task.status === "active"
                                    ? "处理中"
                                    : "待处理"}
                              </small>
                              <p>{task.reason}</p>
                            </button>
                          ))}
                          {hiddenRecommendedTaskCount > 0 && (
                            <div className="event-hint">
                              还有 {hiddenRecommendedTaskCount} 个待优化项已收起，建议先完成上方主任务。
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="focus-actions">
                      <button
                        type="button"
                          disabled={
                            isInteractionLocked ||
                            isQuestionRefining ||
                            !focusRecommendedQuestion
                          }
                          onClick={() => void askWithFocus()}
                      >
                        生成追问草稿
                      </button>
                      {nextRecommendedTask && !activeFieldQuality && (
                        <button
                          type="button"
                          disabled={isInteractionLocked}
                          onClick={() => useRecommendedTask(nextRecommendedTask)}
                        >
                          处理下一个推荐任务
                        </button>
                      )}
                    </div>
                  </section>

                  <div className="compare-task-layout">
                    <section className="task-card">
                      <h3>候选证据</h3>
                      <p>只展示和当前任务有关的原文 block。点击可作为证据加入问答上下文。</p>
                      {(focusEvidenceBlocks.length
                        ? focusEvidenceBlocks
                        : activeFieldBlocks
                      ).slice(0, 4).map((block) => (
                        <button
                          key={block.block_id}
                          type="button"
                          className={`compare-block ${
                            selectedBlockId === block.block_id ? "selected" : ""
                          }`}
                          onClick={() => focusBlock(block.block_id)}
                        >
                          <strong>{block.block_type}</strong>
                          <span>{block.text_content.slice(0, 180)}</span>
                        </button>
                      ))}
                      {focusEvidenceBlocks.length === 0 && activeFieldBlocks.length === 0 && (
                        <small>暂无候选证据，可先在原文视图选择一个 block。</small>
                      )}
                    </section>

                    <section className="task-card">
                      <h3>结构化现状</h3>
                      {activeFieldQuality ? (
                        <>
                          <div className={`detail-card field-status-${activeFieldQuality.status}`}>
                            <header>
                              <strong>{activeFieldQuality.label}</strong>
                              <span>{activeFieldQuality.statusLabel}</span>
                            </header>
                            <p>{activeFieldQuality.definition}</p>
                          </div>
                          {activeFieldQuality.items.length ? (
                            activeFieldQuality.items.slice(0, 3).map((item, index) => (
                              <div
                                key={`${activeFieldQuality.fieldKey}-${index}`}
                                className="linked-field-card"
                              >
                                <header>
                                  <strong>条目 {index + 1}</strong>
                                  <span>{item.status ?? "Drafted"}</span>
                                </header>
                                <p>{summarizeContent(item.content)}</p>
                              </div>
                            ))
                          ) : (
                            <div className="empty-state compact">
                              该字段暂无内容，建议直接通过问答补齐。
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="focus-task-list-compact">
                          {focusTaskRows.slice(0, 6).map((row) => (
                            <button
                              key={row.fieldKey}
                              type="button"
                              className={`field-quality-row field-status-${row.status}`}
                              onClick={() => focusField(row, "gap")}
                            >
                              <span className="status-dot" />
                              <strong>{row.label}</strong>
                              <small>{row.statusLabel}</small>
                              <span>{row.reason}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <div
          className="pane-resizer"
          role="separator"
          aria-label="调整左右栏宽度"
          aria-orientation="vertical"
          aria-valuemin={38}
          aria-valuemax={68}
          aria-valuenow={leftPanePercent}
          tabIndex={0}
          onPointerDown={startPaneResize}
          onKeyDown={handlePaneResizerKeyDown}
        />

        <section className="pane collaboration-pane">
          <div className="context-bar workbench-bar">
            <div className="focus-task-header">
              <span>任务工作台</span>
              <strong>{taskQueueSummary}</strong>
            </div>
            <p>
              {activeFieldQuality
                ? `已选中“${activeFieldQuality.label}”，可以生成追问草稿或补写建议。`
                : focusEvidenceBlocks.length > 0
                  ? `已选择 ${focusEvidenceBlocks.length} 个原文证据，可直接带上下文提问。`
                  : "先从对照区选择推荐任务，或在原文中点选局部 block。"}
            </p>
            {nextRecommendedTask ? (
              <button
                type="button"
                className="recommended-question"
                disabled={isInteractionLocked || nextRecommendedTask.status === "completed"}
                onClick={() => useRecommendedTask(nextRecommendedTask)}
              >
                建议下一步：{nextRecommendedTask.title}
              </button>
            ) : (
              <small className="event-hint">
                全局任务完成后，请回到原文选择局部段落继续问答修订。
              </small>
            )}
            <div className="focus-actions">
              <button
                type="button"
                disabled={
                  isInteractionLocked ||
                  isQuestionRefining ||
                  !focusRecommendedQuestion
                }
                onClick={() => void askWithFocus()}
              >
                生成追问草稿
              </button>
              <button
                type="button"
                disabled={isInteractionLocked || focusEvidenceBlocks.length === 0}
                onClick={() => void generateSuggestionsForFocus()}
              >
                生成补写建议
              </button>
              <button
                type="button"
                disabled={isInteractionLocked}
                onClick={() => setLeftMode("compare")}
              >
                查看任务队列
              </button>
            </div>
          </div>

          <div
            ref={conversationTimelineRef}
            className="message-list conversation-timeline"
            onScroll={handleConversationScroll}
          >
            {conversationEvents.length > 0 ? (
              conversationEvents.map((event) => renderConversationEvent(event))
            ) : (
              <div className="empty-state compact conversation-empty">
                选择一个缺口、字段或原文证据后，Agent 会在这里生成追问、回答和可确认的补充内容。
              </div>
            )}
          </div>
          {hasUnseenConversationUpdate && (
            <button
              type="button"
              className="jump-latest-button"
              onClick={scrollConversationToLatest}
            >
              有新回复，跳到最新
            </button>
          )}

          <div
            className={`composer-input-shell ${
              activeFieldQuality || focusEvidenceBlocks.length > 0
                ? "has-context"
                : ""
            }`}
            onClick={() => chatInputRef.current?.focus()}
          >
            {(activeFieldQuality || focusEvidenceBlocks.length > 0) && (
              <div className="composer-inline-context" aria-label="已加入对话上下文">
                <span className="composer-inline-label">已加入对话上下文</span>
                <span className="context-mode-chip">
                  {qaContext.mode === "direct_qa" ? "直接 QA" : "任务追问"}
                </span>
                {activeFieldQuality && qaContext.mode !== "direct_qa" && (
                  <span>目标字段：{activeFieldQuality.label}</span>
                )}
                {focusContext.gapMessage && qaContext.mode !== "direct_qa" && (
                  <span>缺口：{focusContext.gapMessage}</span>
                )}
                {focusRecommendedQuestion && qaContext.mode !== "direct_qa" && (
                  <button
                    type="button"
                    disabled={isInteractionLocked || isQuestionRefining}
                    onClick={prepareDirectContextQuestion}
                  >
                    推荐追问：{focusRecommendedQuestion}
                  </button>
                )}
                {focusEvidenceBlocks.map((block) => (
                  <span key={block.block_id} className="context-evidence-chip">
                    <button
                      type="button"
                      disabled={isInteractionLocked || isQuestionRefining}
                      onClick={() => focusBlock(block.block_id)}
                    >
                      {block.source_span ? `${block.source_span} / ` : ""}
                      {block.block_type}: {block.text_content.slice(0, 42)}
                    </button>
                    <button
                      type="button"
                      aria-label={`移除证据 ${block.block_id}`}
                      disabled={isInteractionLocked || isQuestionRefining}
                      onClick={() => removeEvidenceBlockFromContext(block.block_id)}
                    >
                      移除
                    </button>
                  </span>
                ))}
              </div>
            )}

            <textarea
              ref={chatInputRef}
              className="chat-input"
              value={input}
              placeholder={
                activeFieldQuality
                  ? `围绕“${activeFieldQuality.label}”追问，会带上当前证据上下文。`
                  : "选择一个缺口、字段或原文证据后开始专家问答。"
              }
              disabled={isInteractionLocked || isQuestionRefining}
              aria-busy={isQaRunning || isQuestionRefining}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="send-button"
            disabled={isInteractionLocked || isQaRunning || isQuestionRefining}
            onClick={() => void sendMessage()}
          >
            {isQuestionRefining
              ? "正在生成追问草稿..."
              : isQaRunning
              ? "QA 思考中..."
              : activeFieldQuality || focusEvidenceBlocks.length
                ? "带上下文提问"
                : "发送"}
          </button>
          <button
            type="button"
            className="llm-debug-toggle"
            disabled={llmDebugEntries.length === 0}
            onClick={() => setLlmDebugOpen((v) => !v)}
          >
            DEBUG · LLM 调用 {llmDebugEntries.length}
          </button>
        </section>
      </div>

      {renderLlmDebugDrawer()}

      <div
        className="drawer-resizer"
        role="separator"
        aria-label="调整底栏高度"
        aria-orientation="horizontal"
        aria-valuemin={140}
        aria-valuemax={Math.round(Math.min(520, window.innerHeight * 0.55))}
        aria-valuenow={Math.round(bottomDrawerHeight)}
        tabIndex={0}
        onPointerDown={startDrawerResize}
        onKeyDown={handleDrawerResizerKeyDown}
      />

      <footer className="drawer">
        <div className="drawer-tabs">
          {(
            [
              ["suggestions", "待确认建议"],
              ["diff", "版本 Diff"],
              ["fields", "结构字段变化"],
              ["eval", "任务与问题"],
              ["audit", "操作日志"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={isInteractionLocked}
              className={drawerTab === id ? "active" : ""}
              onClick={() => setDrawerTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="drawer-body">
          {drawerTab === "suggestions" && (
            <ul>
              {suggestions.map((s) => (
                <li key={s.suggestion_id}>
                  {s.suggestion_type} → {s.suggestion_text.slice(0, 80)}
                </li>
              ))}
              {suggestions.length === 0 && <li>暂无待确认建议</li>}
            </ul>
          )}
          {drawerTab === "diff" && (
            <div className="version-panel">
              <div className="version-actions">
                <button
                  type="button"
                  disabled={isInteractionLocked || versions.length < 2}
                  onClick={() => void compareLatestVersions()}
                >
                  对比最近两个版本评分
                </button>
                <span>当前版本：{meta?.current_version_id ?? "—"}</span>
              </div>
              {scoreCompare && (
                <div className="score-compare">
                  <strong>{scoreCompare.summary_zh}</strong>
                  <div className="delta-grid">
                    {Object.entries(scoreCompare.delta_scores).map(([key, value]) => (
                      <span key={key} className={value && value > 0 ? "up" : value && value < 0 ? "down" : ""}>
                        {scorecard?.metric_definitions?.[key]?.label ?? key}:{" "}
                        {value == null ? "—" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <ul>
                {versions.length === 0 ? (
                  <li>暂无版本记录。专家回写后可点击“生成新版本”。</li>
                ) : (
                  versions.map((v) => (
                    <li key={v.version_id}>
                      <strong>{v.version_id}</strong>
                      {v.parent_version_id ? ` ← ${v.parent_version_id}` : ""}
                      <br />
                      <small>{v.created_at} · {v.change_summary || "无摘要"}</small>
                    </li>
                  ))
                )}
              </ul>
              {diffPreview && (
                <pre style={{ whiteSpace: "pre-wrap" }}>{diffPreview}</pre>
              )}
            </div>
          )}
          {drawerTab === "fields" && (
            <pre style={{ fontSize: 12 }}>
              {draft
                ? JSON.stringify(draft.confidence_by_field, null, 2)
                : "—"}
            </pre>
          )}
          {drawerTab === "eval" && (
            <div style={{ fontSize: 13 }}>
              <p>
                <strong>状态</strong>{" "}
                {scorecard?.overall_status ?? "—"}
                {scorecard?.mode ? ` · ${scorecard.mode}` : ""}
              </p>
              {metricRows.length ? (
                <table className="metric-table">
                  <thead>
                    <tr>
                      <th>指标名称</th>
                      <th>指标定义</th>
                      <th>值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.map((row) => (
                      <tr key={row.name} className={row.status}>
                        <td>{row.name}</td>
                        <td>{row.definition}</td>
                        <td>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>尚无评分（先运行质量检测）</p>
              )}
              {readinessRows.length ? (
                <>
                  <p style={{ marginTop: 8 }}>
                    <strong>核心要素完整度</strong>
                  </p>
                  <table className="metric-table compact">
                    <thead>
                      <tr>
                        <th>指标名称</th>
                        <th>指标定义</th>
                        <th>值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readinessRows.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.definition}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
              <p style={{ marginTop: 8 }}>
                <strong>补强计划</strong>
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(improvementPlan?.priority_actions ?? []).length === 0 ? (
                  <li>暂无优先动作</li>
                ) : (
                  improvementPlan!.priority_actions.map((a, i) => (
                    <li key={i}>
                      <strong>{a.metric_display_name ?? a.metric}</strong> — {a.reason}
                      <div style={{ opacity: 0.85 }}>
                        {(a.actions_display ?? a.actions).join(" · ")}
                      </div>
                    </li>
                  ))
                )}
              </ul>
              <p style={{ marginTop: 8 }}>
                <strong>候选问题</strong>
              </p>
              <div className="candidate-list">
                {candidateQuestions.length === 0 ? (
                  <span style={{ color: "var(--muted)" }}>暂无候选问题</span>
                ) : (
                  candidateQuestions.map((q, i) => (
                    <button
                      key={`${q.metric}-${i}`}
                      type="button"
                      disabled={isInteractionLocked}
                      onClick={() => useCandidateQuestion(q)}
                    >
                      <strong>{q.metric_label}</strong>
                      <span>{q.question}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          {drawerTab === "audit" && (
            <ul>
              {(meta?.audit ?? []).slice(-12).map((a, i) => (
                <li key={i}>
                  {a.at} — {a.action} {a.detail ?? ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </footer>
    </div>
  );
}
