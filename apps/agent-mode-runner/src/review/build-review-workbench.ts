import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BlockRole,
  BlockRoleMap,
  ContinuityDecisionTrace,
  DocumentIR,
  DocumentSynthesis,
  ExtractionScorecard,
  FieldScoreDiagnostic,
  FieldScoreDiagnostics,
  GroundTruthDraft,
  GroundTruthFieldItem,
  SchemaGuidedEvidenceMap,
  SchemaGuidedValidationReport,
  ScoreExplanation,
  SemanticSegment,
  SemanticUnit,
  SourceRef,
} from "../types.js";
import { STRUCTURED_FIELD_KEYS } from "../types.js";
import type {
  ReviewBlockTag,
  ReviewBlockAnnotation,
  ReviewExpertSummaryArtifact,
  ReviewFieldStatus,
  ReviewFriendlyEvaluationItem,
  ReviewHint,
  ReviewMetric,
  ReviewOptimizationArtifact,
  ReviewOptimizationErrorArtifact,
  ReviewOptimizationPlanArtifact,
  ReviewSchemaField,
  ReviewSupportingFieldRef,
  ReviewTagStatus,
  ReviewWorkbenchPayload,
} from "./review-contract.js";

type BuildReviewWorkbenchInput = {
  runDir: string;
};

const FIELD_LABELS: Record<string, string> = {
  business_scenario: "业务场景",
  scenario_goal: "核心目标",
  required_inputs: "前置条件",
  deliverables: "输出成果",
  process_flow_or_business_model: "方法主线",
  thinking_framework: "思考框架",
  execution_steps: "执行步骤",
  execution_actions: "执行动作",
  key_node_rationales: "关键节点依据",
  page_screenshots: "页面示例",
  faq_types: "常见问题类型",
  judgment_basis: "判断依据",
  judgment_criteria: "判断标准",
  resolution_methods: "解决方法",
  trigger_conditions: "触发条件",
  termination_conditions: "终止条件",
  validation_methods: "验证方法",
  tool_templates: "工具模板",
  exceptions_and_non_applicable_scope: "例外与不适用范围",
};

const METRIC_LABELS: Record<string, string> = {
  structured_summary_coverage: "文档总结覆盖度",
  contextualized_block_coverage: "原文片段理解覆盖度",
  structured_summary_grounding_rate: "总结依据清晰度",
  raw_field_coverage: "基础要素完整度",
  field_coverage: "核心要素完整度",
  typed_validation_pass_rate: "内容格式稳定度",
  source_backed_item_rate: "内容依据清晰度",
  source_grounding_rate: "原文依据清晰度",
  structural_consistency: "方法结构完整度",
  gap_detection_accuracy: "缺口识别可信度",
  inference_handling_accuracy: "推测内容可控度",
  duplicate_tag_rate: "重复标注控制",
  over_tagged_block_rate: "片段标注克制度",
  primary_label_coverage: "片段作用识别覆盖度",
  field_boundary_violation_count: "要素边界稳定度",
  overview_block_overclaim_rate: "总述误用控制",
};

const STRUCTURED_FIELD_SET = new Set<string>(STRUCTURED_FIELD_KEYS);
const TECHNICAL_MESSAGE_PATTERN =
  /schema_guided|source-grounded|grounded extraction|required field|optional field|validation|source_ref|artifact|coverage|\bgaps\b/i;

function readJson<T>(runDir: string, fileName: string): T | null {
  const path = join(runDir, fileName);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function requiredJson<T>(runDir: string, fileName: string): T {
  const value = readJson<T>(runDir, fileName);
  if (!value) throw new Error(`Missing required review artifact: ${fileName}`);
  return value;
}

function fieldLabel(fieldKey: string) {
  return FIELD_LABELS[fieldKey] ?? fieldKey;
}

function isStructuredReviewField(fieldKey: string): boolean {
  return STRUCTURED_FIELD_SET.has(fieldKey);
}

function isTechnicalMessage(message?: string): boolean {
  return Boolean(message && TECHNICAL_MESSAGE_PATTERN.test(message));
}

function friendlyMissingReason(fieldKey: string): string {
  const label = fieldLabel(fieldKey);
  if (fieldKey === "deliverables") {
    return "还没有看到明确的输出成果，例如诊断报告、任务清单、数据看板或复盘模板。";
  }
  if (fieldKey === "page_screenshots") {
    return "还没有看到能帮助落地操作的页面示例或截图说明。";
  }
  if (fieldKey === "judgment_criteria") {
    return "还没有看到明确的判断标准，例如阈值、好坏口径、适用条件或正反例。";
  }
  if (fieldKey === "validation_methods") {
    return "还没有看到优化后如何验证有效的说明。";
  }
  return `还没有看到关于“${label}”的明确说明。`;
}

function recommendedStructureForField(fieldKey: string, label = fieldLabel(fieldKey)): string {
  if (fieldKey === "judgment_criteria") {
    return "判断标准 = 指标 + 阈值 + 适用条件 + 正反例 + 验证方式";
  }
  if (fieldKey === "deliverables") {
    return "输出成果 = 成果名称 + 使用场景 + 示例格式 + 交付给谁";
  }
  if (fieldKey === "page_screenshots") {
    return "页面示例 = 页面位置 + 操作动作 + 关键字段 + 示例说明";
  }
  if (fieldKey === "execution_steps") {
    return "执行步骤 = 先做什么 + 再判断什么 + 最后输出什么";
  }
  if (fieldKey === "validation_methods") {
    return "验证方法 = 验证指标 + 对比方式 + 观察周期 + 成功标准";
  }
  return `${label} = 关键内容 + 适用条件 + 原文依据 + 专家备注`;
}

function friendlyHintReason(fieldKey: string, fallback?: string): string {
  if (!isTechnicalMessage(fallback) && fallback) return fallback;
  return friendlyMissingReason(fieldKey);
}

function normalizeBusinessCopy(text: string): string {
  return text
    .replaceAll("FAQ 类型", "常见问题类型")
    .replaceAll("FAQ类型", "常见问题类型")
    .replaceAll("页面截图", "页面示例")
    .replaceAll("交付物", "输出成果")
    .replaceAll("流程主线", "方法主线")
    .replaceAll("输入条件", "前置条件");
}

function normalizeBusinessCopyList(items: string[]): string[] {
  return items.map(normalizeBusinessCopy).filter(Boolean);
}

function itemText(item: GroundTruthFieldItem): string {
  const content = item.content;
  if (typeof content === "string") return content;
  if (
    content &&
    typeof content === "object" &&
    "text" in content &&
    typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text;
  }
  return JSON.stringify(content ?? "");
}

function fieldItems(draft: GroundTruthDraft | null, fieldKey: string): GroundTruthFieldItem[] {
  if (!draft) return [];
  const raw = (draft as unknown as Record<string, unknown>)[fieldKey];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []) as GroundTruthFieldItem[];
}

function sourceBlockIdsFromRefs(refs: SourceRef[]): string[] {
  return [
    ...new Set(
      refs.map((ref) => ref.block_id).filter((blockId): blockId is string => Boolean(blockId)),
    ),
  ];
}

function sourceBlockIdsFromItems(items: GroundTruthFieldItem[]): string[] {
  return sourceBlockIdsFromRefs(items.flatMap((item) => item.source_refs ?? []));
}

function statusFromDiagnostic(
  diagnostic: FieldScoreDiagnostic | undefined,
  validation: SchemaGuidedValidationReport | null,
  fieldKey: string,
): ReviewFieldStatus {
  const validationStatus = validation?.fields?.[fieldKey]?.status ?? diagnostic?.validation_status;
  if (diagnostic?.filled === false || validationStatus === "fail") return "missing";
  if (diagnostic?.source_ref_count === 0 && (diagnostic?.item_count ?? 0) > 0) return "weak_source";
  if (validationStatus === "warn") return "needs_confirmation";
  return "covered";
}

function tagStatusFromFieldStatus(status: ReviewFieldStatus): ReviewTagStatus {
  if (status === "covered") return "covered";
  if (status === "weak_source") return "weak";
  if (status === "needs_confirmation") return "needs_confirmation";
  if (status === "inferred_candidate") return "inferred";
  return "missing";
}

function statusReason(input: {
  diagnostic?: FieldScoreDiagnostic;
  validation?: SchemaGuidedValidationReport | null;
  fieldKey: string;
  items: GroundTruthFieldItem[];
  draft: GroundTruthDraft | null;
}) {
  const reasons = input.diagnostic?.risk_reasons ?? [];
  if (reasons.length > 0) return reasons.join("；");
  const validationMessages = input.validation?.fields?.[input.fieldKey]?.messages ?? [];
  if (validationMessages.length > 0) return validationMessages.join("；");
  const missing = input.draft?.gaps_structured?.missing_fields?.find(
    (gap) => gap.field_key === input.fieldKey,
  );
  if (missing?.message) return missing.message;
  if (input.items.length > 0) {
    return `已有 ${input.items.length} 条结构化内容。${itemText(input.items[0]!).slice(0, 80)}`;
  }
  return `需要专家补充“${fieldLabel(input.fieldKey)}”。`;
}

function friendlyStatusReason(input: {
  diagnostic?: FieldScoreDiagnostic;
  validation?: SchemaGuidedValidationReport | null;
  fieldKey: string;
  items: GroundTruthFieldItem[];
  draft: GroundTruthDraft | null;
}) {
  const label = fieldLabel(input.fieldKey);
  const missing = input.draft?.gaps_structured?.missing_fields?.find(
    (gap) => gap.field_key === input.fieldKey,
  );
  if (missing?.message && !isTechnicalMessage(missing.message)) return missing.message;
  if (input.diagnostic?.filled === false) return friendlyMissingReason(input.fieldKey);
  if (input.diagnostic?.source_ref_count === 0 && (input.diagnostic.item_count ?? 0) > 0) {
    return `已经提到“${label}”，但还需要更清楚地对应到原文依据。`;
  }
  const validationStatus = input.validation?.fields?.[input.fieldKey]?.status ?? input.diagnostic?.validation_status;
  if (validationStatus === "warn") return `“${label}”已有内容，但建议专家再确认表达是否准确。`;
  if (input.items.length > 0) return `已说明“${label}”，可继续检查是否足够具体、可执行。`;
  return `建议补充“${label}”，让文档更完整。`;
}

function buildSchemaFields(input: {
  draft: GroundTruthDraft | null;
  diagnostics: FieldScoreDiagnostics | null;
  validation: SchemaGuidedValidationReport | null;
  evidenceMap: SchemaGuidedEvidenceMap | null;
}): ReviewSchemaField[] {
  const fieldKeys = new Set<string>([
    ...Object.keys(input.diagnostics?.fields ?? {}),
    ...Object.keys(input.validation?.fields ?? {}),
    ...Object.keys(input.evidenceMap?.fields ?? {}),
    ...(input.draft?.gaps_structured?.missing_fields ?? []).map((gap) => gap.field_key),
  ].filter(isStructuredReviewField));
  for (const [key, value] of Object.entries(input.draft ?? {})) {
    if (isStructuredReviewField(key) && Array.isArray(value) && value.length > 0) fieldKeys.add(key);
  }

  return [...fieldKeys].sort().map((fieldKey) => {
    const diagnostic = input.diagnostics?.fields?.[fieldKey];
    const items = fieldItems(input.draft, fieldKey);
    const evidence = input.evidenceMap?.fields?.[fieldKey];
    const evidenceBlockIds = evidence?.selected_block_ids ?? [];
    const itemBlockIds = sourceBlockIdsFromItems(items);
    const sourceBlockIds = [...new Set([...itemBlockIds, ...evidenceBlockIds])];
    const status = statusFromDiagnostic(diagnostic, input.validation, fieldKey);
    return {
      field_key: fieldKey,
      label: fieldLabel(fieldKey),
      required: diagnostic?.required ?? true,
      critical: diagnostic?.critical ?? false,
      status,
      source_block_ids: sourceBlockIds,
      semantic_unit_ids: evidence?.semantic_unit_ids ?? [],
      semantic_segment_ids: evidence?.semantic_segment_ids ?? [],
      item_count: diagnostic?.item_count ?? items.length,
      source_count: diagnostic?.source_ref_count ?? itemBlockIds.length,
      reason: friendlyStatusReason({
        diagnostic,
        validation: input.validation,
        fieldKey,
        items,
        draft: input.draft,
      }),
      risk_reasons: diagnostic?.risk_reasons ?? [],
      gap_priority: diagnostic?.gap_priority,
    };
  });
}

function buildBlockTags(input: {
  fields: ReviewSchemaField[];
  evidenceMap: SchemaGuidedEvidenceMap | null;
  draft: GroundTruthDraft | null;
}): ReviewBlockTag[] {
  const tags = new Map<string, ReviewBlockTag>();
  const addTag = (tag: Omit<ReviewBlockTag, "sources" | "relation"> & { source: ReviewBlockTag["sources"][number] }) => {
    const key = `${tag.block_id}:${tag.field_key}`;
    const existing = tags.get(key);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, tag.source])];
      return;
    }
    tags.set(key, {
      block_id: tag.block_id,
      field_key: tag.field_key,
      label: tag.label,
      status: tag.status,
      sources: [tag.source],
      relation: "supporting_evidence",
    });
  };

  for (const field of input.fields) {
    const status = tagStatusFromFieldStatus(field.status);
    const evidence = input.evidenceMap?.fields?.[field.field_key];
    for (const blockId of evidence?.selected_block_ids ?? []) {
      addTag({
        block_id: blockId,
        field_key: field.field_key,
        label: field.label,
        status,
        source: "evidence_map",
      });
    }
    for (const blockId of sourceBlockIdsFromItems(fieldItems(input.draft, field.field_key))) {
      addTag({
        block_id: blockId,
        field_key: field.field_key,
        label: field.label,
        status,
        source: "draft_source_refs",
      });
    }
    if ((evidence?.selected_block_ids.length ?? 0) === 0 && field.source_block_ids.length > 0) {
      for (const blockId of field.source_block_ids) {
        addTag({
          block_id: blockId,
          field_key: field.field_key,
          label: field.label,
          status,
          source: "diagnostic",
        });
      }
    }
  }

  return [...tags.values()];
}

function buildBlockAnnotations(input: {
  blocks: DocumentIR["blocks"];
  blockRoleMap: BlockRoleMap | null;
  tags: ReviewBlockTag[];
  semanticUnits?: SemanticUnit[];
  continuityTrace?: ContinuityDecisionTrace | null;
}): ReviewBlockAnnotation[] {
  const tagsByBlock = new Map<string, ReviewBlockTag[]>();
  for (const tag of input.tags) {
    const list = tagsByBlock.get(tag.block_id) ?? [];
    list.push(tag);
    tagsByBlock.set(tag.block_id, list);
  }
  const unitByBlock = new Map<string, SemanticUnit>();
  for (const unit of input.semanticUnits ?? []) {
    for (const blockId of unit.source_block_ids) unitByBlock.set(blockId, unit);
  }
  const continuityReasonByPair = new Map(
    (input.continuityTrace?.decisions ?? [])
      .filter((decision) => decision.should_merge)
      .map((decision) => [`${decision.from_block_id}:${decision.to_block_id}`, decision.merge_reason]),
  );
  const refsFromTags = (tags: ReviewBlockTag[]): ReviewSupportingFieldRef[] => {
    const refs = new Map<string, ReviewSupportingFieldRef>();
    for (const tag of tags) {
      const existing = refs.get(tag.field_key);
      if (existing) {
        existing.sources = [...new Set([...existing.sources, ...tag.sources])];
        if (tag.status === "missing") existing.status = "missing";
        continue;
      }
      refs.set(tag.field_key, {
        field_key: tag.field_key,
        label: tag.label,
        status: tag.status,
        sources: tag.sources,
      });
    }
    return [...refs.values()];
  };
  const continuityReasonForUnit = (unit: SemanticUnit | undefined): string | undefined => {
    if (!unit || unit.source_block_ids.length < 2) return undefined;
    const reasons: string[] = [];
    for (let index = 0; index < unit.source_block_ids.length - 1; index += 1) {
      const from = unit.source_block_ids[index]!;
      const to = unit.source_block_ids[index + 1]!;
      const reason = continuityReasonByPair.get(`${from}:${to}`);
      if (reason) reasons.push(reason);
    }
    if (reasons.length > 0) return [...new Set(reasons)].join("；");
    const relation = unit.continuity_edges[0]?.relation;
    if (relation === "elaboration") return "前后段落共同补足一个完整表达。";
    if (relation === "list_expansion") return "后续列表展开说明前一段引出的内容。";
    if (relation === "same_sentence") return "前后段落格式分开，但语义上属于同一句延续。";
    return "这些相邻段落被系统识别为同一语义单元。";
  };
  return input.blocks.map((block) => {
    const role = input.blockRoleMap?.blocks[block.block_id];
    const fallback = inferFallbackBlockAnnotation(block, tagsByBlock.get(block.block_id) ?? []);
    const unit = unitByBlock.get(block.block_id);
    const blockRefs = refsFromTags(tagsByBlock.get(block.block_id) ?? []);
    const unitRefs = unit
      ? refsFromTags(unit.source_block_ids.flatMap((blockId) => tagsByBlock.get(blockId) ?? []))
      : blockRefs;
    return {
      block_id: block.block_id,
      primary_role: role?.primary_role ?? fallback.primary_role,
      primary_label: role?.primary_label ?? fallback.primary_label,
      supporting_field_refs: blockRefs,
      semantic_unit_id: unit?.unit_id,
      semantic_unit_summary: unit?.summary,
      semantic_unit_source_block_ids: unit?.source_block_ids,
      continuity_reason: continuityReasonForUnit(unit),
      unit_supporting_field_refs: unitRefs,
      confidence: role?.confidence ?? fallback.confidence,
      reason: role?.reason ?? fallback.reason,
    };
  });
}

function inferFallbackBlockAnnotation(
  block: DocumentIR["blocks"][number],
  tags: ReviewBlockTag[],
): Pick<ReviewBlockAnnotation, "primary_role" | "primary_label" | "confidence" | "reason"> {
  const tag = tags[0];
  if (tag) {
    const mapped = fallbackRoleFromField(tag.field_key);
    return {
      primary_role: mapped.primary_role,
      primary_label: mapped.primary_label ?? tag.label,
      confidence: 0.58,
      reason: "当前运行未生成全局片段作用图，系统根据文档要素引用推断该片段作用。",
    };
  }
  if (block.block_type === "heading") {
    return {
      primary_role: "business_definition",
      primary_label: "标题/主题",
      confidence: 0.52,
      reason: "当前运行未生成全局片段作用图，系统根据标题层级推断该片段用于说明主题。",
    };
  }
  if (block.block_type === "table" && /判断|标准|阈值|验证|指标/.test(block.text_content)) {
    return {
      primary_role: "validation_rule",
      primary_label: "判断/验证规则",
      confidence: 0.55,
      reason: "当前运行未生成全局片段作用图，系统根据表格中的指标、标准或验证信息推断该片段作用。",
    };
  }
  const text = block.text_content;
  if (/流程|步骤|闭环|阶段|方法论|框架|模型/.test(text)) {
    return {
      primary_role: "process_model",
      primary_label: "方法主线",
      confidence: 0.5,
      reason: "当前运行未生成全局片段作用图，系统根据流程和框架信号推断该片段作用。",
    };
  }
  if (/指标|点击率|转化|GMV|利润|流量|数据/.test(text)) {
    return {
      primary_role: "metric_basis",
      primary_label: "判断依据",
      confidence: 0.48,
      reason: "当前运行未生成全局片段作用图，系统根据指标和数据信号推断该片段作用。",
    };
  }
  if (/问题|下降|异常|根因|诊断|排查/.test(text)) {
    return {
      primary_role: "diagnosis_issue",
      primary_label: "问题诊断",
      confidence: 0.48,
      reason: "当前运行未生成全局片段作用图，系统根据问题和诊断信号推断该片段作用。",
    };
  }
  if (/动作|任务|执行|解决|优化|落地/.test(text)) {
    return {
      primary_role: "action_method",
      primary_label: "执行动作",
      confidence: 0.48,
      reason: "当前运行未生成全局片段作用图，系统根据动作和任务信号推断该片段作用。",
    };
  }
  return {
    primary_role: "supporting_detail",
    primary_label: "补充说明",
    confidence: 0.42,
    reason: "当前运行未生成全局片段作用图，系统将该片段作为上下文补充说明展示。",
  };
}

function fallbackRoleFromField(fieldKey: string): { primary_role: BlockRole; primary_label?: string } {
  if (fieldKey === "business_scenario" || fieldKey === "scenario_goal" || fieldKey === "required_inputs") {
    return { primary_role: "business_definition" };
  }
  if (fieldKey === "process_flow_or_business_model" || fieldKey === "thinking_framework") {
    return { primary_role: "process_model", primary_label: "方法主线" };
  }
  if (fieldKey === "judgment_basis" || fieldKey === "key_node_rationales") {
    return { primary_role: "metric_basis" };
  }
  if (fieldKey === "judgment_criteria" || fieldKey === "validation_methods") {
    return { primary_role: "validation_rule", primary_label: "判断/验证规则" };
  }
  if (fieldKey === "execution_steps" || fieldKey === "execution_actions" || fieldKey === "resolution_methods") {
    return { primary_role: "action_method" };
  }
  if (fieldKey === "trigger_conditions" || fieldKey === "termination_conditions" || fieldKey === "exceptions_and_non_applicable_scope") {
    return { primary_role: "boundary_condition" };
  }
  return { primary_role: "supporting_detail" };
}

function priorityFromValue(value?: string): ReviewHint["priority"] {
  if (!value) return "medium";
  if (/P0|P1|high/i.test(value)) return "high";
  if (/P3|low/i.test(value)) return "low";
  return "medium";
}

function priorityLabel(priority: ReviewHint["priority"]): string {
  if (priority === "high") return "优先补充";
  if (priority === "low") return "可后续完善";
  return "建议补充";
}

function buildHints(input: {
  fields: ReviewSchemaField[];
  explanation: ScoreExplanation | null;
}): ReviewHint[] {
  const fieldsByKey = new Map(input.fields.map((field) => [field.field_key, field]));
  const targets = input.explanation?.recommended_plan_targets ?? [];
  const hints = targets.map((target) => {
    const field = fieldsByKey.get(target.target_field);
    const label = field?.label ?? fieldLabel(target.target_field);
    const whyItMatters = friendlyHintReason(
      target.target_field,
      input.explanation?.field_level_reasons?.[target.target_field]?.join("；") ??
        field?.reason ??
        target.rationale,
    );
    return {
      field_key: target.target_field,
      label,
      priority: priorityFromValue(target.priority ?? field?.gap_priority),
      why_it_matters: whyItMatters,
      what_to_ask: `请补充“${label}”：${whyItMatters}`,
      recommended_structure: recommendedStructureForField(target.target_field, label),
      source_block_ids: field?.source_block_ids ?? [],
      semantic_unit_ids: field?.semantic_unit_ids ?? [],
      semantic_segment_ids: field?.semantic_segment_ids ?? [],
      status: "todo" as const,
    };
  });

  if (hints.length > 0) return hints;
  return input.fields
    .filter((field) => field.status !== "covered")
    .slice(0, 5)
    .map((field) => ({
      field_key: field.field_key,
      label: field.label,
      priority: field.critical ? "high" : "medium",
      why_it_matters: field.reason,
      what_to_ask: `请补充“${field.label}”缺失的信息，并绑定可追溯来源。`,
      recommended_structure: recommendedStructureForField(field.field_key, field.label),
      source_block_ids: field.source_block_ids,
      semantic_unit_ids: field.semantic_unit_ids ?? [],
      semantic_segment_ids: field.semantic_segment_ids ?? [],
      status: "todo",
    }));
}

function buildMetrics(scorecard: ExtractionScorecard | null): ReviewMetric[] {
  return Object.entries(scorecard?.scores ?? {}).map(([key, value]) => ({
    key,
    label: METRIC_LABELS[key] ?? key,
    value: value ?? null,
    status: scorecard?.threshold_check?.[key],
  }));
}

function metricValue(metrics: ReviewMetric[], key: string): number | null {
  const value = metrics.find((metric) => metric.key === key)?.value;
  return typeof value === "number" ? value : null;
}

function percentText(value: number | null): string {
  if (value == null) return "待评估";
  return `${Math.round(value * 100)}%`;
}

function friendlyMetricStatus(value: number | null, goodAt = 0.8): ReviewFriendlyEvaluationItem["status"] {
  if (value == null) return "建议关注";
  if (value >= goodAt) return "表现较好";
  if (value >= 0.55) return "建议关注";
  return "需要补充";
}

function buildFriendlyEvaluation(input: {
  metrics: ReviewMetric[];
  fields: ReviewSchemaField[];
  hints: ReviewHint[];
}): ReviewFriendlyEvaluationItem[] {
  const fieldCoverage = metricValue(input.metrics, "field_coverage") ?? metricValue(input.metrics, "raw_field_coverage");
  const grounding = metricValue(input.metrics, "source_grounding_rate") ?? metricValue(input.metrics, "source_backed_item_rate");
  const structure = metricValue(input.metrics, "structural_consistency");
  const missingCount = input.fields.filter((field) => field.status !== "covered").length;
  const totalFields = input.fields.length;
  return [
    {
      key: "element_completeness",
      label: "要素完整度",
      value_text: percentText(fieldCoverage),
      explanation: "核心文档要素是否已经讲全，例如场景、目标、判断依据、执行动作和验证方法。",
      action:
        missingCount > 0
          ? `优先补充 ${missingCount} 个还不够完整的要素。`
          : "核心要素基本齐全，可以继续检查表达是否准确。",
      status: friendlyMetricStatus(fieldCoverage),
    },
    {
      key: "evidence_clarity",
      label: "依据清晰度",
      value_text: percentText(grounding),
      explanation: "重要结论是否能回到原文依据，方便专家复核和后续追溯。",
      action:
        grounding != null && grounding < 0.8
          ? "建议为关键判断补充更明确的原文依据或案例。"
          : "主要结论已有较清楚的原文依据。",
      status: friendlyMetricStatus(grounding),
    },
    {
      key: "method_actionability",
      label: "方法可执行度",
      value_text: percentText(structure),
      explanation: "文档是否像一套可执行的方法论，包含步骤、标准、动作和验证方式。",
      action:
        structure != null && structure < 0.8
          ? "建议把原则性描述拆成可操作步骤、判断标准和验证方式。"
          : "方法结构较清楚，可继续补充细节边界。",
      status: friendlyMetricStatus(structure),
    },
    {
      key: "expert_followup",
      label: "待专家补充",
      value_text: `${missingCount}/${Math.max(totalFields, 1)} 项`,
      explanation: "系统建议专家优先补充或确认的内容数量。",
      action:
        input.hints[0]?.label != null
          ? `建议先处理“${input.hints[0].label}”。`
          : "暂未发现高优先级补充项。",
      status: missingCount === 0 ? "表现较好" : missingCount <= 3 ? "建议关注" : "需要补充",
    },
  ];
}

function buildReviewQualityMetrics(input: {
  blockCount: number;
  tags: ReviewBlockTag[];
  annotations: ReviewBlockAnnotation[];
  evidenceMap: SchemaGuidedEvidenceMap | null;
}): ReviewMetric[] {
  const tagsByBlock = new Map<string, ReviewBlockTag[]>();
  for (const tag of input.tags) {
    const list = tagsByBlock.get(tag.block_id) ?? [];
    list.push(tag);
    tagsByBlock.set(tag.block_id, list);
  }
  const overTaggedBlocks = [...tagsByBlock.values()].filter((tags) => tags.length > 3).length;
  const primaryLabelCoverage =
    input.blockCount === 0
      ? 0
      : input.annotations.filter((annotation) => annotation.primary_role !== "unknown").length / input.blockCount;
  const scored = Object.entries(input.evidenceMap?.fields ?? {}).flatMap(([fieldKey, field]) =>
    (field.scored_candidates ?? []).map((candidate) => ({ fieldKey, candidate })),
  );
  const boundaryViolations = scored.filter((item) => item.candidate.rejected).length;
  const overviewOverclaims = scored.filter(
    (item) =>
      item.candidate.rejected &&
      ["overview_statement", "process_model"].includes(item.candidate.primary_role ?? "") &&
      ["execution_steps", "execution_actions", "deliverables", "resolution_methods"].includes(item.fieldKey),
  ).length;
  const overviewCandidates = scored.filter((item) =>
    ["overview_statement", "process_model"].includes(item.candidate.primary_role ?? ""),
  ).length;
  return [
    {
      key: "duplicate_tag_rate",
      label: METRIC_LABELS.duplicate_tag_rate ?? "重复标签率",
      value: 0,
      status: "pass",
    },
    {
      key: "over_tagged_block_rate",
      label: METRIC_LABELS.over_tagged_block_rate ?? "过度打标率",
      value: input.blockCount === 0 ? 0 : Number((overTaggedBlocks / input.blockCount).toFixed(4)),
      status: overTaggedBlocks === 0 ? "pass" : "warn",
    },
    {
      key: "primary_label_coverage",
      label: METRIC_LABELS.primary_label_coverage ?? "主标签覆盖率",
      value: Number(primaryLabelCoverage.toFixed(4)),
      status: primaryLabelCoverage >= 0.9 ? "pass" : "warn",
    },
    {
      key: "field_boundary_violation_count",
      label: METRIC_LABELS.field_boundary_violation_count ?? "字段边界违规数",
      value: boundaryViolations,
      status: boundaryViolations === 0 ? "pass" : "warn",
    },
    {
      key: "overview_block_overclaim_rate",
      label: METRIC_LABELS.overview_block_overclaim_rate ?? "总述误认主证据率",
      value: overviewCandidates === 0 ? 0 : Number((overviewOverclaims / overviewCandidates).toFixed(4)),
      status: overviewOverclaims === 0 ? "pass" : "warn",
    },
  ];
}

function buildSemanticCoherenceMetrics(input: {
  documentIr: DocumentIR;
  semanticUnits: SemanticUnit[];
  continuityTrace?: ContinuityDecisionTrace;
}): ReviewMetric[] {
  const nonHeadingBlockCount = input.documentIr.blocks.filter((block) => block.block_type !== "heading").length;
  const coveredBlockCount = new Set(input.semanticUnits.flatMap((unit) => unit.source_block_ids)).size;
  const decisions = input.continuityTrace?.decisions ?? [];
  const mergedDecisions = decisions.filter((decision) => decision.should_merge);
  const fragmentedCandidates = decisions.filter((decision) => !decision.should_merge && decision.rule_score >= 0.5);
  const mergeConfidence =
    mergedDecisions.length === 0
      ? 0
      : mergedDecisions.reduce((sum, decision) => sum + decision.confidence, 0) / mergedDecisions.length;
  return [
    {
      key: "semantic_unit_coverage",
      label: "语义单元覆盖率",
      value: nonHeadingBlockCount === 0 ? 0 : Number((coveredBlockCount / nonHeadingBlockCount).toFixed(4)),
      status: coveredBlockCount >= nonHeadingBlockCount ? "pass" : "warn",
    },
    {
      key: "fragmented_thought_rate",
      label: "完整想法被拆散比例",
      value: decisions.length === 0 ? 0 : Number((fragmentedCandidates.length / decisions.length).toFixed(4)),
      status: fragmentedCandidates.length === 0 ? "pass" : "warn",
    },
    {
      key: "merge_confidence",
      label: "段落合并置信度",
      value: Number(mergeConfidence.toFixed(4)),
      status: mergeConfidence >= 0.6 || mergedDecisions.length === 0 ? "pass" : "warn",
    },
  ];
}

function processSpineText(synthesis: DocumentSynthesis | null): string[] {
  return (synthesis?.process_spine ?? []).map((item) => `${item.section_id}: ${item.role}`);
}

function cleanProcessRole(role: string): string {
  return role
    .replace(/^\d+\.\s*/, "")
    .replace(/^(intro|preparation|framework|diagnosis|metrics|actions|validation|template|appendix):\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

function coreFrameworkFromBlocks(ir: DocumentIR): string | null {
  const text = ir.blocks
    .map((block) => block.text_content)
    .join("\n")
    .replace(/\s+/g, " ");
  if (text.includes("问题 -> 方案 -> 任务 -> 增长")) {
    return "围绕“问题 -> 方案 -> 任务 -> 增长”的诊断和增长闭环";
  }
  if (text.includes("生命周期") && text.includes("诊断维度")) {
    return "按生命周期和诊断维度组织的一套诊断方法";
  }
  return null;
}

function methodSpineText(synthesis: DocumentSynthesis | null): string[] {
  const spine = synthesis?.process_spine ?? [];
  return spine
    .map((item, index) => {
      const text = cleanProcessRole(item.role);
      if (!text) return "";
      if (index === 0) return `先说明${text}`;
      if (index === spine.length - 1) return `最后落到${text}`;
      return `再展开${text}`;
    })
    .filter(Boolean)
    .slice(0, 5);
}

function buildDeterministicSummary(input: {
  documentIr: DocumentIR;
  synthesis: DocumentSynthesis | null;
  fields: ReviewSchemaField[];
  hints: ReviewHint[];
  expertSummary: ReviewExpertSummaryArtifact | null;
}) {
  if (input.expertSummary) {
    return {
      core_idea: normalizeBusinessCopy(input.expertSummary.core_idea),
      method_spine: normalizeBusinessCopyList(input.expertSummary.method_spine),
      expert_commentary: normalizeBusinessCopy(input.expertSummary.expert_commentary),
      review_focuses: normalizeBusinessCopyList([
        ...input.expertSummary.gaps,
        ...input.hints.map((hint) => hint.what_to_ask),
      ]).slice(0, 6),
      source_notes: normalizeBusinessCopyList(input.expertSummary.strengths),
      expert_summary_status: "llm_generated" as const,
    };
  }
  const title =
    input.synthesis?.document_theme ??
    input.documentIr.blocks.find((block) => block.block_type === "heading")?.text_content ??
    "这篇文档";
  const scene = input.synthesis?.business_scene ?? "当前业务场景";
  const goal = input.synthesis?.primary_goal ?? "说明业务方法和执行判断";
  const coreFramework = coreFrameworkFromBlocks(input.documentIr);
  const methodSpine = methodSpineText(input.synthesis);
  const gaps = input.fields
    .filter((field) => field.status !== "covered")
    .map((field) => `${field.label}：${field.reason}`)
    .slice(0, 5);
  const focuses = input.hints.length > 0 ? input.hints.map((hint) => `${priorityLabel(hint.priority)}：${hint.label}`) : gaps;
  return {
    core_idea: coreFramework
      ? `这篇文档的核心思想是把“${scene}”从零散看数据，整理成一套${coreFramework}。它希望专家沿着方法主线发现问题、形成任务，并验证结果。`
      : `这篇文档的核心是围绕“${scene}”解决“${goal}”。它更像一份方法论草稿，需要检查是否已经把判断依据、执行动作和验证方式讲清楚。`,
    method_spine:
      methodSpine.length > 0
        ? methodSpine
        : [`先识别${title}的业务场景`, "再检查关键判断依据", "最后确认执行动作和验证方式"],
    expert_commentary:
      gaps.length > 0
        ? `整体已经形成基础框架，但还需要专家补强：${gaps.slice(0, 3).join("；")}。`
        : "整体结构比较完整，建议继续从可执行性和可验证性角度做专家复核。",
    review_focuses: focuses.slice(0, 6),
    source_notes:
      input.synthesis?.quality_risks?.length
        ? input.synthesis.quality_risks.slice(0, 4)
        : ["系统根据文档结构、要素覆盖和原文依据生成此批改意见。"],
    expert_summary_status: "deterministic" as const,
  };
}

export function buildReviewWorkbench(input: BuildReviewWorkbenchInput): ReviewWorkbenchPayload {
  const runSummary = readJson<{ run_id?: string }>(input.runDir, "run_summary.json");
  const documentIr = requiredJson<DocumentIR>(input.runDir, "document_ir.json");
  const synthesis = readJson<DocumentSynthesis>(input.runDir, "document_synthesis.json");
  const draft = readJson<GroundTruthDraft>(input.runDir, "structured_draft.v0.json");
  const evidenceMap = readJson<SchemaGuidedEvidenceMap>(
    input.runDir,
    "schema_guided_evidence_map.json",
  );
  const blockRoleMap = readJson<BlockRoleMap>(input.runDir, "block_role_map.json");
  const validation = readJson<SchemaGuidedValidationReport>(
    input.runDir,
    "schema_guided_validation_report.json",
  );
  const diagnostics = readJson<FieldScoreDiagnostics>(
    input.runDir,
    "field_score_diagnostics.v0.json",
  );
  const explanation = readJson<ScoreExplanation>(input.runDir, "score_explanation.v0.json");
  const scorecard = readJson<ExtractionScorecard>(input.runDir, "scorecard.v0.json");
  const semanticSegmentsArtifact =
    readJson<{ segments?: SemanticSegment[] }>(input.runDir, "semantic_segments.v0.json") ??
    readJson<{ segments?: SemanticSegment[] }>(input.runDir, "semantic_segments.json");
  const semanticUnitsArtifact =
    readJson<{ units?: SemanticUnit[] }>(input.runDir, "semantic_units.v0.json") ??
    readJson<{ units?: SemanticUnit[] }>(input.runDir, "semantic_units.json");
  const continuityDecisionTrace = readJson<ContinuityDecisionTrace>(input.runDir, "continuity_decision_trace.json");
  const expertSummary = readJson<ReviewExpertSummaryArtifact>(input.runDir, "expert_summary.v0.json");
  const oneClickOptimization = readJson<ReviewOptimizationArtifact>(
    input.runDir,
    "one_click_optimization.v0.json",
  );
  const oneClickOptimizationPlan = readJson<ReviewOptimizationPlanArtifact>(
    input.runDir,
    "one_click_optimization_plan.v0.json",
  );
  const oneClickOptimizationError = readJson<ReviewOptimizationErrorArtifact>(
    input.runDir,
    "one_click_optimization_error.v0.json",
  );

  const schemaFields = buildSchemaFields({ draft, diagnostics, validation, evidenceMap });
  const blockTags = buildBlockTags({ fields: schemaFields, evidenceMap, draft });
  const semanticUnits = semanticUnitsArtifact?.units ?? [];
  const blockAnnotations = buildBlockAnnotations({
    blocks: documentIr.blocks,
    blockRoleMap,
    tags: blockTags,
    semanticUnits,
    continuityTrace: continuityDecisionTrace,
  });
  const hints = buildHints({ fields: schemaFields, explanation });
  const baseMetrics = [
    ...buildMetrics(scorecard),
    ...buildReviewQualityMetrics({
      blockCount: documentIr.blocks.length,
      tags: blockTags,
      annotations: blockAnnotations,
      evidenceMap,
    }),
    ...buildSemanticCoherenceMetrics({
      documentIr,
      semanticUnits,
      continuityTrace: continuityDecisionTrace ?? undefined,
    }),
  ];
  const friendlySummary = buildDeterministicSummary({
    documentIr,
    synthesis,
    fields: schemaFields,
    hints,
    expertSummary,
  });
  const payload: ReviewWorkbenchPayload = {
    run_id: runSummary?.run_id ?? input.runDir.split(/[\\/]/).pop() ?? "unknown_run",
    run_dir: input.runDir,
    generated_at: new Date().toISOString(),
    artifact_source: "agent_mode_runner_step_0_4",
    document: {
      doc_id: documentIr.doc_id,
      version_id: documentIr.version_id,
      blocks: documentIr.blocks,
    },
    document_summary: {
      document_theme:
        synthesis?.document_theme ??
        documentIr.blocks.find((block) => block.block_type === "heading")?.text_content ??
        "未命名文档",
      business_scene: synthesis?.business_scene,
      primary_goal: synthesis?.primary_goal,
      ...friendlySummary,
      summary_for_agent:
        synthesis?.summary_for_agent ??
        `文档已解析为 ${documentIr.blocks.length} 个 block，可进行 Schema 检测。`,
      process_spine: processSpineText(synthesis),
      quality_risks: synthesis?.quality_risks ?? [],
      likely_gaps: synthesis?.likely_gaps ?? [],
      source_block_ids: [],
    },
    semantic_units: semanticUnits,
    continuity_decision_trace: continuityDecisionTrace ?? undefined,
    semantic_segments: semanticSegmentsArtifact?.segments ?? [],
    block_tags: blockTags,
    block_annotations: blockAnnotations,
    schema_fields: schemaFields,
    hints,
    evaluation: {
      metrics: baseMetrics,
    },
    friendly_evaluation: {
      items: buildFriendlyEvaluation({ metrics: baseMetrics, fields: schemaFields, hints }),
      debug_metrics: baseMetrics,
    },
    expert_summary_observability: expertSummary?.observability,
    one_click_optimization_plan: oneClickOptimizationPlan ?? undefined,
    one_click_optimization_error: oneClickOptimizationError ?? undefined,
    one_click_optimization: oneClickOptimization ?? undefined,
    one_click_optimization_observability: oneClickOptimization?.observability,
  };

  writeFileSync(join(input.runDir, "review_workbench.json"), JSON.stringify(payload, null, 2));
  return payload;
}
