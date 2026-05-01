import type { DocumentBlock, DocumentIR } from "@ebs/document-ir";
import {
  type Gap,
  type GroundTruthDraft,
  type GroundTruthFieldItem,
  GroundTruthDraftSchema,
  QuestionRefinementResponseSchema,
  QAResponseSchema,
  type ExpertMemory,
  FIELD_DEFINITIONS_ZH,
  type LlmCallDiagnostics,
  type PublishReadinessResponse,
  type QAResponse,
  type QuestionRefinementResponse,
  emptyGroundTruthDraft,
  STRUCTURED_FIELD_KEYS,
  type StructuredFieldKey,
  type SourceRef,
} from "@ebs/ground-truth-schema";
import { chatCompletionText, resolveLlmRequestConfig } from "./llm-client.js";

function blockRefs(blocks: DocumentBlock[]): SourceRef[] {
  return blocks.map((b) => ({
    block_id: b.block_id,
    source_file: b.source_file,
    page_no: b.page_no ?? undefined,
    source_span: b.source_span,
  }));
}

function fieldItem(
  content: unknown,
  blocks: DocumentBlock[],
): GroundTruthFieldItem {
  const refs = blockRefs(blocks);
  return {
    content,
    status: content === undefined || content === null ? "Missing" : "Drafted",
    confidence: 0.35,
    source_refs: refs,
  };
}

function fieldPopulated(
  draft: GroundTruthDraft,
  key: StructuredFieldKey,
): boolean {
  const v = draft[key];
  if (v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "object" && v !== null && "content" in v;
}

function groundingScore(draft: GroundTruthDraft): number {
  let grounded = 0;
  let total = 0;
  for (const key of STRUCTURED_FIELD_KEYS) {
    const v = draft[key];
    if (v === undefined) continue;
    const items = Array.isArray(v) ? v : [v];
    for (const it of items) {
      if (it && typeof it === "object" && "source_refs" in it) {
        total += 1;
        const sr = (it as GroundTruthFieldItem).source_refs;
        if (Array.isArray(sr) && sr.length > 0) grounded += 1;
      }
    }
  }
  return total === 0 ? 1 : grounded / total;
}

function gapMessageForField(key: StructuredFieldKey): string {
  const definition = FIELD_DEFINITIONS_ZH[key];
  return `缺少“${definition.label}”：${definition.gap_guidance}`;
}

/** A1 — rule-based MVP structuring (LLM can replace internals later). */
export function runStructuring(ir: DocumentIR): GroundTruthDraft {
  const fullText = ir.blocks.map((b) => b.text_content).join("\n\n");
  const headingBlocks = ir.blocks.filter((b) => b.block_type === "heading");
  const refsHead = ir.blocks.slice(0, 3);

  const scenario =
    headingBlocks[0]?.text_content ??
    (fullText.slice(0, 200) || "Unknown scenario");
  const goalMatch = /goal|目标|目的/i.exec(fullText);
  const goalSnippet = goalMatch
    ? fullText.slice(
        Math.max(0, goalMatch.index ?? 0),
        Math.min(fullText.length, (goalMatch.index ?? 0) + 240),
      )
    : "Define measurable scenario goal.";

  const draft = emptyGroundTruthDraft(ir.doc_id, ir.version_id);
  draft.document_meta = {
    document_id: ir.doc_id,
    version: ir.version_id,
    source_files: [...new Set(ir.blocks.map((b) => b.source_file))],
  };

  draft.business_scenario = fieldItem({ summary: scenario }, refsHead);
  draft.scenario_goal = fieldItem({ text: goalSnippet }, refsHead);
  draft.deliverables = [
    fieldItem({ text: "Deliverables to be confirmed by expert." }, refsHead),
  ];

  const firstBlock = ir.blocks[0];
  draft.required_inputs = [
    fieldItem(
      {
        text: "待专家确认：执行本场景所需的前置输入、数据与权限。",
      },
      firstBlock ? [firstBlock] : refsHead,
    ),
  ];

  const tableBlock = ir.blocks.find((b) => b.block_type === "table");
  const paraBlock = ir.blocks.find((b) => b.block_type === "paragraph");
  const flowSrc = tableBlock ?? paraBlock ?? headingBlocks[1];
  if (flowSrc) {
    draft.process_flow_or_business_model = fieldItem(
      { text: flowSrc.text_content.slice(0, 4000) },
      [flowSrc],
    );
  }

  draft.thinking_framework = [
    fieldItem({ text: goalSnippet }, refsHead.slice(0, 2)),
  ];

  const listBlocks = ir.blocks.filter((b) => b.block_type === "list").slice(0, 8);
  const stepItems: GroundTruthFieldItem[] = listBlocks.map((b, i) => ({
    ...fieldItem({ text: b.text_content }, [b]),
    item_id: `step_${i + 1}`,
  }));
  draft.execution_steps = stepItems;
  draft.execution_actions = stepItems.map((item, i) => ({
    ...item,
    item_id: `action_${i + 1}`,
  }));

  const lastBlock = ir.blocks[ir.blocks.length - 1];
  draft.exceptions_and_non_applicable_scope = [
    fieldItem(
      { text: "待确认：不适用场景、例外情形与边界条件。" },
      lastBlock ? [lastBlock] : refsHead,
    ),
  ];

  const gaps: Gap[] = [];
  for (const key of STRUCTURED_FIELD_KEYS) {
    if (!fieldPopulated(draft, key)) {
      gaps.push({
        field_key: key,
        severity: "medium",
        message: gapMessageForField(key),
      });
    }
  }

  draft.gaps_structured = {
    missing_fields: gaps.map((g) => ({
      field_key: g.field_key,
      message: g.message,
    })),
    weak_fields: [],
    inferred_fields: [],
    needs_confirmation_fields: [],
  };

  const confidence: Record<string, number> = {};
  for (const key of STRUCTURED_FIELD_KEYS) {
    confidence[key] = fieldPopulated(draft, key) ? 0.45 : 0.1;
  }

  const filled = STRUCTURED_FIELD_KEYS.filter((k) =>
    fieldPopulated(draft, k),
  ).length;
  draft.global_scores = {
    completeness_score: filled / STRUCTURED_FIELD_KEYS.length,
    extraction_confidence_score:
      STRUCTURED_FIELD_KEYS.reduce((acc, k) => acc + (confidence[k] ?? 0), 0) /
      STRUCTURED_FIELD_KEYS.length,
    grounding_score: groundingScore(draft),
  };

  draft.gaps = gaps.slice(0, 24);
  draft.confidence_by_field = confidence;
  draft.source_refs = {
    business_scenario: blockRefs(refsHead),
    scenario_goal: blockRefs(refsHead),
  };

  return GroundTruthDraftSchema.parse(draft);
}

/** A5 */
export function runGapDetection(draft: GroundTruthDraft): Gap[] {
  return draft.gaps;
}

/** A2 */
export function runDocQA(input: {
  ir: DocumentIR;
  draft: GroundTruthDraft;
  blockId: string | null;
  evidenceBlockIds?: string[];
  question: string;
  questionSeed?: string | null;
  gapReason?: string | null;
  targetField?: string | null;
}): QAResponse {
  const blockIds = [
    ...new Set([...(input.evidenceBlockIds ?? []), input.blockId].filter(Boolean)),
  ] as string[];
  const blocks = blockIds
    .map((blockId) => input.ir.blocks.find((b) => b.block_id === blockId))
    .filter((block): block is DocumentIR["blocks"][number] => Boolean(block));
  const ctx = blocks.length
    ? blocks
        .map((block) => `[${block.block_id} ${block.block_type}]\n${block.text_content}`)
        .join("\n\n")
    : "(no block selected)";
  const refinedQuestion =
    input.questionSeed && input.questionSeed !== input.question
      ? `${input.questionSeed}\n结合目标字段 ${input.targetField ?? "未指定"} 和缺口原因 ${input.gapReason ?? "未指定"} 回答。`
      : input.question;
  return {
    refined_question: refinedQuestion,
    direct_answer: `针对「${refinedQuestion}」，当前证据摘要：${ctx.slice(0, 1000)}`,
    rationale:
      "基于 Document IR 中的多个证据 block、目标字段与 GroundTruthDraft 上下文生成的占位回答（可接入 LLM）。",
    source_block_refs: blocks.map((block) => block.block_id),
    next_step_suggestion: "可请求改写建议或映射到结构化字段。",
    target_field: input.targetField ?? null,
    suggested_writeback: input.targetField
      ? {
          field_key: input.targetField,
          content: { text: ctx.slice(0, 1000) },
        }
      : undefined,
  };
}

function evidenceBlocksForInput(input: {
  ir: DocumentIR;
  blockId: string | null;
  evidenceBlockIds?: string[];
}): DocumentBlock[] {
  const evidenceBlockIds = [
    ...new Set([...(input.evidenceBlockIds ?? []), input.blockId].filter(Boolean)),
  ] as string[];
  return evidenceBlockIds
    .map((blockId) => input.ir.blocks.find((b) => b.block_id === blockId))
    .filter((block): block is DocumentIR["blocks"][number] => Boolean(block));
}

function compactEvidenceBlocks(blocks: DocumentBlock[], opts?: {
  maxBlocks?: number;
  maxChars?: number;
}) {
  const maxBlocks = opts?.maxBlocks ?? 6;
  const maxChars = opts?.maxChars ?? 800;
  return blocks.slice(0, maxBlocks).map((block) => ({
    block_id: block.block_id,
    block_type: block.block_type,
    text_content:
      block.text_content.length > maxChars
        ? `${block.text_content.slice(0, maxChars)}…`
        : block.text_content,
    source_span: block.source_span,
  }));
}

function buildFallbackQuestionRefinement(input: {
  ir: DocumentIR;
  blockId: string | null;
  evidenceBlockIds?: string[];
  questionSeed?: string | null;
  gapReason?: string | null;
  targetField?: string | null;
}): QuestionRefinementResponse {
  const evidenceBlocks = evidenceBlocksForInput(input);
  const fieldLabel = input.targetField
    ? FIELD_DEFINITIONS_ZH[input.targetField as StructuredFieldKey]?.label ??
      input.targetField
    : "当前字段";
  const seed =
    input.questionSeed?.trim() ||
    `请基于当前证据补充“${fieldLabel}”的专家判断。`;
  const gap = input.gapReason?.trim() || "缺少明确的专家补充说明";
  const contextSummary = evidenceBlocks
    .map((block) => `[${block.block_id} ${block.block_type}] ${block.text_content}`)
    .join("\n\n")
    .slice(0, 1200);
  return {
    refined_question: `${seed} 请结合已选原文证据，说明“${fieldLabel}”应补充哪些判断依据、业务规则或可回写内容。`,
    context_summary: contextSummary || "暂无已选证据 block。",
    source_block_refs: evidenceBlocks.map((block) => block.block_id),
    rationale: `根据目标字段“${fieldLabel}”和缺口原因“${gap}”生成，供专家确认后再提交给 QA Agent。`,
  };
}

function classifyAgentLlmError(err: unknown): {
  reason: string;
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

function buildLlmCallDiagnostics(input: {
  label: string;
  system: string;
  user: string;
  timeoutMs?: number;
  status?: "ok" | "failed" | "skipped";
  startedAt?: number;
  reason?: string;
  message?: string;
}): LlmCallDiagnostics {
  const config = resolveLlmRequestConfig({
    label: input.label,
    timeoutMs: input.timeoutMs,
  });
  return {
    label: input.label,
    provider: config.provider,
    model: config.model,
    timeout_ms: config.timeoutMs,
    system_prompt_chars: input.system.length,
    user_prompt_chars: input.user.length,
    elapsed_ms:
      input.startedAt == null ? undefined : Date.now() - input.startedAt,
    status: input.status ?? "ok",
    reason: input.reason,
    message: input.message,
  };
}

export async function runQuestionRefinementAsync(input: {
  ir: DocumentIR;
  draft: GroundTruthDraft;
  blockId: string | null;
  evidenceBlockIds?: string[];
  questionSeed?: string | null;
  gapReason?: string | null;
  targetField?: string | null;
  metric?: string | null;
  expertMemory?: ExpertMemory;
}): Promise<QuestionRefinementResponse> {
  const fallback = () => buildFallbackQuestionRefinement(input);
  if (process.env.EBS_LLM_QA?.trim() === "0") return fallback();

  const evidenceBlocks = evidenceBlocksForInput(input);
  const related = relatedDraftForBlocks(
    input.draft,
    evidenceBlocks.map((block) => block.block_id),
  );
  const system = `你是 Expert Brain Studio 的问题改写 Agent。你只负责把系统推荐追问、原文证据、目标字段和 GAP 原因改写成一个专家可确认的问题草稿，不回答问题。
使用中文，问题要具体、友好、可回写导向。
结合专家画像：${JSON.stringify(input.expertMemory?.profile ?? {})}
输出 JSON，字段：
- refined_question: 改写后的问题草稿
- context_summary: 证据摘要，不超过 300 字
- source_block_refs: 使用到的 block_id 数组
- rationale: 为什么这样改写`;
  const user = JSON.stringify(
    {
      recommended_question: input.questionSeed,
      target_field: input.targetField,
      gap_reason: input.gapReason,
      low_score_metric: input.metric,
      evidence_blocks: compactEvidenceBlocks(evidenceBlocks),
      related_structured_items: related,
    },
    null,
    2,
  );
  try {
    const label = "qa.refine_question";
    const config = resolveLlmRequestConfig({ label });
    const startedAt = Date.now();
    const raw = await chatCompletionText({
      system,
      user,
      timeoutMs: config.timeoutMs,
      label,
    });
    const parsed = JSON.parse(raw.trim()) as unknown;
    const checked = QuestionRefinementResponseSchema.safeParse(parsed);
    if (checked.success) {
      return {
        ...checked.data,
        llm_diagnostics: buildLlmCallDiagnostics({
          label,
          system,
          user,
          timeoutMs: config.timeoutMs,
          startedAt,
        }),
      };
    }
    return {
      ...fallback(),
      llm_diagnostics: buildLlmCallDiagnostics({
        label,
        system,
        user,
        timeoutMs: config.timeoutMs,
        startedAt,
        status: "failed",
        reason: "schema_validation_error",
        message: "LLM response did not match QuestionRefinementResponseSchema",
      }),
    };
  } catch (err) {
    const label = "qa.refine_question";
    const config = resolveLlmRequestConfig({ label });
    const { reason, message } = classifyAgentLlmError(err);
    return {
      ...fallback(),
      llm_diagnostics: buildLlmCallDiagnostics({
        label,
        system,
        user,
        timeoutMs: config.timeoutMs,
        status: "failed",
        reason,
        message,
      }),
    };
  }
}

function relatedDraftForBlocks(draft: GroundTruthDraft, blockIds: string[]) {
  if (blockIds.length === 0) return [];
  const blockIdSet = new Set(blockIds);
  const related: { field_key: string; content: unknown; status?: string }[] = [];
  for (const key of STRUCTURED_FIELD_KEYS) {
    const raw = draft[key];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of items) {
      const refs = item.source_refs ?? [];
      if (refs.some((r) => r.block_id && blockIdSet.has(r.block_id))) {
        related.push({
          field_key: key,
          content: item.content,
          status: item.status,
        });
      }
    }
  }
  return related.slice(0, 8);
}

export async function runDocQAAsync(input: {
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
}): Promise<QAResponse> {
  const fallback = () =>
    runDocQA({
      ir: input.ir,
      draft: input.draft,
      blockId: input.blockId,
      evidenceBlockIds: input.evidenceBlockIds,
      question: input.question,
      questionSeed: input.questionSeed,
      gapReason: input.gapReason,
      targetField: input.targetField,
    });
  if (process.env.EBS_LLM_QA?.trim() === "0") return fallback();

  const evidenceBlocks = evidenceBlocksForInput(input);
  const related = relatedDraftForBlocks(
    input.draft,
    evidenceBlocks.map((block) => block.block_id),
  );
  const system = `你是 Expert Brain Studio 的 QA Agent。你要帮助行业专家提升结构化文档质量。
使用中文回答。回答必须精准、可追溯、可回写。
结合专家画像：${JSON.stringify(input.expertMemory?.profile ?? {})}
专家近期修正偏好：${JSON.stringify(input.expertMemory?.correction_summaries ?? [])}
你需要先基于 recommended_question、evidence_blocks、target_field 和 gap_reason，在内部生成一个更具体的业务问题 refined_question，然后再回答。
输出 JSON，字段：
- refined_question: 你基于推荐追问和证据生成的具体业务问题
- direct_answer: 直接答案
- rationale: 推理依据，说明引用了哪些原文和结构化字段
- source_block_refs: 字符串数组
- next_step_suggestion: 下一步建议
- target_field: 若适合回写，给出目标字段；否则 null
- suggested_writeback: 可选，{ field_key, content }`;
  const user = JSON.stringify(
    {
      question: input.question,
      recommended_question: input.questionSeed ?? input.question,
      target_field: input.targetField,
      gap_reason: input.gapReason,
      low_score_metric: input.metric,
      evidence_blocks: compactEvidenceBlocks(evidenceBlocks),
      related_structured_items: related,
    },
    null,
    2,
  );
  try {
    const label = "qa.answer";
    const config = resolveLlmRequestConfig({ label });
    const startedAt = Date.now();
    const raw = await chatCompletionText({
      system,
      user,
      timeoutMs: config.timeoutMs,
      label,
    });
    const parsed = JSON.parse(raw.trim()) as unknown;
    const checked = QAResponseSchema.safeParse(parsed);
    if (checked.success) {
      return {
        ...checked.data,
        llm_diagnostics: buildLlmCallDiagnostics({
          label,
          system,
          user,
          timeoutMs: config.timeoutMs,
          startedAt,
        }),
      };
    }
    return {
      ...fallback(),
      llm_diagnostics: buildLlmCallDiagnostics({
        label,
        system,
        user,
        timeoutMs: config.timeoutMs,
        startedAt,
        status: "failed",
        reason: "schema_validation_error",
        message: "LLM response did not match QAResponseSchema",
      }),
    };
  } catch (err) {
    const label = "qa.answer";
    const config = resolveLlmRequestConfig({ label });
    const { reason, message } = classifyAgentLlmError(err);
    return {
      ...fallback(),
      llm_diagnostics: buildLlmCallDiagnostics({
        label,
        system,
        user,
        timeoutMs: config.timeoutMs,
        status: "failed",
        reason,
        message,
      }),
    };
  }
}

/** A6 */
export function evaluatePublishReadiness(
  draft: GroundTruthDraft,
): PublishReadinessResponse {
  const completeness: Record<string, number> = {};
  let filled = 0;
  for (const key of STRUCTURED_FIELD_KEYS) {
    const has = fieldPopulated(draft, key);
    completeness[key] = has ? 1 : 0;
    if (has) filled += 1;
  }
  const ratio = filled / STRUCTURED_FIELD_KEYS.length;
  const blocking =
    ratio < 0.5
      ? ["结构化字段完整度不足", ...draft.gaps.slice(0, 3).map((g) => g.message)]
      : [];
  return {
    readiness_status: blocking.length
      ? "blocked"
      : ratio >= 0.8
        ? "ready"
        : "not_ready",
    blocking_issues: blocking,
    completeness_summary: completeness,
    review_summary: `字段填充比例约 ${Math.round(ratio * 100)}%`,
  };
}
