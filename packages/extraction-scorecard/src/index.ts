import type { DocumentIR } from "@ebs/document-ir";
import type {
  GroundTruthDraft,
  GroundTruthFieldItem,
  StructuredFieldKey,
} from "@ebs/ground-truth-schema";
import { STRUCTURED_FIELD_KEYS } from "@ebs/ground-truth-schema";
import { z } from "zod";

/** IR.md §3 + §4.1（无 gold 时部分指标为启发式或 skipped） */
export const DEFAULT_THRESHOLDS = {
  field_coverage: { target: 0.8, minimum: 0.7 },
  field_accuracy: { target: 0.85, minimum: 0.75 },
  source_grounding_rate: { target: 0.9, minimum: 0.8 },
  structural_consistency: { target: 0.9, minimum: 0.8 },
  gap_detection_accuracy: { target: 0.75, minimum: 0.6 },
  inference_handling_accuracy: { target: 0.85, minimum: 0.7 },
} as const;

export const METRIC_DEFINITIONS_ZH = {
  field_coverage: {
    label: "字段完整度",
    meaning: "衡量 schema 中应抽取的结构化字段是否已经被填充。",
    calculation: "已填字段数 / STRUCTURED_FIELD_KEYS 总字段数。",
    thresholds: `目标 >= ${DEFAULT_THRESHOLDS.field_coverage.target}，最低可接受 >= ${DEFAULT_THRESHOLDS.field_coverage.minimum}。`,
    low_score_reason: "低分通常表示文档核心要素未被抽出，或抽取结果落在少数字段里。",
  },
  field_accuracy: {
    label: "字段准确率",
    meaning: "衡量字段内容是否与人工 gold 标注一致。",
    calculation: "需要 gold 数据；当前无 gold 时跳过。",
    thresholds: `目标 >= ${DEFAULT_THRESHOLDS.field_accuracy.target}，最低可接受 >= ${DEFAULT_THRESHOLDS.field_accuracy.minimum}。`,
    low_score_reason: "低分表示字段内容可能映射错位或需要人工复核。",
  },
  item_f1: {
    label: "条目 F1",
    meaning: "衡量抽取条目的召回与精确度。",
    calculation: "需要 gold 数据；当前无 gold 时跳过。",
    thresholds: "当前启发式模式跳过。",
    low_score_reason: "低分表示条目粒度可能过粗、过细或遗漏。",
  },
  source_grounding_rate: {
    label: "出处绑定率",
    meaning: "衡量结构化条目是否绑定到原文 block / 页码等出处。",
    calculation: "带 source_refs 的条目数 / 结构化条目总数。",
    thresholds: `目标 >= ${DEFAULT_THRESHOLDS.source_grounding_rate.target}，最低可接受 >= ${DEFAULT_THRESHOLDS.source_grounding_rate.minimum}。`,
    low_score_reason: "低分表示结论不可追溯，专家难以验证来源。",
  },
  structural_consistency: {
    label: "结构一致性",
    meaning: "衡量业务场景、触发条件、终止条件等字段是否形成一致闭环。",
    calculation: "启发式检查关键结构字段是否同文档上下文一致。",
    thresholds: `目标 >= ${DEFAULT_THRESHOLDS.structural_consistency.target}，最低可接受 >= ${DEFAULT_THRESHOLDS.structural_consistency.minimum}。`,
    low_score_reason: "低分表示流程、边界或目标之间可能不一致。",
  },
  gap_detection_accuracy: {
    label: "缺口识别质量",
    meaning: "衡量系统是否识别出缺失字段、弱字段和待确认项。",
    calculation: "启发式检查 gaps_structured / gaps 是否覆盖需要复核的问题。",
    thresholds: `目标 >= ${DEFAULT_THRESHOLDS.gap_detection_accuracy.target}，最低可接受 >= ${DEFAULT_THRESHOLDS.gap_detection_accuracy.minimum}。`,
    low_score_reason: "低分表示系统可能没有发现明显缺口，或缺口列表不可行动。",
  },
  inference_handling_accuracy: {
    label: "推断处理质量",
    meaning: "衡量推断内容是否被标注并等待专家确认。",
    calculation: "根据 InferredCandidate 条目占比进行启发式扣分。",
    thresholds: `目标 >= ${DEFAULT_THRESHOLDS.inference_handling_accuracy.target}，最低可接受 >= ${DEFAULT_THRESHOLDS.inference_handling_accuracy.minimum}。`,
    low_score_reason: "低分表示有较多推断内容需要专家确认。",
  },
  human_revision_rate: {
    label: "人工修订率",
    meaning: "衡量专家对机器草稿的修改量。",
    calculation: "人工修改字段 / 总字段或条目数；当前未接入编辑统计时跳过。",
    thresholds: "目标 <= 0.3，最低可接受 <= 0.45。",
    low_score_reason: "修订率高说明抽取质量或字段映射需要优化。",
  },
} as const;

export type MetricKey = keyof typeof METRIC_DEFINITIONS_ZH;

export const MetricDefinitionSchema = z.object({
  label: z.string(),
  meaning: z.string(),
  calculation: z.string(),
  thresholds: z.string(),
  low_score_reason: z.string(),
});

export const CandidateQuestionSchema = z.object({
  metric: z.string(),
  metric_label: z.string(),
  question: z.string(),
  target_field: z.string().optional(),
  source_block_id: z.string().optional(),
});

export type CandidateQuestion = z.infer<typeof CandidateQuestionSchema>;

export const ExtractionScorecardSchema = z.object({
  document_id: z.string(),
  version_id: z.string(),
  mode: z.enum(["heuristic", "gold"]),
  scores: z.object({
    field_coverage: z.number().optional(),
    field_accuracy: z.number().nullable().optional(),
    item_f1: z.number().nullable().optional(),
    source_grounding_rate: z.number().optional(),
    structural_consistency: z.number().optional(),
    gap_detection_accuracy: z.number().nullable().optional(),
    inference_handling_accuracy: z.number().optional(),
    human_revision_rate: z.number().nullable().optional(),
  }),
  threshold_check: z
    .record(z.enum(["pass", "warn", "fail", "skipped"]))
    .optional(),
  metric_definitions: z.record(MetricDefinitionSchema).default(
    METRIC_DEFINITIONS_ZH,
  ),
  overall_status: z.enum(["ok", "needs_improvement", "blocked"]),
});

export type ExtractionScorecard = z.infer<typeof ExtractionScorecardSchema>;

export const ImprovementPlanSchema = z.object({
  document_id: z.string(),
  version_id: z.string(),
  priority_actions: z.array(
    z.object({
      metric: z.string(),
      reason: z.string(),
      actions: z.array(z.string()),
      metric_display_name: z.string().optional(),
      actions_display: z.array(z.string()).optional(),
    }),
  ),
  candidate_questions: z.array(CandidateQuestionSchema).default([]),
});

export type ImprovementPlan = z.infer<typeof ImprovementPlanSchema>;

function fieldPopulated(
  draft: GroundTruthDraft,
  key: StructuredFieldKey,
): boolean {
  const v = draft[key];
  if (v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "object" && v !== null && "content" in v;
}

function countGroundedItems(draft: GroundTruthDraft): {
  grounded: number;
  total: number;
} {
  let grounded = 0;
  let total = 0;
  for (const key of STRUCTURED_FIELD_KEYS) {
    const v = draft[key];
    if (!v) continue;
    const items = Array.isArray(v) ? v : [v];
    for (const it of items) {
      if (it && typeof it === "object" && "source_refs" in it) {
        const refs = (it as { source_refs?: unknown[] }).source_refs;
        total += 1;
        if (Array.isArray(refs) && refs.length > 0) grounded += 1;
      }
    }
  }
  return { grounded, total };
}

/** 极简结构一致性：触发/终止与场景是否同文档（启发式） */
function structuralConsistencyHeuristic(
  draft: GroundTruthDraft,
  ir: DocumentIR,
): number {
  const text = ir.blocks.map((b) => b.text_content).join("\n").toLowerCase();
  let rules = 0;
  let pass = 0;
  if (draft.business_scenario) {
    rules += 1;
    if (text.length > 20) pass += 1;
  }
  if (draft.trigger_conditions?.length || draft.termination_conditions?.length) {
    rules += 1;
    pass += 1;
  }
  return rules === 0 ? 1 : pass / rules;
}

/** 启发式：有结构化缺口列表即认为检测动作发生；无缺口略降分（可能漏检） */
function gapDetectionHeuristic(draft: GroundTruthDraft): number {
  const listed =
    draft.gaps_structured?.missing_fields?.length ?? draft.gaps.length;
  if (listed === 0) return 0.55;
  return Math.min(1, 0.62 + Math.min(listed, 8) * 0.04);
}

function inferenceHandlingHeuristic(draft: GroundTruthDraft): number {
  let inferred = 0;
  let total = 0;
  for (const key of STRUCTURED_FIELD_KEYS) {
    const v = draft[key];
    if (v === undefined) continue;
    const items: GroundTruthFieldItem[] = Array.isArray(v) ? v : [v];
    for (const it of items) {
      if (it && typeof it === "object" && "status" in it) {
        total += 1;
        if (it.status === "InferredCandidate") inferred += 1;
      }
    }
  }
  if (total === 0) return 1;
  return Math.max(0.45, 1 - (inferred / total) * 0.35);
}

export function computeExtractionScorecard(input: {
  draft: GroundTruthDraft;
  ir: DocumentIR;
  humanRevisionRate?: number | null;
}): ExtractionScorecard {
  const { draft, ir } = input;
  const totalFields = STRUCTURED_FIELD_KEYS.length;
  const filled = STRUCTURED_FIELD_KEYS.filter((k) =>
    fieldPopulated(draft, k),
  ).length;
  const field_coverage = filled / totalFields;

  const { grounded, total } = countGroundedItems(draft);
  const source_grounding_rate = total === 0 ? 1 : grounded / total;

  const structural_consistency = structuralConsistencyHeuristic(draft, ir);
  const gap_detection_accuracy = gapDetectionHeuristic(draft);
  const inference_handling_accuracy = inferenceHandlingHeuristic(draft);

  const threshold_check: Record<string, "pass" | "warn" | "fail" | "skipped"> =
    {};
  const t = DEFAULT_THRESHOLDS;

  const check = (
    name: keyof typeof DEFAULT_THRESHOLDS,
    value: number | undefined,
  ) => {
    const th = t[name];
    if (value === undefined) {
      threshold_check[name] = "skipped";
      return;
    }
    if (value >= th.target) threshold_check[name] = "pass";
    else if (value >= th.minimum) threshold_check[name] = "warn";
    else threshold_check[name] = "fail";
  };

  check("field_coverage", field_coverage);
  threshold_check.field_accuracy = "skipped";
  threshold_check.item_f1 = "skipped";
  check("source_grounding_rate", source_grounding_rate);
  check("structural_consistency", structural_consistency);
  check("gap_detection_accuracy", gap_detection_accuracy);
  check("inference_handling_accuracy", inference_handling_accuracy);
  if (input.humanRevisionRate != null) {
    const h = input.humanRevisionRate;
    threshold_check.human_revision_rate =
      h <= 0.3 ? "pass" : h <= 0.45 ? "warn" : "fail";
  } else {
    threshold_check.human_revision_rate = "skipped";
  }

  const fails = Object.values(threshold_check).filter((x) => x === "fail");
  const warns = Object.values(threshold_check).filter((x) => x === "warn");
  const overall_status =
    fails.length > 0
      ? "blocked"
      : warns.length > 0
        ? "needs_improvement"
        : "ok";

  return ExtractionScorecardSchema.parse({
    document_id: draft.doc_id,
    version_id: draft.version_id,
    mode: "heuristic",
    scores: {
      field_coverage,
      field_accuracy: null,
      item_f1: null,
      source_grounding_rate,
      structural_consistency,
      gap_detection_accuracy,
      inference_handling_accuracy,
      human_revision_rate: input.humanRevisionRate ?? null,
    },
    threshold_check,
    metric_definitions: METRIC_DEFINITIONS_ZH,
    overall_status,
  });
}

export function buildCandidateQuestionsFromScorecard(
  scorecard: ExtractionScorecard,
  draft?: GroundTruthDraft,
  ir?: DocumentIR,
): CandidateQuestion[] {
  const out: CandidateQuestion[] = [];
  const add = (
    metric: MetricKey,
    question: string,
    target_field?: string,
    source_block_id?: string,
  ) => {
    const status = scorecard.threshold_check?.[metric];
    if (status !== "warn" && status !== "fail") return;
    out.push({
      metric,
      metric_label: METRIC_DEFINITIONS_ZH[metric].label,
      question,
      target_field,
      source_block_id,
    });
  };

  const firstBlock = ir?.blocks[0]?.block_id;
  const missing = STRUCTURED_FIELD_KEYS.filter((k) => {
    if (!draft) return false;
    return !fieldPopulated(draft, k);
  }).slice(0, 4);

  add(
    "field_coverage",
    missing.length
      ? `当前缺少 ${missing.join("、")}，请专家确认这些字段应如何补充？`
      : "当前文档还有哪些关键输入、交付物、判断标准或执行动作没有被结构化？",
    missing[0],
    firstBlock,
  );
  add(
    "source_grounding_rate",
    "哪些结构化结论缺少原文出处？请指出应该绑定到哪些原文段落或表格行。",
    undefined,
    firstBlock,
  );
  add(
    "structural_consistency",
    "业务场景、目标、触发条件和终止条件是否一致？是否有需要专家裁定的边界？",
  );
  add(
    "gap_detection_accuracy",
    "当前缺口列表是否遗漏了重要问题？请补充最需要专家确认的缺口。",
  );
  add(
    "inference_handling_accuracy",
    "哪些内容是模型推断而非原文直接说明？请专家确认是否成立。",
  );
  if (scorecard.threshold_check?.human_revision_rate === "warn" || scorecard.threshold_check?.human_revision_rate === "fail") {
    out.push({
      metric: "human_revision_rate",
      metric_label: METRIC_DEFINITIONS_ZH.human_revision_rate.label,
      question: "哪些字段最常被专家修改？是否需要调整抽取规则或专家偏好？",
    });
  }
  return out;
}

export function buildImprovementPlan(
  scorecard: ExtractionScorecard,
  draft?: GroundTruthDraft,
  ir?: DocumentIR,
): ImprovementPlan {
  const actions: ImprovementPlan["priority_actions"] = [];

  if (
    scorecard.threshold_check?.field_coverage === "warn" ||
    scorecard.threshold_check?.field_coverage === "fail"
  ) {
    actions.push({
      metric: "field_coverage",
      metric_display_name: METRIC_DEFINITIONS_ZH.field_coverage.label,
      reason: "多个结构化字段仍为空",
      actions: [
        "run_list_completion_prompt",
        "ask_user_for_missing_items",
        "优先展示缺失字段卡",
      ],
      actions_display: ["补全字段清单", "向专家追问缺失项", "优先展示缺失字段卡"],
    });
  }

  if (
    scorecard.threshold_check?.source_grounding_rate === "warn" ||
    scorecard.threshold_check?.source_grounding_rate === "fail"
  ) {
    actions.push({
      metric: "source_grounding_rate",
      metric_display_name: METRIC_DEFINITIONS_ZH.source_grounding_rate.label,
      reason: "条目缺少精确 block / 页码绑定",
      actions: [
        "rerun_source_binding",
        "enable_mapping_confirmation_ui",
      ],
      actions_display: ["重新绑定出处", "打开映射确认界面"],
    });
  }

  if (
    scorecard.threshold_check?.structural_consistency === "warn" ||
    scorecard.threshold_check?.structural_consistency === "fail"
  ) {
    actions.push({
      metric: "structural_consistency",
      metric_display_name: METRIC_DEFINITIONS_ZH.structural_consistency.label,
      reason: "字段间一致性不足",
      actions: ["trigger_conflict_check", "请求专家裁定"],
      actions_display: ["检查字段冲突", "请求专家裁定"],
    });
  }

  if (
    scorecard.threshold_check?.gap_detection_accuracy === "warn" ||
    scorecard.threshold_check?.gap_detection_accuracy === "fail"
  ) {
    actions.push({
      metric: "gap_detection_accuracy",
      metric_display_name: METRIC_DEFINITIONS_ZH.gap_detection_accuracy.label,
      reason: "缺口识别或与结构化 gaps 不一致",
      actions: ["rerun_gap_detection", "对照 gaps_structured 复核"],
      actions_display: ["重新识别缺口", "对照结构化缺口复核"],
    });
  }

  if (
    scorecard.threshold_check?.inference_handling_accuracy === "warn" ||
    scorecard.threshold_check?.inference_handling_accuracy === "fail"
  ) {
    actions.push({
      metric: "inference_handling_accuracy",
      metric_display_name: METRIC_DEFINITIONS_ZH.inference_handling_accuracy.label,
      reason: "存在待确认的推断字段（InferredCandidate）",
      actions: ["open_mapping_confirmation_ui", "标记需专家确认项"],
      actions_display: ["打开映射确认", "标记需专家确认项"],
    });
  }

  if (actions.length === 0 && scorecard.overall_status !== "ok") {
    actions.push({
      metric: "overall",
      metric_display_name: "综合质量",
      reason: "综合状态需复核",
      actions: ["open_review_panel"],
      actions_display: ["打开复核面板"],
    });
  }

  return ImprovementPlanSchema.parse({
    document_id: scorecard.document_id,
    version_id: scorecard.version_id,
    priority_actions: actions,
    candidate_questions: buildCandidateQuestionsFromScorecard(
      scorecard,
      draft,
      ir,
    ),
  });
}
