import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentIR } from "@ebs/document-ir";
import type {
  GroundTruthDraft,
  GroundTruthFieldItem,
  SuggestionRecord,
} from "@ebs/ground-truth-schema";
import {
  FIELD_DEFINITIONS_ZH,
  GROUND_TRUTH_FIELD_KEYS,
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
    stage: "knowledge_skeleton" | "draft" | "strict_retry" | "rules";
    status: "ok" | "failed" | "skipped";
    reason?: string;
    message?: string;
  }[];
  llm_failure_reason?: string;
  llm_failure_message?: string;
  schema_issues?: string[];
  quality_issues?: string[];
};

type ExtractResponse = {
  draft: GroundTruthDraft;
  scorecard?: EvalScorecard;
  improvement_plan?: EvalPlan;
  structuring_mode?: string;
  parse_diagnostics?: ParseDiagnostics;
  structuring_diagnostics?: StructuringDiagnostics;
};

type QAResponse = {
  direct_answer: string;
  rationale: string;
  source_block_refs: string[];
  next_step_suggestion?: string;
  target_field?: string | null;
  suggested_writeback?: {
    field_key: string;
    content: unknown;
  };
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

type LlmProgressStatus = "idle" | "running" | "success" | "error";

type LlmProgress = {
  status: LlmProgressStatus;
  stepIndex: number;
  startedAt?: number;
  elapsedMs: number;
  message: string;
  diagnostics?: StructuringDiagnostics;
  parseDiagnostics?: ParseDiagnostics;
};

type ParseStatus = "idle" | "uploading" | "processing" | "waiting_ir" | "ready";

const LLM_STEPS = [
  "识别文档质量缺口",
  "提炼专家知识骨架",
  "映射结构化字段",
  "校验可用性与出处",
  "生成质量建议",
] as const;

const idleLlmProgress: LlmProgress = {
  status: "idle",
  stepIndex: 0,
  elapsedMs: 0,
  message: "等待结构化抽取",
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

const emptyFocusContext: FocusContext = {
  kind: "none",
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
  const [qaContext, setQaContext] = useState<{
    blockId: string | null;
    targetField?: string | null;
    metric?: string | null;
  }>({ blockId: null });
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>([]);
  const [publishInfo, setPublishInfo] = useState<PublishInfo | null>(null);
  const [diffPreview, setDiffPreview] = useState<string>("");
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [scoreCompare, setScoreCompare] = useState<ScoreCompareResponse | null>(
    null,
  );
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
  const [statusbarExpanded, setStatusbarExpanded] = useState(false);
  const [qualityPanelVisible, setQualityPanelVisible] = useState(false);

  const isInteractionLocked =
    isUploading || llmProgress.status === "running";

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
  }, []);

  useEffect(() => {
    if (!docId) return;
    const t = setInterval(() => void refreshDoc(docId), 4000);
    return () => clearInterval(t);
  }, [docId, refreshDoc]);

  const selectedBlock = useMemo(
    () => ir?.blocks.find((b) => b.block_id === selectedBlockId),
    [ir, selectedBlockId],
  );

  const qualityStatusText = useMemo(() => {
    const elapsed =
      llmProgress.elapsedMs > 0
        ? ` · ${Math.round(llmProgress.elapsedMs / 1000)}s`
        : "";
    if (llmProgress.status === "idle") return "等待结构化抽取";
    if (llmProgress.status === "running") {
      return `${llmProgress.message}${elapsed}`;
    }
    if (llmProgress.status === "success") {
      const diag = llmProgress.diagnostics?.llm_failure_reason
        ? ` · ${llmProgress.diagnostics.llm_failure_reason}`
        : "";
      return `${llmProgress.message}${elapsed}${diag}`;
    }
    return `${llmProgress.message}${elapsed}`;
  }, [llmProgress]);

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

  const primaryFocusTask = focusTaskRows[0];

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

  const focusStatusSummary = useMemo(() => {
    if (!draft) return "等待结构化抽取后生成待处理任务";
    const pending = focusTaskRows.length;
    if (pending === 0) return "核心要素已覆盖，可进入复核或生成版本";
    const first = primaryFocusTask;
    return `还有 ${pending} 个关键要素待处理，当前优先：${first?.label ?? "—"}`;
  }, [draft, focusTaskRows.length, primaryFocusTask]);

  const focusRecommendedQuestion =
    focusContext.recommendedQuestion ??
    activeFieldQuality?.candidateQuestions[0]?.question ??
    (activeFieldQuality
      ? `请补充“${activeFieldQuality.label}”：${activeFieldQuality.definition}`
      : selectedBlock
        ? "请判断这段原文是否能补充当前 GroundTruth，并给出可回写内容。"
        : "");

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

  const llmAttemptSummary = useMemo(() => {
    const attempts = llmProgress.diagnostics?.attempts ?? [];
    return attempts
      .map((a) => {
        const status =
          a.status === "ok" ? "完成" : a.status === "failed" ? "失败" : "跳过";
        return `${a.stage}: ${status}${a.reason ? ` (${a.reason})` : ""}`;
      })
      .join(" · ");
  }, [llmProgress.diagnostics]);

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
    setQualityPanelVisible(false);
    setFocusContext(emptyFocusContext);
    setSelectedBlockId(null);
    setActiveFieldKey(null);
    setLlmProgress(idleLlmProgress);
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
        message: "文档解析尚未完成，请等待原文切块出现后再抽取。",
      });
      return;
    }
    const startedAt = Date.now();
    setQualityPanelVisible(true);
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
          r.structuring_mode === "llm"
            ? "LLM 抽取完成，已通过质量检查"
            : "已完成抽取，但使用了规则兜底",
        diagnostics: r.structuring_diagnostics,
        parseDiagnostics: r.parse_diagnostics,
      });
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
            : "结构化抽取失败，请查看服务端日志。",
      });
    } finally {
      window.clearInterval(timer);
    }
  }

  async function sendMessage() {
    if (!docId || !input.trim() || isInteractionLocked || isQaRunning) return;
    const q = input.trim();
    const context =
      qaContext.blockId ??
      focusContext.blockId ??
      focusEvidenceBlockIds[0] ??
      selectedBlockId;
    const targetField =
      qaContext.targetField ?? focusContext.fieldKey ?? activeFieldKey;
    const metric = qaContext.metric ?? focusContext.metric;
    setInput("");
    setQaContext({ blockId: null });
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: q,
        blockId: context,
        targetField,
      },
    ]);
    setPhase("qa");
    const pendingId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      {
        id: pendingId,
        role: "agent",
        text: "QA Agent 正在结合焦点任务、证据原文和专家偏好思考...",
        question: q,
        blockId: context,
        targetField,
        status: "pending",
      },
    ]);
    setIsQaRunning(true);
    try {
      const qa = await fetchJsonWithTimeout<QAResponse>(
        api(`/documents/${docId}/qa`),
        {
          method: "POST",
          body: JSON.stringify({
            block_id: context,
            question: q,
            target_field: targetField,
            metric,
          }),
        },
        35_000,
      );
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingId
            ? {
                id: pendingId,
                role: "agent",
                text: qa.direct_answer,
                qa,
                question: q,
                blockId: context,
                targetField: qa.target_field ?? targetField,
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
                text:
                  err instanceof Error
                    ? err.message
                    : "QA Agent 暂时没有响应，请稍后重试。",
                status: "error",
              }
            : msg,
        ),
      );
    } finally {
      setIsQaRunning(false);
    }
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
      blockId: q.source_block_id ?? selectedBlockId,
      targetField: q.target_field,
      metric: q.metric,
    });
    setInput(q.question);
  }

  function focusField(row: FieldQualityRow, kind: "field" | "gap" = "field") {
    setActiveFieldKey(row.fieldKey);
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
  }

  function focusBlock(blockId: string) {
    setSelectedBlockId(blockId);
    const linkedField = blockFieldIndex.get(blockId)?.[0]?.fieldKey;
    if (linkedField && !focusContext.fieldKey) setActiveFieldKey(linkedField);
    setFocusContext((prev) => {
      const fieldKey = prev.fieldKey ?? linkedField ?? null;
      const row = fieldKey ? fieldQualityByKey.get(fieldKey) : undefined;
      return {
        kind: fieldKey ? prev.kind === "none" ? "field" : prev.kind : "block",
        fieldKey,
        blockId,
        gapMessage: prev.gapMessage ?? row?.reason,
        evidenceBlockIds: uniqueStrings([...prev.evidenceBlockIds, blockId]),
        recommendedQuestion:
          prev.recommendedQuestion ??
          row?.candidateQuestions[0]?.question ??
          (fieldKey
            ? `请基于这段原文补充“${FIELD_LABELS[fieldKey] ?? fieldKey}”。`
            : "请判断这段原文能补充哪个 GroundTruth 字段，并给出可回写内容。"),
        metric: prev.metric,
      };
    });
  }

  function askWithFocus() {
    const fieldKey = focusContext.fieldKey ?? activeFieldQuality?.fieldKey;
    const blockId =
      focusContext.blockId ?? focusEvidenceBlockIds[0] ?? selectedBlockId;
    setQaContext({
      blockId: blockId ?? null,
      targetField: fieldKey,
      metric: focusContext.metric,
    });
    setInput(
      focusRecommendedQuestion ||
        "请结合当前焦点任务和证据原文，给出可回写到 GroundTruth 的专家答案。",
    );
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

  return (
    <>
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
            结构化抽取
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
                      if (!isInteractionLocked) focusBlock(b.block_id);
                    }}
                    onKeyDown={(e) => {
                      if (
                        !isInteractionLocked &&
                        (e.key === "Enter" || e.key === " ")
                      )
                        focusBlock(b.block_id);
                    }}
                  >
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
                    <span>当前任务</span>
                    <h3>
                      {activeFieldQuality
                        ? activeFieldQuality.label
                        : primaryFocusTask?.label ?? "选择一个 GAP 或字段开始"}
                    </h3>
                    <p>
                      {activeFieldQuality?.reason ??
                        primaryFocusTask?.reason ??
                        "系统会把关键缺口、候选证据和建议问题收口成一个任务，避免在多个列表之间来回切换。"}
                    </p>
                    <div className="focus-actions">
                      <button
                        type="button"
                        disabled={isInteractionLocked || !focusRecommendedQuestion}
                        onClick={askWithFocus}
                      >
                        带上下文提问
                      </button>
                      {primaryFocusTask && !activeFieldQuality && (
                        <button
                          type="button"
                          disabled={isInteractionLocked}
                          onClick={() => focusField(primaryFocusTask, "gap")}
                        >
                          处理系统推荐任务
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

        <section className="pane collaboration-pane">
          <div className="context-bar focus-task-bar">
            <div className="focus-task-header">
              <span>Focus Task</span>
              <strong>
                {activeFieldQuality
                  ? activeFieldQuality.label
                  : selectedBlock
                    ? `原文证据 · ${selectedBlock.block_type}`
                    : "未选择任务"}
              </strong>
              {activeFieldQuality && (
                <span className={`focus-status field-status-${activeFieldQuality.status}`}>
                  {activeFieldQuality.statusLabel}
                </span>
              )}
            </div>
            <p>{activeFieldQuality?.reason ?? focusStatusSummary}</p>
            <div className="focus-meta-row">
              <span>页面阶段：{phase}</span>
              <span>证据：{focusEvidenceBlocks.length} 个 block</span>
              <span>质量：{qualityStatusText}</span>
              {llmProgress.status !== "idle" && !qualityPanelVisible && (
                <button
                  type="button"
                  className="inline-link-button"
                  onClick={() => setQualityPanelVisible(true)}
                >
                  查看过程
                </button>
              )}
            </div>
            {focusRecommendedQuestion && (
              <button
                type="button"
                className="recommended-question"
                disabled={isInteractionLocked}
                onClick={askWithFocus}
              >
                推荐追问：{focusRecommendedQuestion}
              </button>
            )}
            <div className="focus-actions">
              <button
                type="button"
                disabled={isInteractionLocked || !focusRecommendedQuestion}
                onClick={askWithFocus}
              >
                带上下文提问
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
                查看任务详情
              </button>
            </div>
          </div>

          {focusTaskRows.length > 0 && (
            <div className="focus-task-queue">
              <strong>系统推荐下一步</strong>
              {focusTaskRows.slice(0, 4).map((row) => (
                <button
                  key={row.fieldKey}
                  type="button"
                  className={`focus-task-item field-status-${row.status} ${
                    activeFieldQuality?.fieldKey === row.fieldKey ? "active" : ""
                  }`}
                  disabled={isInteractionLocked}
                  onClick={() => focusField(row, row.status === "covered" ? "field" : "gap")}
                >
                  <span>{row.label}</span>
                  <small>{row.statusLabel} · {row.reason}</small>
                </button>
              ))}
            </div>
          )}

          {(activeFieldQuality || focusEvidenceBlocks.length > 0) && (
            <div className="chat-context-strip">
              {activeFieldQuality && (
                <span>目标字段：{activeFieldQuality.label}</span>
              )}
              {focusEvidenceBlocks.map((block) => (
                <button
                  key={block.block_id}
                  type="button"
                  disabled={isInteractionLocked}
                  onClick={() => focusBlock(block.block_id)}
                >
                  {block.block_type}: {block.text_content.slice(0, 42)}
                </button>
              ))}
            </div>
          )}

          <div className="message-list">
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role} ${m.status ?? ""}`}>
                {editingMessageId === m.id ? (
                  <textarea
                    className="qa-inline-editor"
                    value={editingAnswer}
                    disabled={writebackStatus[m.id] === "running"}
                    onChange={(e) => setEditingAnswer(e.target.value)}
                  />
                ) : (
                  m.text
                )}
                {m.qa && (
                  <div className="qa-actions">
                    <small>
                      引用 blocks: {m.qa.source_block_refs.join(", ") || "—"}
                      {m.qa.target_field
                        ? ` · 建议回写：${FIELD_LABELS[m.qa.target_field] ?? m.qa.target_field}`
                        : " · 请选择回写字段"}
                    </small>
                    <label className="writeback-control">
                      <span>目标字段</span>
                      <select
                        value={
                          writebackTargets[m.id] ||
                          m.qa.suggested_writeback?.field_key ||
                          m.qa.target_field ||
                          m.targetField ||
                          ""
                        }
                        disabled={isInteractionLocked || writebackStatus[m.id] === "running"}
                        onChange={(e) =>
                          setWritebackTargets((targets) => ({
                            ...targets,
                            [m.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">选择 schema 字段</option>
                        {GROUND_TRUTH_FIELD_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {FIELD_LABELS[key] ?? key}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="writeback-control">
                      <span>回写方式</span>
                      <select
                        value={writebackModes[m.id] ?? "append"}
                        disabled={isInteractionLocked || writebackStatus[m.id] === "running"}
                        onChange={(e) =>
                          setWritebackModes((modes) => ({
                            ...modes,
                            [m.id]: e.target.value as "append" | "replace",
                          }))
                        }
                      >
                        <option value="append">追加到数组字段 / 默认追加</option>
                        <option value="replace">替换该字段现有内容</option>
                      </select>
                    </label>
                    <div className="qa-button-row">
                      <button
                        type="button"
                        disabled={isInteractionLocked || writebackStatus[m.id] === "running"}
                        onClick={() => void applyQaAnswer(m)}
                      >
                        {writebackStatus[m.id] === "running" ? "回写中..." : "认可并回写"}
                      </button>
                      {editingMessageId === m.id ? (
                        <>
                          <button
                            type="button"
                            disabled={
                              isInteractionLocked ||
                              writebackStatus[m.id] === "running" ||
                              !editingAnswer.trim()
                            }
                            onClick={() => void applyQaAnswer(m, editingAnswer.trim())}
                          >
                            保存回写
                          </button>
                          <button
                            type="button"
                            disabled={writebackStatus[m.id] === "running"}
                            onClick={() => {
                              setEditingMessageId(null);
                              setEditingAnswer("");
                            }}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isInteractionLocked || writebackStatus[m.id] === "running"}
                          onClick={() => {
                            setEditingMessageId(m.id);
                            setEditingAnswer(m.text);
                          }}
                        >
                          编辑后回写
                        </button>
                      )}
                    </div>
                    {writebackStatus[m.id] === "success" && (
                      <small className="writeback-hint success">已回写并刷新结构化草稿。</small>
                    )}
                    {writebackStatus[m.id] === "error" && (
                      <small className="writeback-hint error">
                        回写失败或缺少目标字段，请选择字段后重试。
                      </small>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <textarea
            className="chat-input"
            value={input}
            placeholder={
              activeFieldQuality
                ? `围绕“${activeFieldQuality.label}”追问，系统会带上当前证据上下文。`
                : "选择一个 GAP、字段或原文证据后开始专家问答。"
            }
            disabled={isInteractionLocked}
            aria-busy={isQaRunning}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="button"
            className="send-button"
            disabled={isInteractionLocked || isQaRunning}
            onClick={() => void sendMessage()}
          >
            {isQaRunning
              ? "QA 思考中..."
              : activeFieldQuality || focusEvidenceBlocks.length
                ? "带上下文提问"
                : "发送"}
          </button>
        </section>
      </div>

      {qualityPanelVisible && llmProgress.status !== "idle" && (
        <section
          className={`llm-statusbar ${llmProgress.status} ${
            statusbarExpanded ? "expanded" : "compact"
          }`}
        >
          <div className="llm-status-main">
            <span className="llm-pulse" />
            <div>
              <strong>质量优化 Agent</strong>
              <div className="llm-status-text">
                {llmProgress.message}
                {llmProgress.elapsedMs > 0
                  ? ` · ${Math.round(llmProgress.elapsedMs / 1000)}s`
                  : ""}
              </div>
            </div>
          </div>
          <div className="llm-steps" aria-label="LLM 工作过程">
            {LLM_STEPS.map((step, i) => (
              <span
                key={step}
                className={
                  i < llmProgress.stepIndex
                    ? "done"
                    : i === llmProgress.stepIndex
                      ? "active"
                      : ""
                }
              >
                {step}
              </span>
            ))}
          </div>
          <div className="llm-diagnostics">
            {llmAttemptSummary ||
              (llmProgress.parseDiagnostics?.block_counts
                ? `切块 ${JSON.stringify(llmProgress.parseDiagnostics.block_counts)}`
                : "抽取与问答会基于 schema、评分指标和专家偏好推进文档质量。")}
          </div>
          <div className="statusbar-actions">
            <button
              type="button"
              className="statusbar-toggle"
              onClick={() => setStatusbarExpanded((v) => !v)}
            >
              {statusbarExpanded ? "收起" : "展开"}
            </button>
            <button
              type="button"
              className="statusbar-toggle"
              onClick={() => setQualityPanelVisible(false)}
            >
              关闭
            </button>
          </div>
        </section>
      )}

      <footer className="drawer">
        <div className="drawer-tabs">
          {(
            [
              ["suggestions", "待确认建议"],
              ["diff", "版本 Diff"],
              ["fields", "结构字段变化"],
              ["eval", "系统诊断"],
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
                <p>尚无评分（先运行结构化抽取）</p>
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
    </>
  );
}
