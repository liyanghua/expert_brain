import type {
  BlockRole,
  DocumentBlock,
  FieldBoundaryRule,
  SchemaGuidedEvidenceMap,
  SchemaGuidedFieldEvidence,
  SectionEvidenceHint,
} from "../../types.js";
import type { ExtractionAdapterInput } from "../extraction-adapter.js";
import type { SchemaGuidedFieldPlan } from "./field-plan.js";

export type SelectedFieldEvidence = SchemaGuidedFieldEvidence & {
  blocks: DocumentBlock[];
};

export type SchemaGuidedEvidenceSelection = {
  evidenceMap: SchemaGuidedEvidenceMap;
  selected: Record<string, SelectedFieldEvidence>;
};

const DEFAULT_FIELD_SIGNALS: Record<string, string[]> = {
  business_scenario: ["场景", "业务", "链路", "诊断"],
  scenario_goal: ["目标", "目的", "问题", "结果", "提升"],
  process_flow_or_business_model: ["模型", "框架", "维度", "流程", "拆解"],
  required_inputs: ["输入", "前置", "需要", "数据"],
  deliverables: ["输出", "交付", "结论", "方案"],
  execution_steps: ["步骤", "流程", "操作", "执行", "路径"],
  execution_actions: ["动作", "操作", "执行", "优化"],
  key_node_rationales: ["原因", "依据", "为什么", "本质"],
  page_screenshots: ["截图", "页面", "图片"],
  faq_types: ["问题", "类型", "异常", "表现"],
  judgment_basis: ["指标", "依据", "数据", "点击率", "转化率", "ROI"],
  judgment_criteria: ["标准", "阈值", "连续", "行业均值", "判断"],
  resolution_methods: ["动作", "解决", "处理", "优化", "方法"],
  trigger_conditions: ["触发", "启动", "情况下", "条件"],
  termination_conditions: ["结束", "停止", "终止", "维持"],
  validation_methods: ["验证", "有效", "复盘", "观察周期"],
  tool_templates: ["工具", "表格", "模板", "SOP"],
  exceptions_and_non_applicable_scope: ["例外", "不适用", "样本", "规则"],
};

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function tokenizeSignals(text: string): string[] {
  const normalized = text.replace(/[，。、“”‘’：:；;（）()[\]{}<>|*_`~!?,.]/g, " ");
  return (normalized.match(/[\u4e00-\u9fa5A-Za-z0-9>=<]+/g) ?? [])
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 24);
}

function planSignals(plan: SchemaGuidedFieldPlan): string[] {
  return unique([
    plan.field,
    plan.field.replace(/_/g, " "),
    ...(DEFAULT_FIELD_SIGNALS[plan.field] ?? []),
    ...plan.guidance.flatMap(tokenizeSignals),
  ]).filter(Boolean);
}

function signalsInText(text: string, signals: string[]): string[] {
  return signals.filter((signal) => text.includes(signal));
}

function hintForField(input: ExtractionAdapterInput, field: string): SectionEvidenceHint[] {
  return (input.sectionEvidenceHints?.sections ?? []).filter(
    (section) => section.field_evidence_hints[field],
  );
}

function contextualCandidateIds(input: ExtractionAdapterInput, field: string, signals: string[]): string[] {
  return (input.contextualizedBlocks ?? [])
    .filter(
      (block) =>
        block.extraction_context.likely_related_schema_fields.includes(field) ||
        signalsInText(block.text_content, signals).length > 0,
    )
    .map((block) => block.block_id);
}

function sectionCandidateIds(input: ExtractionAdapterInput, field: string, signals: string[]): string[] {
  return input.sectionCards
    .filter(
      (card) =>
        card.covered_schema_fields.includes(field) ||
        signalsInText(`${card.title} ${card.summary} ${card.key_signals.join(" ")}`, signals).length > 0,
    )
    .flatMap((card) => card.source_block_ids);
}

const ROLE_FIELD_COMPATIBILITY: Record<BlockRole, string[]> = {
  overview_statement: ["business_scenario", "scenario_goal", "process_flow_or_business_model"],
  business_definition: ["business_scenario", "scenario_goal"],
  process_model: ["process_flow_or_business_model", "scenario_goal"],
  metric_basis: ["judgment_basis", "judgment_criteria"],
  diagnosis_issue: ["faq_types", "judgment_basis", "resolution_methods"],
  action_method: ["execution_steps", "execution_actions", "resolution_methods", "trigger_conditions"],
  validation_rule: ["judgment_criteria", "validation_methods", "judgment_basis"],
  boundary_condition: ["trigger_conditions", "termination_conditions", "exceptions_and_non_applicable_scope"],
  supporting_detail: ["deliverables", "tool_templates", "required_inputs"],
  unknown: [],
};

function boundaryRule(input: ExtractionAdapterInput, field: string): FieldBoundaryRule | undefined {
  return input.schemaProfile?.field_boundary_rules?.[field as keyof typeof input.schemaProfile.field_boundary_rules];
}

function contextualBlock(input: ExtractionAdapterInput, blockId: string) {
  return input.contextualizedBlocks?.find((block) => block.block_id === blockId);
}

function semanticSegmentForBlock(input: ExtractionAdapterInput, blockId: string) {
  return input.semanticSegments?.find((segment) => segment.source_block_ids.includes(blockId));
}

function semanticSegmentIdsForBlocks(input: ExtractionAdapterInput, blockIds: string[]): string[] {
  const blockSet = new Set(blockIds);
  return unique(
    (input.semanticSegments ?? [])
      .filter((segment) => segment.source_block_ids.some((blockId) => blockSet.has(blockId)))
      .map((segment) => segment.segment_id),
  );
}

function semanticUnitIdsForBlocks(input: ExtractionAdapterInput, blockIds: string[]): string[] {
  const blockSet = new Set(blockIds);
  return unique(
    (input.contextualizedBlocks ?? [])
      .filter((block) => blockSet.has(block.block_id) && block.semantic_unit_id)
      .map((block) => block.semantic_unit_id!)
  );
}

function scoreCandidate(input: {
  adapterInput: ExtractionAdapterInput;
  plan: SchemaGuidedFieldPlan;
  block: DocumentBlock;
  signals: string[];
}) {
  const matched = signalsInText(input.block.text_content, input.signals);
  const roleEntry = input.adapterInput.blockRoleMap?.blocks[input.block.block_id];
  const primaryRole = roleEntry?.primary_role;
  const rule = boundaryRule(input.adapterInput, input.plan.field);
  const contextual = contextualBlock(input.adapterInput, input.block.block_id);
  const segment = semanticSegmentForBlock(input.adapterInput, input.block.block_id);
  const rejectReasons: string[] = [];
  let boundaryPenalty = 0;

  if (primaryRole && rule?.disallowed_primary_roles?.includes(primaryRole)) {
    boundaryPenalty += 4;
    rejectReasons.push(`role ${primaryRole} is disallowed for ${input.plan.field}`);
  }
  if (primaryRole && roleEntry?.excluded_primary_fields.includes(input.plan.field)) {
    boundaryPenalty += 4;
    rejectReasons.push(`block role excludes ${input.plan.field} as primary evidence`);
  }
  if (primaryRole && rule?.allowed_primary_roles?.length && !rule.allowed_primary_roles.includes(primaryRole)) {
    boundaryPenalty += 3;
    rejectReasons.push(`role ${primaryRole} is not allowed for ${input.plan.field}`);
  }
  if (rule?.negative_signals?.some((signal) => input.block.text_content.includes(signal))) {
    boundaryPenalty += 3;
    rejectReasons.push(`matched negative boundary signal for ${input.plan.field}`);
  }
  if (
    rule?.required_any_signals?.length &&
    !rule.required_any_signals.some((signal) => input.block.text_content.includes(signal))
  ) {
    boundaryPenalty += 2.5;
    rejectReasons.push(`missing required boundary signal for ${input.plan.field}`);
  }

  const signalScore = Math.min(3, matched.length);
  const roleCompatible =
    roleEntry?.compatible_fields.includes(input.plan.field) ||
    (primaryRole ? ROLE_FIELD_COMPATIBILITY[primaryRole].includes(input.plan.field) : false);
  const roleScore = roleCompatible ? 3 : primaryRole ? -1 : 0;
  const sectionScore = contextual?.extraction_context.likely_related_schema_fields.includes(input.plan.field)
    ? 1.5
    : 0;
  const segmentScore =
    segment?.related_schema_fields.includes(input.plan.field) ||
    segment?.missing_or_weak_fields.includes(input.plan.field)
      ? 1.25
      : 0;
  const globalFitScore =
    input.adapterInput.documentSynthesis?.key_signals.some((signal) => input.block.text_content.includes(signal))
      ? 0.5
      : 0;
  const score = signalScore + roleScore + sectionScore + segmentScore + globalFitScore - boundaryPenalty;
  const rejected = boundaryPenalty >= 3 || score <= 0;
  return {
    block_id: input.block.block_id,
    score: Number(score.toFixed(4)),
    signal_score: signalScore,
    role_score: roleScore,
    section_score: sectionScore,
    segment_score: segmentScore,
    boundary_penalty: boundaryPenalty,
    global_fit_score: globalFitScore,
    matched_signals: matched,
    primary_role: primaryRole,
    rejected,
    reject_reasons: rejectReasons,
  };
}

function chooseSelectedEvidence(input: {
  adapterInput: ExtractionAdapterInput;
  plan: SchemaGuidedFieldPlan;
  blockById: Map<string, DocumentBlock>;
  candidates: string[];
  signals: string[];
}): { selectedIds: string[]; scoredCandidates: NonNullable<SchemaGuidedFieldEvidence["scored_candidates"]> } {
  const candidateBlocks = input.candidates
    .map((id) => input.blockById.get(id))
    .filter((block): block is DocumentBlock => Boolean(block));
  const preferredBlocks = candidateBlocks.filter((block) => {
    if (input.plan.tablePreferred) return block.block_type === "table";
    if (input.plan.cardinality === "list" && input.plan.fieldType !== "list_text") {
      return block.block_type === "table" || block.block_type === "list";
    }
    return block.block_type !== "heading";
  });
  const selectedPool = preferredBlocks.length > 0 ? preferredBlocks : candidateBlocks;
  const scored = selectedPool
    .map((block) =>
      scoreCandidate({
        adapterInput: input.adapterInput,
        plan: input.plan,
        block,
        signals: input.signals,
      }),
    )
    .sort((a, b) => b.score - a.score);
  const accepted = scored.filter((candidate) => !candidate.rejected);
  const fallback = scored.filter((candidate) => candidate.score > 0);
  const selected = accepted.length > 0 ? accepted : fallback;
  return {
    selectedIds: selected.slice(0, input.plan.cardinality === "single" ? 1 : 4).map((candidate) => candidate.block_id),
    scoredCandidates: scored,
  };
}

export function selectSchemaGuidedEvidence(input: {
  adapterInput: ExtractionAdapterInput;
  plans: SchemaGuidedFieldPlan[];
}): SchemaGuidedEvidenceSelection {
  const blockById = new Map(input.adapterInput.ir.blocks.map((block) => [block.block_id, block]));
  const fields: Record<string, SchemaGuidedFieldEvidence> = {};
  const selected: Record<string, SelectedFieldEvidence> = {};

  for (const plan of input.plans) {
    const signals = planSignals(plan);
    const hintSections = hintForField(input.adapterInput, plan.field);
    const hintBlockIds = hintSections.flatMap((section) => section.field_evidence_hints[plan.field]?.block_ids ?? []);
    const contextualBlockIds = contextualCandidateIds(input.adapterInput, plan.field, signals);
    const sectionBlockIds = sectionCandidateIds(input.adapterInput, plan.field, signals);
    const candidates = unique([...hintBlockIds, ...contextualBlockIds, ...sectionBlockIds]);
    const { selectedIds, scoredCandidates } = chooseSelectedEvidence({
      adapterInput: input.adapterInput,
      plan,
      blockById,
      candidates,
      signals,
    });
    const selectedBlocks = selectedIds
      .map((id) => blockById.get(id))
      .filter((block): block is DocumentBlock => Boolean(block));
    const matchedSignals = unique(
      selectedBlocks.flatMap((block) => signalsInText(block.text_content, signals)),
    );
    const semanticUnitIds = semanticUnitIdsForBlocks(input.adapterInput, selectedIds);
    const semanticSegmentIds = semanticSegmentIdsForBlocks(input.adapterInput, selectedIds);
    const evidence: SchemaGuidedFieldEvidence = {
      field: plan.field,
      field_type: plan.fieldType,
      candidate_block_ids: candidates,
      selected_block_ids: selectedIds,
      scored_candidates: scoredCandidates,
      semantic_unit_ids: semanticUnitIds,
      selected_semantic_unit_id: semanticUnitIds[0],
      semantic_segment_ids: semanticSegmentIds,
      selected_semantic_segment_id: semanticSegmentIds[0],
      signals: matchedSignals.length > 0 ? matchedSignals : signals.slice(0, 5),
      source_grounded: selectedIds.length > 0,
      table_backed: selectedBlocks.some((block) => block.block_type === "table"),
      selection_reason:
        hintBlockIds.length > 0
          ? "selected from Step 2 field evidence hints"
          : contextualBlockIds.length > 0
            ? "selected from contextualized block extraction context"
            : sectionBlockIds.length > 0
              ? "selected from section card schema signals"
              : "no grounded evidence found",
    };
    fields[plan.field] = evidence;
    selected[plan.field] = {
      ...evidence,
      blocks: selectedBlocks,
    };
  }

  return {
    evidenceMap: {
      extraction_profile: "schema_guided",
      fields,
    },
    selected,
  };
}
