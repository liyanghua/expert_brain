import type { DocumentIR } from "@ebs/document-ir";
import {
  GroundTruthDraftSchema,
  GlobalQualityTriageSchema,
  MAX_PRIMARY_TASKS,
  PRIMARY_TASK_FIELD_PROFILES,
  STRUCTURED_FIELD_KEYS,
  emptyGroundTruthDraft,
  type GlobalQualityTriage,
  type GroundTruthDraft,
  type PrimaryTaskFieldKey,
  type StructuredFieldKey,
} from "@ebs/ground-truth-schema";
import { runStructuring } from "./agents.js";
import { chatCompletionText, resolveLlmRequestConfig } from "./llm-client.js";
import {
  buildGlobalQualityTriagePromptInput,
  buildGlobalQualityTriageSystemPrompt,
  buildKnowledgeSkeletonSystemPrompt,
  buildKnowledgeSkeletonPromptInput,
  buildStructuringSystemPrompt,
  buildStructuringPromptInput,
} from "./structuring-prompt.js";

export type StructuringMode = "llm" | "rules" | "rules_fallback";
export type GlobalQualityTriageMode = "llm" | "rules" | "rules_fallback";
export type StructuringFailureReason =
  | "disabled"
  | "http_error"
  | "timeout"
  | "json_parse_error"
  | "schema_validation_error"
  | "quality_gate_failed"
  | "unknown_error";

export type StructuringDiagnostics = {
  attempts: {
    stage:
      | "global_triage"
      | "knowledge_skeleton"
      | "draft"
      | "strict_retry"
      | "rules";
    status: "ok" | "failed" | "skipped";
    reason?: StructuringFailureReason;
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
  llm_failure_reason?: StructuringFailureReason;
  llm_failure_message?: string;
  schema_issues?: string[];
  quality_issues: string[];
};

export function isLlmStructuringEnabled(): boolean {
  const v = process.env.EBS_LLM_STRUCTURING?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function structuringTimeoutMs(): number {
  const parsed = Number(process.env.EBS_LLM_STRUCTURING_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
}

function triageTimeoutMs(): number {
  const parsed = Number(process.env.EBS_LLM_TRIAGE_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

function hasDashScopeFallbackConfig(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_MODEL);
}

function promptDiagnostics(
  stage: "global_triage" | "knowledge_skeleton" | "draft" | "strict_retry",
  context: {
    totalBlockCount: number;
    selectedBlockCount: number;
    selectedBlockIds: string[];
    contextChars: number;
  },
): Record<string, unknown> {
  return {
    stage,
    totalBlockCount: context.totalBlockCount,
    selectedBlockCount: context.selectedBlockCount,
    contextChars: context.contextChars,
    selectedBlockIdsPreview: context.selectedBlockIds.slice(0, 12),
    omittedSelectedBlockIds: Math.max(0, context.selectedBlockIds.length - 12),
  };
}

export const ARRAY_STRUCTURED_FIELD_KEYS = [
  "required_inputs",
  "deliverables",
  "thinking_framework",
  "execution_steps",
  "execution_actions",
  "key_node_rationales",
  "page_screenshots",
  "faq_types",
  "judgment_basis",
  "judgment_criteria",
  "resolution_methods",
  "trigger_conditions",
  "termination_conditions",
  "validation_methods",
  "tool_templates",
  "exceptions_and_non_applicable_scope",
] as const satisfies readonly StructuredFieldKey[];

const ARRAY_STRUCTURED_FIELD_KEY_SET = new Set<string>(ARRAY_STRUCTURED_FIELD_KEYS);
const OBJECT_STRUCTURED_FIELD_KEY_SET = new Set<string>([
  "business_scenario",
  "scenario_goal",
  "process_flow_or_business_model",
]);
const STRUCTURED_FIELD_KEY_SET = new Set<string>(STRUCTURED_FIELD_KEYS);
const PRIMARY_TASK_FIELD_KEY_SET = new Set<string>(
  PRIMARY_TASK_FIELD_PROFILES.map((profile) => profile.field_key),
);
const PRIMARY_TASK_FIELD_RANK = new Map<string, number>(
  PRIMARY_TASK_FIELD_PROFILES.map((profile, index) => [profile.field_key, index]),
);
const PRIORITY_RANK: Record<"low" | "medium" | "high", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function normalizeLlmStructuredFields(
  partial: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...partial };
  for (const key of OBJECT_STRUCTURED_FIELD_KEY_SET) {
    const v = normalized[key];
    if (Array.isArray(v) && v.length === 1) {
      normalized[key] = v[0];
    }
  }
  for (const key of ARRAY_STRUCTURED_FIELD_KEY_SET) {
    const v = normalized[key];
    if (v === undefined || v === null || Array.isArray(v)) continue;
    normalized[key] = [v];
  }
  if (
    typeof normalized.gaps === "string" &&
    normalized.gaps.trim() !== ""
  ) {
    normalized.gaps = [
      { field_key: "general", message: normalized.gaps.trim() },
    ];
  }
  if (Array.isArray(normalized.source_refs)) {
    normalized.source_refs = { general: normalized.source_refs };
  }
  return normalized;
}

function extractJsonObject(raw: string): unknown {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/im.exec(t);
  const body = fence ? fence[1]!.trim() : t;
  return JSON.parse(body) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeTriageSeverity(value: unknown): "low" | "medium" | "high" {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  if (normalized === "critical" || normalized === "urgent" || normalized === "severe") {
    return "high";
  }
  return "medium";
}

function normalizeTriageSourceRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return { block_id: item.trim() };
      }
      const record = asRecord(item);
      return typeof record.block_id === "string" && record.block_id.trim()
        ? record
        : null;
    })
    .filter((item): item is Record<string, unknown> => item != null);
}

function normalizeGlobalQualityTriagePayload(value: unknown): unknown {
  const input = asRecord(value);
  return {
    ...input,
    major_gaps: Array.isArray(input.major_gaps)
      ? input.major_gaps.map((gap) => {
          const record = asRecord(gap);
          return {
            ...record,
            severity: normalizeTriageSeverity(record.severity),
            source_refs: normalizeTriageSourceRefs(record.source_refs),
          };
        })
      : [],
    recommended_tasks: Array.isArray(input.recommended_tasks)
      ? input.recommended_tasks.map((task) => {
          const record = asRecord(task);
          return {
            ...record,
            priority: normalizeTriageSeverity(record.priority),
            source_block_ids: Array.isArray(record.source_block_ids)
              ? record.source_block_ids.filter(
                  (blockId): blockId is string => typeof blockId === "string",
                )
              : [],
          };
        })
      : [],
    suggested_questions: Array.isArray(input.suggested_questions)
      ? input.suggested_questions.map((question) => {
          const record = asRecord(question);
          return {
            ...record,
            source_block_ids: Array.isArray(record.source_block_ids)
              ? record.source_block_ids.filter(
                  (blockId): blockId is string => typeof blockId === "string",
                )
              : [],
          };
        })
      : [],
    source_refs: normalizeTriageSourceRefs(input.source_refs),
  };
}

function groundedGlobalQualityTriage(
  value: GlobalQualityTriage,
  ir: DocumentIR,
): GlobalQualityTriage {
  const validBlockIds = new Set(ir.blocks.map((block) => block.block_id));
  const filterBlockIds = (ids: string[] | undefined) =>
    (ids ?? []).filter((blockId) => validBlockIds.has(blockId));
  const filterSourceRefs = (refs: GlobalQualityTriage["source_refs"]) =>
    refs.filter((ref) => ref.block_id && validBlockIds.has(ref.block_id));
  const normalizeField = (field: string | undefined) =>
    field && STRUCTURED_FIELD_KEY_SET.has(field) ? field : undefined;

  const major_gaps = value.major_gaps
    .map((gap) => ({
      ...gap,
      field_key: normalizeField(gap.field_key),
      source_refs: filterSourceRefs(gap.source_refs),
    }))
    .filter((gap) => gap.field_key || gap.source_refs.length > 0);

  const recommended_tasks = value.recommended_tasks
    .map((task) => ({
      ...task,
      target_field: normalizeField(task.target_field),
      source_block_ids: filterBlockIds(task.source_block_ids),
    }))
    .filter((task) => task.target_field || task.source_block_ids.length > 0);

  const suggested_questions = value.suggested_questions
    .map((question) => ({
      ...question,
      target_field: normalizeField(question.target_field),
      source_block_ids: filterBlockIds(question.source_block_ids),
    }))
    .filter((question) => question.target_field || question.source_block_ids.length > 0);

  return GlobalQualityTriageSchema.parse({
    ...value,
    major_gaps,
    recommended_tasks,
    suggested_questions,
    source_refs: filterSourceRefs(value.source_refs),
  });
}

function keywordHitCount(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, keyword) => {
    return lower.includes(keyword.toLowerCase()) ? count + 1 : count;
  }, 0);
}

function primaryFieldBlockHits(ir: DocumentIR): Map<PrimaryTaskFieldKey, string[]> {
  const hits = new Map<PrimaryTaskFieldKey, string[]>();
  for (const profile of PRIMARY_TASK_FIELD_PROFILES) {
    hits.set(profile.field_key, []);
  }
  for (const block of ir.blocks) {
    for (const profile of PRIMARY_TASK_FIELD_PROFILES) {
      if (keywordHitCount(block.text_content, profile.keywords) > 0) {
        hits.get(profile.field_key)?.push(block.block_id);
      }
    }
  }
  return hits;
}

function normalizePrimaryTaskField(field: string | undefined): PrimaryTaskFieldKey | undefined {
  return field && PRIMARY_TASK_FIELD_KEY_SET.has(field)
    ? (field as PrimaryTaskFieldKey)
    : undefined;
}

function inferPrimaryTaskFieldFromBlocks(
  ir: DocumentIR,
  sourceBlockIds: string[],
): PrimaryTaskFieldKey | undefined {
  let bestField: PrimaryTaskFieldKey | undefined;
  let bestScore = 0;
  for (const profile of PRIMARY_TASK_FIELD_PROFILES) {
    const score = sourceBlockIds.reduce((total, blockId) => {
      const block = ir.blocks.find((item) => item.block_id === blockId);
      return block
        ? total + keywordHitCount(block.text_content, profile.keywords)
        : total;
    }, 0);
    const rank = PRIMARY_TASK_FIELD_RANK.get(profile.field_key) ?? Number.MAX_SAFE_INTEGER;
    const bestRank = bestField
      ? (PRIMARY_TASK_FIELD_RANK.get(bestField) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    if (score > bestScore || (score === bestScore && score > 0 && rank < bestRank)) {
      bestScore = score;
      bestField = profile.field_key;
    }
  }
  return bestScore > 0 ? bestField : undefined;
}

function taskSortKey(task: GlobalQualityTriage["recommended_tasks"][number]) {
  return [
    PRIMARY_TASK_FIELD_RANK.get(task.target_field ?? "") ?? Number.MAX_SAFE_INTEGER,
    PRIORITY_RANK[task.priority],
  ] as const;
}

function betterPrimaryTask(
  current: GlobalQualityTriage["recommended_tasks"][number] | undefined,
  next: GlobalQualityTriage["recommended_tasks"][number],
) {
  if (!current) return next;
  const currentKey = taskSortKey(current);
  const nextKey = taskSortKey(next);
  if (nextKey[1] !== currentKey[1]) {
    return nextKey[1] < currentKey[1] ? next : current;
  }
  return next.source_block_ids.length > current.source_block_ids.length ? next : current;
}

function prioritizeGlobalQualityTasks(
  value: GlobalQualityTriage,
  ir: DocumentIR,
): GlobalQualityTriage {
  const fieldBlockHits = primaryFieldBlockHits(ir);
  const taskByField = new Map<
    PrimaryTaskFieldKey,
    GlobalQualityTriage["recommended_tasks"][number]
  >();

  for (const task of value.recommended_tasks) {
    const source_block_ids = task.source_block_ids.filter((blockId) =>
      ir.blocks.some((block) => block.block_id === blockId),
    );
    const target_field =
      normalizePrimaryTaskField(task.target_field) ??
      inferPrimaryTaskFieldFromBlocks(ir, source_block_ids);
    if (!target_field) continue;
    taskByField.set(
      target_field,
      betterPrimaryTask(taskByField.get(target_field), {
        ...task,
        target_field,
        source_block_ids,
      }),
    );
  }

  for (const profile of PRIMARY_TASK_FIELD_PROFILES) {
    if (taskByField.has(profile.field_key)) continue;
    const sourceBlockIds = fieldBlockHits.get(profile.field_key) ?? [];
    if (sourceBlockIds.length > 0) continue;
    taskByField.set(profile.field_key, {
      title: profile.missing_title,
      reason: profile.missing_reason,
      question: profile.missing_question,
      target_field: profile.field_key,
      source_block_ids: [],
      priority: "high",
    });
  }

  const recommended_tasks = [...taskByField.values()]
    .sort((a, b) => {
      const aKey = taskSortKey(a);
      const bKey = taskSortKey(b);
      return aKey[0] - bKey[0] || aKey[1] - bKey[1];
    })
    .slice(0, MAX_PRIMARY_TASKS);
  const selectedFields = new Set(recommended_tasks.map((task) => task.target_field));
  const suggestedByField = new Map<
    string,
    GlobalQualityTriage["suggested_questions"][number]
  >();

  for (const question of value.suggested_questions) {
    const source_block_ids = question.source_block_ids.filter((blockId) =>
      ir.blocks.some((block) => block.block_id === blockId),
    );
    const target_field =
      normalizePrimaryTaskField(question.target_field) ??
      inferPrimaryTaskFieldFromBlocks(ir, source_block_ids);
    if (!target_field || !selectedFields.has(target_field)) continue;
    if (!suggestedByField.has(target_field)) {
      suggestedByField.set(target_field, {
        ...question,
        target_field,
        source_block_ids,
      });
    }
  }

  const suggested_questions = recommended_tasks.map((task) => {
    return (
      suggestedByField.get(task.target_field ?? "") ?? {
        question: task.question,
        target_field: task.target_field,
        source_block_ids: task.source_block_ids,
      }
    );
  });

  const major_gaps = value.major_gaps
    .map((gap) => {
      const sourceBlockIds = gap.source_refs
        .map((ref) => ref.block_id)
        .filter((blockId): blockId is string => Boolean(blockId));
      const field_key =
        normalizePrimaryTaskField(gap.field_key) ??
        inferPrimaryTaskFieldFromBlocks(ir, sourceBlockIds);
      return { ...gap, field_key };
    })
    .filter((gap) => !gap.field_key || selectedFields.has(gap.field_key));

  return GlobalQualityTriageSchema.parse({
    ...value,
    major_gaps,
    recommended_tasks,
    suggested_questions,
  });
}

function mergeDraftFromLlm(
  ir: DocumentIR,
  partial: Record<string, unknown>,
): GroundTruthDraft {
  const normalized = normalizeLlmStructuredFields(partial);
  const base = emptyGroundTruthDraft(ir.doc_id, ir.version_id);
  const candidate: Record<string, unknown> = { ...base };

  for (const key of STRUCTURED_FIELD_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(normalized, key) &&
      normalized[key] !== undefined
    ) {
      candidate[key] = normalized[key];
    }
  }

  const metaKeys = [
    "document_meta",
    "gaps_structured",
    "global_scores",
    "gaps",
    "confidence_by_field",
    "source_refs",
    "schema_name",
    "schema_version",
  ] as const;
  for (const mk of metaKeys) {
    if (
      Object.prototype.hasOwnProperty.call(normalized, mk) &&
      normalized[mk] !== undefined
    ) {
      candidate[mk] = normalized[mk];
    }
  }

  candidate.doc_id = ir.doc_id;
  candidate.version_id = ir.version_id;
  candidate.schema_name = "BusinessDocStructuredDraft";

  return candidate as GroundTruthDraft;
}

function stringifyForQuality(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function collectDraftQualityIssues(
  draft: GroundTruthDraft,
  ir: DocumentIR,
): string[] {
  const issues: string[] = [];
  const placeholder = /to be confirmed|needs expert input|待专家确认/i;
  for (const key of STRUCTURED_FIELD_KEYS) {
    const text = stringifyForQuality(draft[key]);
    if (placeholder.test(text)) {
      issues.push(`placeholder content in ${key}`);
    }
  }

  const sourceText = ir.blocks.map((b) => b.text_content).join("\n");
  if (/商品诊断|生命周期|天猫|操盘手|店铺运营/.test(sourceText)) {
    const draftText = stringifyForQuality(draft);
    const required = [
      {
        label: "生命周期阶段",
        pattern: /生命周期|新品期|成长期|爆发期|衰退期|新品|成长品|爆品|衰退品/,
      },
      {
        label: "商品等级",
        pattern: /商品等级|S\/A\/B\/C|S\+|S：|A：|B：|C：|爆款|主力盈利款/,
      },
      {
        label: "诊断维度",
        pattern: /诊断维度|流量结构|转化链路|产品力|付费推广|人群诊断/,
      },
      {
        label: "指标标准",
        pattern: /判断标准|核心指标|加购率|转化率|退款率|费比|ROI|点击|GMV/,
      },
      {
        label: "排查方法",
        pattern: /排查|定位问题|问题解决|原因|诊断逻辑/,
      },
      {
        label: "执行动作",
        pattern: /执行动作|任务清单|优化|方案|动作/,
      },
      {
        label: "触发终止条件",
        pattern: /触发|终止|上架|下架|达标|预警|清仓/,
      },
    ];
    for (const item of required) {
      if (!item.pattern.test(draftText)) {
        issues.push(`missing core element: ${item.label}`);
      }
    }
  }
  return issues;
}

function classifyLlmError(err: unknown): {
  reason: StructuringFailureReason;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (/Timeout|aborted|AbortError/i.test(message)) {
    return { reason: "timeout", message };
  }
  if (/LLM HTTP/i.test(message)) {
    return { reason: "http_error", message };
  }
  return { reason: "unknown_error", message };
}

function isDashScopeRetryable(reason: StructuringFailureReason, message: string) {
  return (
    reason === "timeout" ||
    reason === "http_error" ||
    /fetch failed|ECONNRESET|socket hang up|network/i.test(message)
  );
}

async function chatCompletionTextWithDashScopeFallback(opts: {
  system: string;
  user: string;
  timeoutMs: number;
  label: string;
  promptDiagnostics?: Record<string, unknown>;
}): Promise<string> {
  try {
    return await chatCompletionText(opts);
  } catch (err) {
    const { reason, message } = classifyLlmError(err);
    if (!hasDashScopeFallbackConfig() || !isDashScopeRetryable(reason, message)) {
      throw err;
    }
    const fallbackLabel = `${opts.label}.fallback_dashscope`;
    console.info("[EBS LLM fallback]", {
      from: opts.label,
      to: fallbackLabel,
      provider: "dashscope",
      reason,
      message,
    });
    return chatCompletionText({
      system: opts.system,
      user: opts.user,
      timeoutMs: opts.timeoutMs,
      label: fallbackLabel,
      provider: "dashscope",
      promptDiagnostics: opts.promptDiagnostics,
    });
  }
}

function fallbackResult(
  ir: DocumentIR,
  diagnostics: StructuringDiagnostics,
  reason: StructuringFailureReason,
  message: string,
): {
  draft: GroundTruthDraft;
  structuring_mode: StructuringMode;
  diagnostics: StructuringDiagnostics;
} {
  diagnostics.llm_failure_reason = reason;
  diagnostics.llm_failure_message = message;
  diagnostics.attempts.push({ stage: "rules", status: "ok" });
  return {
    draft: runStructuring(ir),
    structuring_mode: "rules_fallback",
    diagnostics,
  };
}

function sourceBlockIdsForTriage(ir: DocumentIR): string[] {
  return ir.blocks
    .filter((block) =>
      PRIMARY_TASK_FIELD_PROFILES.some(
        (profile) => keywordHitCount(block.text_content, profile.keywords) > 0,
      ),
    )
    .slice(0, MAX_PRIMARY_TASKS)
    .map((block) => block.block_id);
}

function heuristicGlobalQualityTriage(ir: DocumentIR): GlobalQualityTriage {
  const sourceBlockIds = sourceBlockIdsForTriage(ir);
  const source_refs = sourceBlockIds.map((block_id) => ({ block_id }));
  const sourceText = ir.blocks.map((block) => block.text_content).join("\n");
  const major_gaps: GlobalQualityTriage["major_gaps"] = [];
  const recommended_tasks: GlobalQualityTriage["recommended_tasks"] = [];

  const addGapTask = (input: {
    field_key: PrimaryTaskFieldKey;
    title: string;
    message: string;
    question: string;
    priority?: "low" | "medium" | "high";
  }) => {
    major_gaps.push({
      field_key: input.field_key,
      severity: input.priority ?? "medium",
      message: input.message,
      source_refs,
    });
    recommended_tasks.push({
      title: input.title,
      reason: input.message,
      question: input.question,
      target_field: input.field_key,
      source_block_ids: sourceBlockIds,
      priority: input.priority ?? "medium",
    });
  };

  for (const profile of PRIMARY_TASK_FIELD_PROFILES) {
    if (recommended_tasks.length >= MAX_PRIMARY_TASKS) break;
    if (keywordHitCount(sourceText, profile.keywords) > 0) continue;
    addGapTask({
      field_key: profile.field_key,
      title: profile.missing_title,
      message: profile.missing_reason,
      question: profile.missing_question,
      priority: "high",
    });
  }
  if (recommended_tasks.length === 0) {
    const firstProfile = PRIMARY_TASK_FIELD_PROFILES[0];
    addGapTask({
      field_key: firstProfile.field_key,
      title: "确认执行步骤是否完整",
      message: "文档已有基础内容，建议先确认关键操作步骤是否足够清楚。",
      question: "当前内容里的关键执行步骤是否完整？还缺少哪些操作细节？",
      priority: "medium",
    });
  }

  return GlobalQualityTriageSchema.parse({
    summary: "规则诊断发现文档仍需专家补充关键执行步骤、判断依据或判断标准。",
    major_gaps,
    recommended_tasks: recommended_tasks.slice(0, MAX_PRIMARY_TASKS),
    suggested_questions: recommended_tasks.slice(0, MAX_PRIMARY_TASKS).map((task) => ({
      question: task.question,
      target_field: task.target_field,
      source_block_ids: task.source_block_ids,
    })),
    source_refs,
  });
}

export async function runGlobalQualityTriageWithLlmOrFallback(
  ir: DocumentIR,
): Promise<{
  triage: GlobalQualityTriage;
  triage_mode: GlobalQualityTriageMode;
  diagnostics: StructuringDiagnostics;
}> {
  const diagnostics: StructuringDiagnostics = {
    attempts: [],
    quality_issues: [],
  };
  if (!isLlmStructuringEnabled()) {
    diagnostics.llm_failure_reason = "disabled";
    diagnostics.attempts.push({
      stage: "global_triage",
      status: "skipped",
      reason: "disabled",
    });
    diagnostics.attempts.push({ stage: "rules", status: "ok" });
    return {
      triage: heuristicGlobalQualityTriage(ir),
      triage_mode: "rules",
      diagnostics,
    };
  }

  const system = buildGlobalQualityTriageSystemPrompt();
  const input = buildGlobalQualityTriagePromptInput(ir);
  const label = "structuring.global_triage";
  const config = resolveLlmRequestConfig({
    label,
    timeoutMs: triageTimeoutMs(),
  });
  const attemptBase = {
    stage: "global_triage" as const,
    label,
    provider: config.provider,
    model: config.model,
    timeout_ms: config.timeoutMs,
    request_params: {
      route: config.route,
      timeout_ms: config.timeoutMs,
      max_tokens: config.maxTokens,
      response_json: config.responseJson,
      temperature: Number(process.env.EBS_LLM_TEMPERATURE ?? 0.2),
    },
    system_prompt_chars: system.length,
    user_prompt_chars: input.prompt.length,
    system_prompt: system,
    user_prompt: input.prompt,
  };
  const startedAt = Date.now();
  try {
    const raw = await chatCompletionText({
      system,
      user: input.prompt,
      timeoutMs: config.timeoutMs,
      label,
      promptDiagnostics: promptDiagnostics("global_triage", input.context),
    });
    const parsed = prioritizeGlobalQualityTasks(
      groundedGlobalQualityTriage(
        GlobalQualityTriageSchema.parse(
          normalizeGlobalQualityTriagePayload(extractJsonObject(raw)),
        ),
        ir,
      ),
      ir,
    );
    diagnostics.attempts.push({
      ...attemptBase,
      status: "ok",
      elapsed_ms: Date.now() - startedAt,
    });
    return {
      triage: parsed,
      triage_mode: "llm",
      diagnostics,
    };
  } catch (err) {
    const { reason, message } =
      err instanceof SyntaxError
        ? { reason: "json_parse_error" as const, message: err.message }
        : classifyLlmError(err);
    console.info("[EBS Global Quality Triage failed]", {
      stage: "global_triage",
      reason,
      message,
    });
    diagnostics.llm_failure_reason = reason;
    diagnostics.llm_failure_message = message;
    diagnostics.attempts.push({
      ...attemptBase,
      status: "failed",
      reason,
      message,
      elapsed_ms: Date.now() - startedAt,
    });
    diagnostics.attempts.push({ stage: "rules", status: "ok" });
    return {
      triage: heuristicGlobalQualityTriage(ir),
      triage_mode: "rules_fallback",
      diagnostics,
    };
  }
}

export async function runStructuringWithLlmOrFallback(ir: DocumentIR): Promise<{
  draft: GroundTruthDraft;
  structuring_mode: StructuringMode;
  diagnostics: StructuringDiagnostics;
}> {
  const diagnostics: StructuringDiagnostics = {
    attempts: [],
    quality_issues: [],
  };
  if (!isLlmStructuringEnabled()) {
    diagnostics.llm_failure_reason = "disabled";
    diagnostics.attempts.push({
      stage: "knowledge_skeleton",
      status: "skipped",
      reason: "disabled",
    });
    diagnostics.attempts.push({ stage: "rules", status: "ok" });
    return {
      draft: runStructuring(ir),
      structuring_mode: "rules",
      diagnostics,
    };
  }

  try {
    const timeoutMs = structuringTimeoutMs();
    let knowledgeSkeleton: unknown;
    try {
      const skeletonInput = buildKnowledgeSkeletonPromptInput(ir);
      const skeletonSystem = buildKnowledgeSkeletonSystemPrompt();
      const skeletonRaw = await chatCompletionTextWithDashScopeFallback({
        system: skeletonSystem,
        user: skeletonInput.prompt,
        timeoutMs,
        label: "structuring.knowledge_skeleton",
        promptDiagnostics: promptDiagnostics(
          "knowledge_skeleton",
          skeletonInput.context,
        ),
      });
      knowledgeSkeleton = extractJsonObject(skeletonRaw);
      diagnostics.attempts.push({ stage: "knowledge_skeleton", status: "ok" });
    } catch (err) {
      const { reason, message } =
        err instanceof SyntaxError
          ? { reason: "json_parse_error" as const, message: err.message }
          : classifyLlmError(err);
      console.info("[EBS Structuring LLM failed]", {
        stage: "knowledge_skeleton",
        reason,
        message,
      });
      diagnostics.attempts.push({
        stage: "knowledge_skeleton",
        status: "failed",
        reason,
        message,
      });
    }

    const system = buildStructuringSystemPrompt();
    const draftInput = buildStructuringPromptInput(ir, knowledgeSkeleton);
    const raw = await chatCompletionTextWithDashScopeFallback({
      system,
      user: draftInput.prompt,
      timeoutMs,
      label: "structuring.draft",
      promptDiagnostics: promptDiagnostics("draft", draftInput.context),
    });
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(raw) as Record<string, unknown>;
    } catch (err) {
      console.info("[EBS Structuring LLM failed]", {
        stage: "draft",
        reason: "json_parse_error",
        message: err instanceof Error ? err.message : String(err),
      });
      diagnostics.attempts.push({
        stage: "draft",
        status: "failed",
        reason: "json_parse_error",
        message: err instanceof Error ? err.message : String(err),
      });
      return fallbackResult(
        ir,
        diagnostics,
        "json_parse_error",
        err instanceof Error ? err.message : String(err),
      );
    }
    const merged = mergeDraftFromLlm(ir, parsed);
    const checked = GroundTruthDraftSchema.safeParse(merged);
    if (checked.success) {
      const qualityIssues = collectDraftQualityIssues(checked.data, ir);
      if (qualityIssues.length === 0) {
        diagnostics.attempts.push({ stage: "draft", status: "ok" });
        return { draft: checked.data, structuring_mode: "llm", diagnostics };
      }

      diagnostics.quality_issues = qualityIssues;
      console.info("[EBS Structuring LLM failed]", {
        stage: "draft",
        reason: "quality_gate_failed",
        message: qualityIssues.join("; "),
      });
      diagnostics.attempts.push({
        stage: "draft",
        status: "failed",
        reason: "quality_gate_failed",
        message: qualityIssues.join("; "),
      });

      const retryRaw = await chatCompletionTextWithDashScopeFallback({
        system: buildStructuringSystemPrompt({
          strict: true,
          qualityIssues,
        }),
        user: draftInput.prompt,
        timeoutMs,
        label: "structuring.strict_retry",
        promptDiagnostics: promptDiagnostics("strict_retry", draftInput.context),
      });
      let retryParsed: Record<string, unknown>;
      try {
        retryParsed = extractJsonObject(retryRaw) as Record<string, unknown>;
      } catch (err) {
        console.info("[EBS Structuring LLM failed]", {
          stage: "strict_retry",
          reason: "json_parse_error",
          message: err instanceof Error ? err.message : String(err),
        });
        diagnostics.attempts.push({
          stage: "strict_retry",
          status: "failed",
          reason: "json_parse_error",
          message: err instanceof Error ? err.message : String(err),
        });
        return fallbackResult(
          ir,
          diagnostics,
          "json_parse_error",
          err instanceof Error ? err.message : String(err),
        );
      }
      const retryMerged = mergeDraftFromLlm(ir, retryParsed);
      const retryChecked = GroundTruthDraftSchema.safeParse(retryMerged);
      if (!retryChecked.success) {
        const schemaIssues = retryChecked.error.issues
          .slice(0, 20)
          .map((i) => `${i.path.join(".")}: ${i.message}`);
        diagnostics.schema_issues = schemaIssues;
        console.info("[EBS Structuring LLM failed]", {
          stage: "strict_retry",
          reason: "schema_validation_error",
          message: schemaIssues.join("; "),
        });
        diagnostics.attempts.push({
          stage: "strict_retry",
          status: "failed",
          reason: "schema_validation_error",
          message: schemaIssues.join("; "),
        });
        return fallbackResult(
          ir,
          diagnostics,
          "schema_validation_error",
          schemaIssues.join("; "),
        );
      }
      const retryQualityIssues = collectDraftQualityIssues(
        retryChecked.data,
        ir,
      );
      diagnostics.quality_issues = retryQualityIssues;
      if (retryQualityIssues.length === 0) {
        diagnostics.attempts.push({ stage: "strict_retry", status: "ok" });
        return {
          draft: retryChecked.data,
          structuring_mode: "llm",
          diagnostics,
        };
      }
      console.info("[EBS Structuring LLM failed]", {
        stage: "strict_retry",
        reason: "quality_gate_failed",
        message: retryQualityIssues.join("; "),
      });
      diagnostics.attempts.push({
        stage: "strict_retry",
        status: "failed",
        reason: "quality_gate_failed",
        message: retryQualityIssues.join("; "),
      });
      return fallbackResult(
        ir,
        diagnostics,
        "quality_gate_failed",
        retryQualityIssues.join("; "),
      );
    }

    const schemaIssues = checked.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join(".")}: ${i.message}`);
    diagnostics.schema_issues = schemaIssues;
    console.info("[EBS Structuring LLM failed]", {
      stage: "draft",
      reason: "schema_validation_error",
      message: schemaIssues.join("; "),
    });
    diagnostics.attempts.push({
      stage: "draft",
      status: "failed",
      reason: "schema_validation_error",
      message: schemaIssues.join("; "),
    });
    return fallbackResult(
      ir,
      diagnostics,
      "schema_validation_error",
      schemaIssues.join("; "),
    );
  } catch (err) {
    const { reason, message } = classifyLlmError(err);
    console.info("[EBS Structuring LLM failed]", {
      stage: "draft",
      reason,
      message,
    });
    diagnostics.attempts.push({
      stage: "draft",
      status: "failed",
      reason,
      message,
    });
    return fallbackResult(ir, diagnostics, reason, message);
  }
}
