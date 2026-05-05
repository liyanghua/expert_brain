import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePlannerProviderConfig } from "../tools/key-config.js";
import type { DocumentBlock, DocumentIR, DocumentSynthesis } from "../types.js";
import type {
  ReviewOptimizationArtifact,
  ReviewOptimizationErrorArtifact,
  ReviewOptimizationParsedResult,
  ReviewOptimizationPatch,
  ReviewOptimizationPatchType,
  ReviewOptimizationPlanArtifact,
  ReviewOptimizationPlanParsedResult,
  ReviewOptimizationTodo,
  ReviewWorkbenchPayload,
} from "./review-contract.js";

export type OneClickOptimizationCompletion = (input: {
  system: string;
  user: string;
}) => Promise<string>;

const PATCH_TYPES = new Set<ReviewOptimizationPatchType>([
  "add_missing_element",
  "strengthen_method",
  "clarify_metric",
  "add_validation",
  "improve_structure",
]);

const POSITIONS = new Set<ReviewOptimizationPatch["suggested_location"]["position"]>([
  "after",
  "before",
  "replace",
  "appendix",
]);

function readJson<T>(runDir: string, fileName: string): T | null {
  const path = join(runDir, fileName);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function compact(text: string, limit = 320): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^\s*(?:\d+[.、)]|[-*])\s*/, "")
    .trim();
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean).slice(0, 8);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|[；;]/)
      .map(cleanText)
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

function fieldLabel(review: Partial<ReviewWorkbenchPayload> | null, fieldKey: string): string {
  return (
    review?.schema_fields?.find((field) => field.field_key === fieldKey)?.label ??
    review?.hints?.find((hint) => hint.field_key === fieldKey)?.label ??
    fieldKey
  );
}

function priorityRank(priority: ReviewOptimizationTodo["priority"]): number {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}

function normalizePriority(value: unknown): ReviewOptimizationTodo["priority"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function semanticSegmentForTodo(input: {
  review: Partial<ReviewWorkbenchPayload>;
  fieldKey: string;
  sourceBlockIds: string[];
}) {
  const sourceBlockSet = new Set(input.sourceBlockIds);
  const fieldMatchedSegments = (input.review.semantic_segments ?? []).filter(
    (segment) =>
      segment.missing_or_weak_fields.includes(input.fieldKey) ||
      segment.related_schema_fields.includes(input.fieldKey),
  );
  const fallbackSegment = [...(input.review.semantic_segments ?? [])]
    .filter((segment) => segment.source_block_ids.length > 0)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return fieldMatchedSegments.find((segment) => {
    const fieldMatch =
      segment.missing_or_weak_fields.includes(input.fieldKey) ||
      segment.related_schema_fields.includes(input.fieldKey);
    const sourceMatch =
      sourceBlockSet.size === 0 ||
      segment.source_block_ids.some((blockId) => sourceBlockSet.has(blockId));
    return fieldMatch && sourceMatch;
  }) ?? fieldMatchedSegments[0] ?? fallbackSegment;
}

function semanticUnitForTodo(input: {
  review: Partial<ReviewWorkbenchPayload>;
  fieldKey: string;
  sourceBlockIds: string[];
  semanticUnitIds?: string[];
}) {
  const unitIds = new Set(input.semanticUnitIds ?? []);
  const sourceBlockSet = new Set(input.sourceBlockIds);
  const units = input.review.semantic_units ?? [];
  return (
    units.find((unit) => unitIds.has(unit.unit_id)) ??
    units.find((unit) => unit.source_block_ids.some((blockId) => sourceBlockSet.has(blockId))) ??
    units.find((unit) => unit.missing_or_weak_fields.includes(input.fieldKey) || unit.related_schema_fields.includes(input.fieldKey))
  );
}

function todoFromHint(
  review: Partial<ReviewWorkbenchPayload>,
  hint: NonNullable<Partial<ReviewWorkbenchPayload>["hints"]>[number],
  index: number,
): ReviewOptimizationTodo {
  const segment = semanticSegmentForTodo({
    review,
    fieldKey: hint.field_key,
    sourceBlockIds: hint.source_block_ids ?? [],
  });
  const unit = semanticUnitForTodo({
    review,
    fieldKey: hint.field_key,
    sourceBlockIds: hint.source_block_ids ?? [],
    semanticUnitIds: hint.semantic_unit_ids,
  });
  return {
    todo_id: `todo_${index + 1}`,
    title: `补充${hint.label}`,
    target_field_key: hint.field_key,
    target_field_label: hint.label,
    reason: hint.what_to_ask || hint.why_it_matters || `建议补充“${hint.label}”。`,
    recommended_structure: hint.recommended_structure || `${hint.label} = 关键信息 + 判断依据 + 示例`,
    source_block_ids: unit?.source_block_ids ?? segment?.source_block_ids ?? hint.source_block_ids ?? [],
    semantic_unit_id: unit?.unit_id,
    semantic_segment_id: segment?.segment_id,
    why_this_segment: segment?.coherence_reason,
    priority: normalizePriority(hint.priority),
    status: "pending",
  };
}

function todoFromField(
  review: Partial<ReviewWorkbenchPayload>,
  field: NonNullable<Partial<ReviewWorkbenchPayload>["schema_fields"]>[number],
  index: number,
): ReviewOptimizationTodo {
  const segment = semanticSegmentForTodo({
    review,
    fieldKey: field.field_key,
    sourceBlockIds: field.source_block_ids ?? [],
  });
  const unit = semanticUnitForTodo({
    review,
    fieldKey: field.field_key,
    sourceBlockIds: field.source_block_ids ?? [],
    semanticUnitIds: field.semantic_unit_ids,
  });
  return {
    todo_id: `todo_${index + 1}`,
    title: `补充${field.label}`,
    target_field_key: field.field_key,
    target_field_label: field.label,
    reason: field.reason || `建议补充“${field.label}”。`,
    recommended_structure: `${field.label} = 关键信息 + 判断依据 + 示例`,
    source_block_ids: unit?.source_block_ids ?? segment?.source_block_ids ?? field.source_block_ids ?? [],
    semantic_unit_id: unit?.unit_id,
    semantic_segment_id: segment?.segment_id,
    why_this_segment: segment?.coherence_reason,
    priority: field.critical ? "high" : "medium",
    status: "pending",
  };
}

function buildOptimizationTodos(review: Partial<ReviewWorkbenchPayload>): ReviewOptimizationTodo[] {
  const todos = new Map<string, ReviewOptimizationTodo>();
  for (const hint of review.hints ?? []) {
    todos.set(hint.field_key, todoFromHint(review, hint, todos.size));
  }
  for (const field of review.schema_fields ?? []) {
    if (field.status === "covered" || todos.has(field.field_key)) continue;
    todos.set(field.field_key, todoFromField(review, field, todos.size));
  }
  return [...todos.values()]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 5)
    .map((todo, index) => ({ ...todo, todo_id: `todo_${index + 1}` }));
}

function buildPlanObservability(input: {
  generatedAt: string;
  review: Partial<ReviewWorkbenchPayload>;
  parsed: ReviewOptimizationPlanParsedResult;
  provider: string;
  model: string;
  prompt?: { system: string; user: string };
  rawResponse?: string;
}) {
  const sourceInput = {
    document_theme: input.review.document_summary?.document_theme,
    review_focuses: input.review.document_summary?.review_focuses ?? [],
    schema_fields_to_check: (input.review.schema_fields ?? [])
      .filter((field) => field.status !== "covered")
      .slice(0, 8)
      .map((field) => ({
        field_key: field.field_key,
        label: field.label,
        status: field.status,
        critical: field.critical,
        reason: field.reason,
        source_block_ids: field.source_block_ids,
      })),
    hints_to_check: (input.review.hints ?? []).slice(0, 8).map((hint) => ({
      field_key: hint.field_key,
      label: hint.label,
      priority: hint.priority,
      why_it_matters: hint.why_it_matters,
      what_to_ask: hint.what_to_ask,
      recommended_structure: hint.recommended_structure,
      source_block_ids: hint.source_block_ids,
      semantic_unit_ids: hint.semantic_unit_ids,
    })),
    semantic_units_shortlist: (input.review.semantic_units ?? []).slice(0, 12).map((unit) => ({
      unit_id: unit.unit_id,
      source_block_ids: unit.source_block_ids,
      summary: unit.summary,
      related_schema_fields: unit.related_schema_fields,
      missing_or_weak_fields: unit.missing_or_weak_fields,
      confidence: unit.confidence,
    })),
    semantic_segments_shortlist: (input.review.semantic_segments ?? []).slice(0, 8).map((segment) => ({
      segment_id: segment.segment_id,
      title: segment.title,
      summary: segment.summary,
      source_block_ids: segment.source_block_ids,
      anchor_block_id: segment.anchor_block_id,
      related_schema_fields: segment.related_schema_fields,
      missing_or_weak_fields: segment.missing_or_weak_fields,
      coherence_reason: segment.coherence_reason,
    })),
    selection_rules: [
      "优先采用已有批改建议中的高优先级待补充事项",
      "优先把 TODO 绑定到语义单元 semantic_unit_id 和语义段落 semantic_segment_id，而不是标题块",
      "再补充未覆盖或弱覆盖的核心文档要素",
      "按优先级排序，最多保留 5 条 TODO",
      "LLM 不可用时使用 deterministic shortlist 兜底",
    ],
  };
  const prompt = input.prompt ?? {
    system: "根据当前批改结果确定性生成优化计划。此阶段不调用 LLM。",
    user: JSON.stringify(sourceInput, null, 2),
  };
  const rawResponse = input.rawResponse ?? JSON.stringify(input.parsed, null, 2);
  return {
    generated_at: input.generatedAt,
    provider: input.provider,
    model: input.model,
    prompt,
    raw_response: rawResponse,
    parsed_result: input.parsed,
    prompt_chars: prompt.system.length + prompt.user.length,
    response_chars: rawResponse.length,
  };
}

function planMetrics(todos: ReviewOptimizationTodo[]) {
  const headingOnly = todos.filter(
    (todo) =>
      todo.source_block_ids.length > 0 &&
      todo.source_block_ids.every((blockId) => /^h\d*|heading/i.test(blockId)),
  ).length;
  const segmentGrounded = todos.filter((todo) => Boolean(todo.semantic_segment_id)).length;
  return {
    heading_only_plan_target_rate: todos.length === 0 ? 0 : Number((headingOnly / todos.length).toFixed(4)),
    segment_grounded_todo_rate: todos.length === 0 ? 0 : Number((segmentGrounded / todos.length).toFixed(4)),
    plan_actionability:
      todos.length === 0
        ? 0
        : Number(
            (
              todos.filter((todo) => todo.source_block_ids.length > 0 && Boolean(todo.recommended_structure)).length /
              todos.length
            ).toFixed(4),
          ),
  };
}

function deterministicPlanParsed(todos: ReviewOptimizationTodo[], fallback?: string): ReviewOptimizationPlanParsedResult {
  return {
    goal: "先补齐这篇文档中最影响落地的关键缺口",
    summary:
      todos.length > 0
        ? `建议先处理 ${todos.length} 个待补充事项，再生成可审阅的优化预览。`
        : "当前没有发现需要优先处理的待补充事项，可以直接人工复核。",
    todos,
    status: "planned",
    fallback_used: Boolean(fallback),
    fallback_reason: fallback,
    metrics: planMetrics(todos),
  };
}

function buildPlanPrompt(input: {
  review: Partial<ReviewWorkbenchPayload>;
  shortlist: ReviewOptimizationTodo[];
}) {
  const payload = {
    document_theme: input.review.document_summary?.document_theme,
    core_idea: input.review.document_summary?.core_idea,
    review_focuses: input.review.document_summary?.review_focuses ?? [],
    semantic_units_shortlist: (input.review.semantic_units ?? []).slice(0, 12),
    semantic_segments_shortlist: (input.review.semantic_segments ?? []).slice(0, 8),
    deterministic_todo_shortlist: input.shortlist,
  };
  return {
    system:
      "你是业务文档批改专家。请基于语义单元、语义段落和文档要素缺口，优化一键优化计划。必须优先指向具体语义单元或正文段落组，不要只指向大标题。只输出 JSON。",
    user: `请输出 JSON，字段为 goal, summary, todos。todos 每项包含 todo_id, title, target_field_key, target_field_label, semantic_unit_id, semantic_segment_id, reason, why_this_segment, recommended_structure, source_block_ids, priority, status。\n${JSON.stringify(payload, null, 2)}`,
  };
}

function normalizePlanTodo(
  raw: unknown,
  index: number,
  deterministic: ReviewOptimizationTodo | undefined,
): ReviewOptimizationTodo | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const targetFieldKey = cleanText(record.target_field_key) || deterministic?.target_field_key || "";
  const sourceBlockIds = stringArray(record.source_block_ids);
  if (!targetFieldKey) return null;
  return {
    todo_id: cleanText(record.todo_id) || deterministic?.todo_id || `todo_${index + 1}`,
    title: cleanText(record.title) || deterministic?.title || `补充${targetFieldKey}`,
    target_field_key: targetFieldKey,
    target_field_label:
      cleanText(record.target_field_label) || deterministic?.target_field_label || targetFieldKey,
    reason: cleanText(record.reason) || deterministic?.reason || "建议补充该文档要素。",
    recommended_structure:
      cleanText(record.recommended_structure) ||
      deterministic?.recommended_structure ||
      "关键信息 + 判断依据 + 示例",
    source_block_ids: sourceBlockIds.length > 0 ? sourceBlockIds : deterministic?.source_block_ids ?? [],
    semantic_unit_id: cleanText(record.semantic_unit_id) || deterministic?.semantic_unit_id,
    semantic_segment_id: cleanText(record.semantic_segment_id) || deterministic?.semantic_segment_id,
    why_this_segment: cleanText(record.why_this_segment) || deterministic?.why_this_segment,
    priority: normalizePriority(record.priority ?? deterministic?.priority),
    status: "pending",
  };
}

function parsePlanResponse(
  response: string,
  deterministicTodos: ReviewOptimizationTodo[],
): ReviewOptimizationPlanParsedResult {
  const parsed = JSON.parse(stripJsonFence(response)) as Record<string, unknown>;
  const todos = Array.isArray(parsed.todos)
    ? parsed.todos
        .map((todo, index) => normalizePlanTodo(todo, index, deterministicTodos[index]))
        .filter((todo): todo is ReviewOptimizationTodo => Boolean(todo))
        .slice(0, 5)
    : [];
  if (todos.length === 0) throw new Error("optimization plan LLM returned empty todos");
  return {
    goal: cleanText(parsed.goal) || "生成文档优化计划",
    summary: cleanText(parsed.summary) || "系统已生成一组待专家确认的优化事项。",
    todos,
    status: "planned",
    fallback_used: false,
    metrics: planMetrics(todos),
  };
}

async function defaultPlanCompletion(input: { system: string; user: string }): Promise<string> {
  const mock = process.env.AGENT_MODE_RUNNER_LLM_OPTIMIZATION_PLAN_MOCK_RESPONSE;
  if (mock != null) return mock;
  const config = resolvePlannerProviderConfig({ provider: "deepseek" });
  const response = await fetch(`${config.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Optimization plan LLM HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Optimization plan LLM returned empty content");
  return content;
}

export async function generateOneClickOptimizationPlanArtifact(input: {
  runDir: string;
  completion?: OneClickOptimizationCompletion;
  useDefaultLlm?: boolean;
}): Promise<ReviewOptimizationPlanArtifact> {
  const review = readJson<Partial<ReviewWorkbenchPayload>>(input.runDir, "review_workbench.json");
  if (!review) throw new Error("Missing review_workbench.json");
  const todos = buildOptimizationTodos(review);
  const generatedAt = new Date().toISOString();
  let provider = "deterministic";
  let model = "rule-based-plan-v1";
  let prompt: { system: string; user: string } | undefined;
  let rawResponse: string | undefined;
  let parsed = deterministicPlanParsed(todos);
  const completion = input.completion ?? (input.useDefaultLlm ? defaultPlanCompletion : undefined);
  if (completion) {
    prompt = buildPlanPrompt({ review, shortlist: todos });
    try {
      rawResponse = await completion(prompt);
      parsed = parsePlanResponse(rawResponse, todos);
      const config = input.completion ? null : resolvePlannerProviderConfig({ provider: "deepseek" });
      provider = config?.safeSummary.provider ?? "mock";
      model = config?.safeSummary.model ?? "mock";
    } catch (err) {
      provider = "deterministic";
      model = "rule-based-plan-v1";
      parsed = deterministicPlanParsed(todos, err instanceof Error ? err.message : String(err));
      rawResponse = rawResponse ?? JSON.stringify(parsed, null, 2);
    }
  }
  const artifact: ReviewOptimizationPlanArtifact = {
    generated_at: generatedAt,
    provider,
    model,
    ...parsed,
    observability: buildPlanObservability({ generatedAt, review, parsed, provider, model, prompt, rawResponse }),
  };
  writeFileSync(
    join(input.runDir, "one_click_optimization_plan.v0.json"),
    JSON.stringify(artifact, null, 2),
  );
  return artifact;
}

function documentBlocks(input: {
  ir: DocumentIR;
  review: Partial<ReviewWorkbenchPayload> | null;
}): { block_id: string; role?: string; text: string }[] {
  const priorityIds = new Set<string>();
  for (const hint of input.review?.hints ?? []) {
    for (const blockId of hint.source_block_ids ?? []) priorityIds.add(blockId);
  }
  for (const field of input.review?.schema_fields ?? []) {
    if (field.status !== "covered") {
      for (const blockId of field.source_block_ids ?? []) priorityIds.add(blockId);
    }
  }
  const byId = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const selected: DocumentBlock[] = [];
  for (const blockId of priorityIds) {
    const block = byId.get(blockId);
    if (block) selected.push(block);
  }
  if (selected.length < 6) {
    selected.push(
      ...input.ir.blocks
        .filter((block) => !priorityIds.has(block.block_id))
        .filter((block) => block.block_type === "heading" || block.text_content.length >= 12)
        .slice(0, 8 - selected.length),
    );
  }
  return selected.slice(0, 8).map((block) => ({
    block_id: block.block_id,
    role: input.review?.block_annotations?.find((item) => item.block_id === block.block_id)
      ?.primary_label,
    text: compact(block.text_content),
  }));
}

function buildPrompt(input: {
  ir: DocumentIR;
  synthesis: DocumentSynthesis | null;
  review: Partial<ReviewWorkbenchPayload> | null;
  plan: ReviewOptimizationPlanArtifact | null;
}) {
  const planTodos =
    input.plan?.todos ??
    buildOptimizationTodos(input.review ?? { schema_fields: [], hints: [] });
  const payload = {
    document_theme:
      input.review?.document_summary?.document_theme ??
      input.synthesis?.document_theme ??
      input.ir.blocks.find((block) => block.block_type === "heading")?.text_content ??
      "未命名文档",
    core_idea: input.review?.document_summary?.core_idea ?? input.synthesis?.summary_for_agent,
    business_scene:
      input.review?.document_summary?.business_scene ?? input.synthesis?.business_scene,
    primary_goal: input.review?.document_summary?.primary_goal ?? input.synthesis?.primary_goal,
    method_spine:
      input.review?.document_summary?.method_spine ??
      input.synthesis?.process_spine?.map((item) => item.role).slice(0, 6),
    review_focuses: input.review?.document_summary?.review_focuses ?? input.synthesis?.likely_gaps,
    optimization_goal: input.plan?.goal,
    optimization_todos: planTodos.map((todo) => ({
      todo_id: todo.todo_id,
      target_field_key: todo.target_field_key,
      target_field_label: todo.target_field_label,
      priority: todo.priority,
      reason: todo.reason,
      recommended_structure: todo.recommended_structure,
      source_block_ids: todo.source_block_ids,
    })),
    representative_blocks: documentBlocks({ ir: input.ir, review: input.review }),
  };
  return {
    system:
      "你是业务文档优化专家。请基于批改结果生成可审阅的优化补丁预览，不要直接重写全文，不要声称已经修改原文。所有补丁必须绑定目标文档要素和原文片段。请只输出 JSON。",
    user: `请输出 JSON，字段为 goal, summary, patches。patches 每项包含 patch_id, title, patch_type, target_field_key, target_field_label, suggested_location, draft_text, rationale, source_block_ids, expected_improvement。patch_type 只能是 add_missing_element, strengthen_method, clarify_metric, add_validation, improve_structure。\n${JSON.stringify(payload, null, 2)}`,
  };
}

function normalizePatch(
  raw: unknown,
  index: number,
  review: Partial<ReviewWorkbenchPayload> | null,
): ReviewOptimizationPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const targetFieldKey = cleanText(record.target_field_key);
  const sourceBlockIds = stringArray(record.source_block_ids);
  const location =
    record.suggested_location && typeof record.suggested_location === "object"
      ? (record.suggested_location as Record<string, unknown>)
      : {};
  const position = POSITIONS.has(location.position as ReviewOptimizationPatch["suggested_location"]["position"])
    ? (location.position as ReviewOptimizationPatch["suggested_location"]["position"])
    : "appendix";
  const patchType = PATCH_TYPES.has(record.patch_type as ReviewOptimizationPatchType)
    ? (record.patch_type as ReviewOptimizationPatchType)
    : "improve_structure";
  const draftText = cleanText(record.draft_text);
  const title = cleanText(record.title) || `优化建议 ${index + 1}`;
  if (!draftText) return null;
  const blockId = cleanText(location.block_id);
  const normalizedSourceBlockIds =
    sourceBlockIds.length > 0 ? sourceBlockIds : blockId ? [blockId] : [];
  return {
    patch_id: cleanText(record.patch_id) || `patch_${index + 1}`,
    title,
    patch_type: patchType,
    target_field_key: targetFieldKey,
    target_field_label: cleanText(record.target_field_label) || fieldLabel(review, targetFieldKey),
    suggested_location: {
      ...(blockId ? { block_id: blockId } : {}),
      position,
    },
    draft_text: draftText,
    rationale: cleanText(record.rationale) || "系统根据当前批改缺口生成此候选补丁。",
    source_block_ids: normalizedSourceBlockIds,
    expected_improvement: cleanText(record.expected_improvement) || "提升文档完整度和可执行性。",
    status: targetFieldKey && normalizedSourceBlockIds.length > 0 ? "preview" : "needs_review",
  };
}

function parseOptimizationResponse(
  text: string,
  review: Partial<ReviewWorkbenchPayload> | null,
): ReviewOptimizationParsedResult {
  const parsed = JSON.parse(stripJsonFence(text)) as Record<string, unknown>;
  const patches = Array.isArray(parsed.patches)
    ? parsed.patches
        .map((patch, index) => normalizePatch(patch, index, review))
        .filter((patch): patch is ReviewOptimizationPatch => Boolean(patch))
        .slice(0, 6)
    : [];
  return {
    goal: cleanText(parsed.goal) || "生成文档优化建议",
    summary: cleanText(parsed.summary) || "系统已生成一组待专家审阅的优化建议。",
    patches,
  };
}

function updatePlanStatus(runDir: string, status: ReviewOptimizationPlanArtifact["status"]) {
  const plan = readJson<ReviewOptimizationPlanArtifact>(
    runDir,
    "one_click_optimization_plan.v0.json",
  );
  if (!plan) return;
  writeFileSync(
    join(runDir, "one_click_optimization_plan.v0.json"),
    JSON.stringify({ ...plan, status }, null, 2),
  );
}

export function writeOneClickOptimizationErrorArtifact(input: {
  runDir: string;
  stage: ReviewOptimizationErrorArtifact["stage"];
  message: string;
  provider?: string;
  model?: string;
  promptChars?: number;
  rawResponse?: string;
}): ReviewOptimizationErrorArtifact {
  const artifact: ReviewOptimizationErrorArtifact = {
    generated_at: new Date().toISOString(),
    stage: input.stage,
    message: input.message,
    provider: input.provider,
    model: input.model,
    prompt_chars: input.promptChars,
    raw_response_preview: input.rawResponse?.slice(0, 800),
  };
  writeFileSync(
    join(input.runDir, "one_click_optimization_error.v0.json"),
    JSON.stringify(artifact, null, 2),
  );
  updatePlanStatus(input.runDir, "preview_failed");
  return artifact;
}

function validateOptimization(value: ReviewOptimizationParsedResult) {
  if (!value.goal) throw new Error("one-click optimization missing goal");
  if (!value.summary) throw new Error("one-click optimization missing summary");
  if (value.patches.length === 0) throw new Error("one-click optimization missing patches");
}

async function defaultCompletion(input: { system: string; user: string }): Promise<string> {
  const mock = process.env.AGENT_MODE_RUNNER_LLM_ONE_CLICK_OPTIMIZATION_MOCK_RESPONSE;
  if (mock != null) return mock;
  const config = resolvePlannerProviderConfig({ provider: "deepseek" });
  const response = await fetch(`${config.base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`One-click optimization LLM HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("One-click optimization LLM returned empty content");
  return content;
}

export async function generateOneClickOptimizationArtifact(input: {
  runDir: string;
  completion?: OneClickOptimizationCompletion;
}): Promise<ReviewOptimizationArtifact> {
  const ir = readJson<DocumentIR>(input.runDir, "document_ir.json");
  if (!ir) throw new Error("Missing document_ir.json");
  const synthesis = readJson<DocumentSynthesis>(input.runDir, "document_synthesis.json");
  const review = readJson<Partial<ReviewWorkbenchPayload>>(input.runDir, "review_workbench.json");
  const plan =
    readJson<ReviewOptimizationPlanArtifact>(input.runDir, "one_click_optimization_plan.v0.json") ??
    (await generateOneClickOptimizationPlanArtifact({ runDir: input.runDir }));
  const prompt = buildPrompt({ ir, synthesis, review, plan });
  const completion = input.completion ?? defaultCompletion;
  const config = input.completion ? null : resolvePlannerProviderConfig({ provider: "deepseek" });
  const provider = config?.safeSummary.provider ?? "mock";
  const model = config?.safeSummary.model ?? "mock";
  const promptChars = prompt.system.length + prompt.user.length;
  let response = "";
  let parsed: ReviewOptimizationParsedResult;
  try {
    response = await completion(prompt);
  } catch (err) {
    writeOneClickOptimizationErrorArtifact({
      runDir: input.runDir,
      stage: "completion",
      message: err instanceof Error ? err.message : String(err),
      provider,
      model,
      promptChars,
    });
    throw err;
  }
  try {
    parsed = parseOptimizationResponse(response, review);
  } catch (err) {
    writeOneClickOptimizationErrorArtifact({
      runDir: input.runDir,
      stage: "parse",
      message: err instanceof Error ? err.message : String(err),
      provider,
      model,
      promptChars,
      rawResponse: response,
    });
    throw err;
  }
  try {
    validateOptimization(parsed);
  } catch (err) {
    writeOneClickOptimizationErrorArtifact({
      runDir: input.runDir,
      stage: "validation",
      message: err instanceof Error ? err.message : String(err),
      provider,
      model,
      promptChars,
      rawResponse: response,
    });
    throw err;
  }
  const generatedAt = new Date().toISOString();
  const responseChars = response.length;
  const artifact: ReviewOptimizationArtifact = {
    generated_at: generatedAt,
    provider,
    model,
    goal: parsed.goal,
    summary: parsed.summary,
    patches: parsed.patches,
    prompt_chars: promptChars,
    response_chars: responseChars,
    observability: {
      generated_at: generatedAt,
      provider,
      model,
      base_host: config?.safeSummary.baseHost,
      prompt,
      raw_response: response,
      parsed_result: parsed,
      prompt_chars: promptChars,
      response_chars: responseChars,
    },
  };
  writeFileSync(
    join(input.runDir, "one_click_optimization.v0.json"),
    JSON.stringify(artifact, null, 2),
  );
  updatePlanStatus(input.runDir, "preview_ready");
  return artifact;
}
