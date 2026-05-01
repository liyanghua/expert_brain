import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentIR } from "@ebs/document-ir";
import type {
  GroundTruthDraft,
  SuggestionRecord,
} from "@ebs/ground-truth-schema";
import { GROUND_TRUTH_FIELD_KEYS } from "@ebs/ground-truth-schema";
import { GapCard, SuggestionCard } from "@ebs/ui-components";

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

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  qa?: QAResponse;
  question?: string;
  blockId?: string | null;
  targetField?: string | null;
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

const METRIC_CHIP_PROMPTS: Record<string, string> = {
  field_coverage:
    "哪些结构化字段仍为空？请按优先级列出并给出补全要点。",
  source_grounding_rate:
    "请帮我检查草稿条目是否都有原文 block_id / 页码绑定，并指出缺失项。",
  structural_consistency:
    "触发条件、终止条件与业务场景是否一致？如有冲突请列出。",
  gap_detection_accuracy:
    "对照 gaps_structured，还有哪些字段应标为缺失或待确认？",
  inference_handling_accuracy:
    "标为 InferredCandidate 的条目有哪些？需要专家如何确认？",
  human_revision_rate:
    "近期修订比例偏高，请总结主要修改类型并建议减负策略。",
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

const FIELD_LABELS: Record<string, string> = {
  business_scenario: "业务场景",
  scenario_goal: "场景目标",
  required_inputs: "前置输入 / 依赖",
  deliverables: "输出成果",
  process_flow_or_business_model: "流程 / 商业模式",
  thinking_framework: "目标思维框架",
  execution_steps: "执行步骤",
  execution_actions: "执行动作",
  key_node_rationales: "关键节点思路说明",
  page_screenshots: "页面截图",
  faq_types: "常见问题类型",
  judgment_basis: "判断依据 / 指标",
  judgment_criteria: "判断标准",
  resolution_methods: "问题解决方法 / 执行动作",
  trigger_conditions: "流程触发条件",
  termination_conditions: "流程终止条件",
  validation_methods: "方法有效性验证方式",
  tool_templates: "工具表单模板",
  exceptions_and_non_applicable_scope: "例外与不适用范围",
};

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
  const [leftMode, setLeftMode] = useState<LeftMode>("original");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("suggestions");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [qaContext, setQaContext] = useState<{
    blockId: string | null;
    targetField?: string | null;
    metric?: string | null;
  }>({ blockId: null });
  const [agentMode, setAgentMode] = useState<"QA" | "Suggest" | "Rewrite">(
    "QA",
  );
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>([]);
  const [publishInfo, setPublishInfo] = useState<unknown>(null);
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
  const [llmProgress, setLlmProgress] =
    useState<LlmProgress>(idleLlmProgress);
  const [statusbarExpanded, setStatusbarExpanded] = useState(false);

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
      if (i.blocks.length) setPhase((p) => (p === "empty" ? "imported" : p));
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
      const pub = await fetchJson(api(`/documents/${id}/publish-readiness`));
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

  const statusbarHeight = statusbarExpanded ? 154 : 70;

  const metricChips = useMemo(() => {
    if (!scorecard?.threshold_check) return [];
    return Object.entries(scorecard.threshold_check)
      .filter(([, v]) => v === "fail" || v === "warn")
      .map(([key]) => ({
        key,
        label: METRIC_CHIP_LABELS[key] ?? key,
      }));
  }, [scorecard]);

  const fieldItems = useMemo(() => {
    if (!draft) return [];
    return GROUND_TRUTH_FIELD_KEYS.flatMap((fieldKey) => {
      const raw = draft[fieldKey as keyof GroundTruthDraft];
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return items.map((item, index) => ({
        fieldKey,
        label: FIELD_LABELS[fieldKey] ?? fieldKey,
        index,
        item: item as {
          content?: unknown;
          status?: string;
          confidence?: number;
          source_refs?: { block_id?: string }[];
        },
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
    await refreshDoc(m.doc_id);
  }

  async function onUpload(f: File) {
    if (!docId || isInteractionLocked) return;
    setIsUploading(true);
    setSaveHint("Saving…");
    try {
      const fd = new FormData();
      fd.append("file", f);
      await fetch(api(`/documents/${docId}/sources`), { method: "POST", body: fd });
      await fetch(api(`/documents/${docId}/jobs/process-next`), {
        method: "POST",
      });
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
    if (!docId || !input.trim() || isInteractionLocked) return;
    const q = input.trim();
    const context = qaContext.blockId ?? selectedBlockId;
    setInput("");
    setQaContext({ blockId: null });
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: q,
        blockId: context,
        targetField: qaContext.targetField,
      },
    ]);
    setPhase("qa");
    if (agentMode === "QA") {
      const qa = await fetchJson<QAResponse>(
        api(`/documents/${docId}/qa`),
        {
          method: "POST",
          body: JSON.stringify({
            block_id: context,
            question: q,
            target_field: qaContext.targetField,
            metric: qaContext.metric,
          }),
        },
      );
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: qa.direct_answer,
          qa,
          question: q,
          blockId: context,
          targetField: qa.target_field ?? qaContext.targetField,
        },
      ]);
      return;
    }
    if (!selectedBlockId) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: "请先选择一个文档块。",
        },
      ]);
      return;
    }
    const sug = await fetchJson<{ suggestions: SuggestionRecord[] }>(
      api(`/documents/${docId}/suggestions`),
      {
        method: "POST",
        body: JSON.stringify({ block_id: selectedBlockId }),
      },
    );
    setSuggestions((prev) => [...sug.suggestions, ...prev]);
    setPhase("suggestions");
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        role: "agent",
        text: `已生成 ${sug.suggestions.length} 条建议，见右侧卡片与底部抽屉。`,
      },
    ]);
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

  function quickChip(label: string) {
    if (isInteractionLocked) return;
    setInput(label);
  }

  function addSelectedBlockToChat(targetField?: string | null) {
    if (!selectedBlock) return;
    setQaContext({ blockId: selectedBlock.block_id, targetField });
    setInput((prev) => {
      const prefix = `围绕选中原文块提问（block_id: ${selectedBlock.block_id}）：\n${selectedBlock.text_content.slice(0, 500)}\n\n`;
      return prev ? `${prefix}${prev}` : `${prefix}请判断这段内容应该补充或修正哪个结构化字段？`;
    });
  }

  function useCandidateQuestion(q: CandidateQuestion) {
    setDrawerTab("eval");
    setAgentMode("QA");
    setQaContext({
      blockId: q.source_block_id ?? selectedBlockId,
      targetField: q.target_field,
      metric: q.metric,
    });
    setInput(q.question);
  }

  async function applyQaAnswer(message: ChatMessage, editedText?: string) {
    if (!docId || !message.qa || isInteractionLocked) return;
    const fieldKey =
      message.qa.suggested_writeback?.field_key ??
      message.qa.target_field ??
      message.targetField;
    if (!fieldKey) {
      window.alert("这条回答没有可回写的目标字段。");
      return;
    }
    await fetchJson(api(`/documents/${docId}/qa/apply`), {
      method: "POST",
      body: JSON.stringify({
        field_key: fieldKey,
        answer_text: message.text,
        edited_text: editedText,
        question: message.question,
        block_id: message.blockId,
      }),
    });
    await refreshDoc(docId);
    setPhase("version");
  }

  const mappedFieldForBlock = selectedBlockId ?? "—";

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
        style={{
          height: `calc(100vh - 52px - 220px - ${statusbarHeight}px)`,
        }}
        aria-busy={isInteractionLocked}
      >
        <section className="pane">
          {!docId || !ir?.blocks.length ? (
            <div className="empty-state">
              <p>导入 Markdown / PDF / 图片 / Docx / Excel 开始。</p>
              <p style={{ fontSize: 13 }}>右侧可与 Agent 协作问答与修订。</p>
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
                  {GROUND_TRUTH_FIELD_KEYS.map((key) => {
                    const raw = draft[key as keyof GroundTruthDraft];
                    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
                    const status =
                      items.length === 0
                        ? "Missing"
                        : items.some(
                              (i: { status?: string }) =>
                                i.status === "Confirmed",
                            )
                          ? "Confirmed"
                          : "Drafted";
                    return (
                      <div key={key} className="field-card">
                        <header>
                          <span>{FIELD_LABELS[key] ?? key}</span>
                          <span style={{ color: "var(--muted)" }}>{status}</span>
                        </header>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                          {JSON.stringify(items, null, 2)}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              )}

              {leftMode === "compare" && draft && (
                <div className="compare-panel">
                  <div>
                    <h3>原文块</h3>
                    {(ir?.blocks ?? []).map((b) => (
                      <button
                        key={b.block_id}
                        type="button"
                        className={`compare-block ${
                          selectedBlockId === b.block_id ? "selected" : ""
                        } ${blockFieldIndex.has(b.block_id) ? "mapped" : ""}`}
                        onClick={() => setSelectedBlockId(b.block_id)}
                      >
                        <strong>{b.block_type}</strong>
                        <span>{b.text_content.slice(0, 120)}</span>
                      </button>
                    ))}
                  </div>
                  <div>
                    <h3>关联结构化字段</h3>
                    {selectedBlock ? (
                      selectedBlockFields.length ? (
                        selectedBlockFields.map((entry) => (
                          <button
                            key={`${entry.fieldKey}-${entry.index}`}
                            type="button"
                            className="linked-field-card"
                            onClick={() => addSelectedBlockToChat(entry.fieldKey)}
                          >
                            <header>
                              <strong>{entry.label}</strong>
                              <span>{entry.item.status ?? "Drafted"}</span>
                            </header>
                            <pre>
                              {JSON.stringify(entry.item.content, null, 2)}
                            </pre>
                            <small>点击可围绕该字段加入对话</small>
                          </button>
                        ))
                      ) : (
                        <div className="empty-state">
                          该 block 暂未绑定结构化字段，可添加到对话进行追问。
                        </div>
                      )
                    ) : (
                      <div className="empty-state">请选择左侧原文块。</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="pane">
          <div className="context-bar">
            Context · block:{" "}
            {selectedBlock
              ? `${selectedBlock.block_type}: ${selectedBlock.text_content.slice(0, 80)}…`
              : "未选中"}
            <br />
            Agent 模式: {agentMode} · 页面阶段: {phase}
            {selectedBlock && (
              <div className="block-actions">
                <button
                  type="button"
                  disabled={isInteractionLocked}
                  onClick={() => addSelectedBlockToChat()}
                >
                  添加到对话
                </button>
                <button
                  type="button"
                  disabled={isInteractionLocked}
                  onClick={() => {
                    setQaContext({ blockId: selectedBlock.block_id });
                    setInput("这段原文最应该映射到哪个结构化字段？还缺什么确认信息？");
                  }}
                >
                  问这个块缺什么
                </button>
                {selectedBlockFields[0] && (
                  <button
                    type="button"
                    disabled={isInteractionLocked}
                    onClick={() =>
                      addSelectedBlockToChat(selectedBlockFields[0]?.fieldKey)
                    }
                  >
                    确认关联字段
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="tabs">
            <button
              type="button"
              disabled={isInteractionLocked}
              className={agentMode === "QA" ? "active" : ""}
              onClick={() => setAgentMode("QA")}
            >
              QA
            </button>
            <button
              type="button"
              disabled={isInteractionLocked}
              className={agentMode === "Suggest" ? "active" : ""}
              onClick={() => setAgentMode("Suggest")}
            >
              Suggest
            </button>
            <button
              type="button"
              disabled={isInteractionLocked}
              className={agentMode === "Rewrite" ? "active" : ""}
              onClick={() => setAgentMode("Rewrite")}
            >
              Rewrite
            </button>
          </div>

          <div className="chips">
            {metricChips.length ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  低分指标 ·{" "}
                </span>
                {metricChips.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    disabled={isInteractionLocked}
                    className="chip"
                    onClick={() =>
                      quickChip(
                        METRIC_CHIP_PROMPTS[key] ?? `请改进评分项：${label}`,
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {[
              "解释这段",
              "给出改写建议",
              "还缺什么",
              "映射到哪个字段",
            ].map((c) => (
              <button
                key={c}
                type="button"
                disabled={isInteractionLocked}
                className="chip"
                onClick={() => quickChip(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div style={{ maxHeight: "40vh", overflow: "auto" }}>
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.text}
                {m.qa && (
                  <div className="qa-actions">
                    <small>
                      引用 blocks: {m.qa.source_block_refs.join(", ") || "—"}
                      {m.qa.target_field ? ` · 建议回写：${FIELD_LABELS[m.qa.target_field] ?? m.qa.target_field}` : ""}
                    </small>
                    <div>
                      <button
                        type="button"
                        disabled={isInteractionLocked}
                        onClick={() => void applyQaAnswer(m)}
                      >
                        认可并回写
                      </button>
                      <button
                        type="button"
                        disabled={isInteractionLocked}
                        onClick={() => {
                          const edited = window.prompt("编辑后回写", m.text);
                          if (edited) void applyQaAnswer(m, edited);
                        }}
                      >
                        编辑后回写
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {draft?.gaps?.length ? (
            <div style={{ marginTop: 8 }}>
              <strong style={{ fontSize: 13 }}>缺口</strong>
              {draft.gaps.slice(0, 6).map((g) => (
                <GapCard key={g.field_key + g.message} fieldKey={g.field_key} message={g.message} />
              ))}
            </div>
          ) : null}

          <div style={{ marginTop: 12 }}>
            {suggestions.map((s) => (
              <SuggestionCard
                key={s.suggestion_id}
                suggestion={s}
                onAccept={() => void applySuggestion(s)}
                onEditAccept={() => {
                  const t = window.prompt("编辑建议正文", s.suggestion_text);
                  if (t) void applySuggestion(s, t);
                }}
                onReject={() =>
                  setSuggestions((list) =>
                    list.filter((x) => x.suggestion_id !== s.suggestion_id),
                  )
                }
                onDefer={() =>
                  setSuggestions((list) =>
                    list.filter((x) => x.suggestion_id !== s.suggestion_id),
                  )
                }
              />
            ))}
          </div>

          <textarea
            style={{ marginTop: 12 }}
            value={input}
            placeholder="输入问题或指令…"
            disabled={isInteractionLocked}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="button"
            style={{ marginTop: 8 }}
            disabled={isInteractionLocked}
            onClick={() => void sendMessage()}
          >
            发送
          </button>

          {publishInfo != null && (
            <pre style={{ marginTop: 12, fontSize: 11, opacity: 0.85 }}>
              {JSON.stringify(publishInfo, null, 2)}
            </pre>
          )}
        </section>
      </div>

      <section
        className={`llm-statusbar ${llmProgress.status} ${
          statusbarExpanded ? "expanded" : "compact"
        }`}
        style={{ minHeight: statusbarHeight }}
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
        <button
          type="button"
          className="statusbar-toggle"
          onClick={() => setStatusbarExpanded((v) => !v)}
        >
          {statusbarExpanded ? "收起" : "展开"}
        </button>
      </section>

      <footer className="drawer">
        <div className="drawer-tabs">
          {(
            [
              ["suggestions", "待确认建议"],
              ["diff", "版本 Diff"],
              ["fields", "结构字段变化"],
              ["eval", "评分 / 补强"],
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
              {scorecard ? (
                <div className="metric-grid">
                  {Object.entries(scorecard.scores).map(([key, value]) => {
                    const def = scorecard.metric_definitions?.[key];
                    const status = scorecard.threshold_check?.[key] ?? "skipped";
                    return (
                      <div key={key} className={`metric-card ${status}`}>
                        <header>
                          <strong>{def?.label ?? METRIC_CHIP_LABELS[key] ?? key}</strong>
                          <span>{value == null ? "跳过" : `${Math.round(value * 100)}%`} · {status}</span>
                        </header>
                        <p>{def?.meaning ?? "暂无说明"}</p>
                        <small>计算逻辑：{def?.calculation ?? "—"}</small>
                        <small>阈值：{def?.thresholds ?? "—"}</small>
                        {(status === "warn" || status === "fail") && (
                          <small>低分原因：{def?.low_score_reason ?? "需要复核"}</small>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p>尚无评分（先运行结构化抽取）</p>
              )}
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
