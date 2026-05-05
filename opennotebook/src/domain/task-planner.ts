import type { DocumentIR } from "@ebs/document-ir";
import {
  FIELD_DEFINITIONS_ZH,
  STRUCTURED_FIELD_KEYS,
  type GroundTruthDraft,
  type StructuredFieldKey,
} from "@ebs/ground-truth-schema";

export type ProbeStatus = "covered" | "weak" | "missing" | "conflicting";

export type IndexedBlock = {
  blockId: string;
  blockType: string;
  text: string;
  searchText: string;
  sourceFile: string;
  sourceSpan?: string;
};

export type RetrievalEvidence = {
  blockId: string;
  excerpt: string;
  retrievalScore: number;
  matchType: "keyword";
  sourceFile: string;
  sourceSpan?: string;
};

export type FieldProbeResult = {
  fieldKey: StructuredFieldKey;
  fieldLabel: string;
  status: ProbeStatus;
  score: number;
  reason: string;
  evidence: RetrievalEvidence[];
  recommendedQuestion: string;
  priorityScore: number;
};

export type FocusTask = {
  taskId: string;
  fieldKey: StructuredFieldKey;
  fieldLabel: string;
  priorityScore: number;
  status: Exclude<ProbeStatus, "covered">;
  reason: string;
  recommendedQuestion: string;
  evidenceBlockIds: string[];
  evidence: RetrievalEvidence[];
};

type PriorityFieldConfig = {
  fieldKey: StructuredFieldKey;
  tier: "primary" | "secondary";
  weight: number;
  queries: string[];
};

const PRIORITY_FIELDS: PriorityFieldConfig[] = [
  {
    fieldKey: "execution_steps",
    tier: "primary",
    weight: 1,
    queries: ["执行步骤", "步骤", "流程", "依次", "首先", "然后", "最后", "进入", "点击"],
  },
  {
    fieldKey: "judgment_basis",
    tier: "primary",
    weight: 0.95,
    queries: ["判断依据", "依据", "参考", "查看", "信号", "标签", "备注", "地址", "金额"],
  },
  {
    fieldKey: "judgment_criteria",
    tier: "primary",
    weight: 0.96,
    queries: ["判断标准", "标准", "阈值", "条件", "大于", "小于", "通过", "异常", "判定"],
  },
  {
    fieldKey: "tool_templates",
    tier: "primary",
    weight: 0.88,
    queries: ["工具", "模板", "表单", "表格", "记录表", "检查表", "链接", "截图"],
  },
  {
    fieldKey: "trigger_conditions",
    tier: "secondary",
    weight: 0.78,
    queries: ["触发条件", "触发信号", "命中后", "启动条件", "什么情况下开始"],
  },
  {
    fieldKey: "termination_conditions",
    tier: "secondary",
    weight: 0.76,
    queries: ["终止条件", "无需继续", "流程结束", "停止处理", "终止"],
  },
  {
    fieldKey: "resolution_methods",
    tier: "secondary",
    weight: 0.72,
    queries: ["处理方法", "处理方式", "升级处理", "解决", "操作动作"],
  },
  {
    fieldKey: "validation_methods",
    tier: "secondary",
    weight: 0.7,
    queries: ["验证", "复核", "校验", "验收", "确认结果"],
  },
];

const GAP_STATUS_WEIGHT: Record<Exclude<ProbeStatus, "covered">, number> = {
  missing: 1,
  conflicting: 0.92,
  weak: 0.74,
};

function fieldHasContent(draft: GroundTruthDraft, fieldKey: StructuredFieldKey) {
  const value = draft[fieldKey];
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeText(text: string) {
  return text.toLowerCase();
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(/[\s,，。；;：:\n\r\t()（）【】\[\]、]+/)
    .filter(Boolean);
}

function countKeywordMatches(block: IndexedBlock, query: string) {
  const q = query.toLowerCase();
  if (q.length <= 1) {
    return block.searchText.includes(q) ? 1 : 0;
  }
  return block.searchText.includes(q) ? 2 : 0;
}

function searchForField(index: IndexedBlock[], config: PriorityFieldConfig): RetrievalEvidence[] {
  const scored = index
    .map((block) => {
      let score = 0;
      for (const query of config.queries) {
        score += countKeywordMatches(block, query);
      }
      for (const token of tokenize(FIELD_DEFINITIONS_ZH[config.fieldKey].gap_guidance)) {
        if (token.length >= 2 && block.searchText.includes(token)) score += 0.25;
      }
      return { block, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored.map(({ block, score }) => ({
    blockId: block.blockId,
    excerpt: block.text.slice(0, 180),
    retrievalScore: score,
    matchType: "keyword" as const,
    sourceFile: block.sourceFile,
    sourceSpan: block.sourceSpan,
  }));
}

function classifyProbe(input: {
  config: PriorityFieldConfig;
  draft: GroundTruthDraft;
  evidence: RetrievalEvidence[];
}): Omit<FieldProbeResult, "fieldLabel" | "recommendedQuestion" | "priorityScore"> {
  const { config, draft, evidence } = input;
  const hasDraft = fieldHasContent(draft, config.fieldKey);
  const topScore = evidence[0]?.retrievalScore ?? 0;
  const evidenceCount = evidence.length;
  const combinedText = evidence.map((item) => item.excerpt).join("\n");
  const hasStepPattern =
    /执行步骤|步骤|首先|然后|最后|点击|进入|1[.、]|2[.、]|3[.、]/.test(combinedText);
  const hasCriteriaPattern =
    /判断标准|标准|阈值|通过|不通过|判定|大于|小于|异常|条件/.test(combinedText);
  const hasBasisPattern =
    /判断依据|依据|参考|查看|标签|备注|地址|金额|风控|页面/.test(combinedText);
  const hasToolPattern =
    /模板|表单|记录表|检查表|工具|链接|截图/.test(combinedText);

  let status: ProbeStatus = "missing";
  let score = 0;
  let reason = `未在文档中找到足够支撑“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”的证据。`;

  if (
    config.fieldKey === "execution_steps" &&
    evidenceCount >= 1 &&
    topScore >= 4 &&
    hasStepPattern
  ) {
    status = "covered";
    score = Math.min(1, topScore / 5);
    reason = hasDraft
      ? `文档和草稿都已较完整覆盖“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”。`
      : `文档中已有明确步骤链路，但结构化草稿尚未沉淀“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”。`;
  } else if (
    config.fieldKey === "judgment_criteria" &&
    evidenceCount >= 1 &&
    topScore >= 1.5 &&
    hasCriteriaPattern
  ) {
    status = evidenceCount >= 2 && hasDraft ? "covered" : "weak";
    score = Math.min(0.85, topScore / 4.5);
    reason =
      status === "covered"
        ? `文档中已有较强规则支撑“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”。`
        : `文档出现了局部判断规则，但“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”仍不够完整。`;
  } else if (
    config.fieldKey === "judgment_basis" &&
    evidenceCount >= 1 &&
    topScore >= 2 &&
    hasBasisPattern
  ) {
    status = "weak";
    score = Math.min(0.78, topScore / 4.5);
    reason = `文档里提供了部分依据线索，但还需要专家明确“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”。`;
  } else if (
    config.fieldKey === "tool_templates" &&
    evidenceCount >= 1 &&
    topScore >= 2 &&
    hasToolPattern
  ) {
    status = evidenceCount >= 2 ? "covered" : "weak";
    score = Math.min(0.84, topScore / 4.5);
    reason =
      status === "covered"
        ? `文档中已有明确的“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”引用。`
        : `文档只提到了零散工具或模板线索，仍需补足“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”。`;
  } else if (evidenceCount >= 1 && topScore >= 1.5) {
    status = "weak";
    score = Math.min(0.72, topScore / 4.5);
    reason = `文档里只出现了零散线索，仍需补足“${FIELD_DEFINITIONS_ZH[config.fieldKey].label}”。`;
  }

  return {
    fieldKey: config.fieldKey,
    status,
    score,
    reason,
    evidence,
  };
}

export function buildDocumentIndex(ir: DocumentIR): IndexedBlock[] {
  return ir.blocks.map((block) => ({
    blockId: block.block_id,
    blockType: block.block_type,
    text: block.text_content,
    searchText: normalizeText(block.text_content),
    sourceFile: block.source_file,
    sourceSpan: block.source_span ?? undefined,
  }));
}

export function probePriorityFields(input: {
  ir: DocumentIR;
  draft: GroundTruthDraft;
  index?: IndexedBlock[];
}): FieldProbeResult[] {
  const index = input.index ?? buildDocumentIndex(input.ir);
  return PRIORITY_FIELDS.map((config) => {
    const evidence = searchForField(index, config);
    const probe = classifyProbe({ config, draft: input.draft, evidence });
    const label = FIELD_DEFINITIONS_ZH[config.fieldKey].label;
    const priorityScore =
      probe.status === "covered"
        ? 0
        : Number((config.weight * GAP_STATUS_WEIGHT[probe.status]).toFixed(4));
    return {
      ...probe,
      fieldLabel: label,
      recommendedQuestion:
        probe.status === "missing"
          ? `当前文档没有明确覆盖“${label}”，请专家直接补充可写回内容。`
          : `请结合已选证据，补充“${label}”中仍缺失的业务规则、步骤或模板。`,
      priorityScore,
    };
  });
}

export function createTopTasks(input: {
  probes: FieldProbeResult[];
  limit?: number;
}): FocusTask[] {
  const limit = input.limit ?? 3;
  const sortActionable = (
    probes: Array<FieldProbeResult & { status: Exclude<ProbeStatus, "covered"> }>,
  ) =>
    probes
      .sort((a, b) => {
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        if (a.status !== b.status) {
          const order = { missing: 3, conflicting: 2, weak: 1 };
          return order[b.status] - order[a.status];
        }
        return STRUCTURED_FIELD_KEYS.indexOf(a.fieldKey) - STRUCTURED_FIELD_KEYS.indexOf(b.fieldKey);
      });

  const actionable = input.probes
    .filter(
      (probe): probe is FieldProbeResult & { status: Exclude<ProbeStatus, "covered"> } =>
        probe.status !== "covered",
    );

  const primaryKeys = new Set(
    PRIORITY_FIELDS.filter((item) => item.tier === "primary").map((item) => item.fieldKey),
  );
  const primary = sortActionable(actionable.filter((probe) => primaryKeys.has(probe.fieldKey)));
  const secondary = sortActionable(
    actionable.filter((probe) => !primaryKeys.has(probe.fieldKey)),
  );

  return [...primary, ...secondary]
    .slice(0, limit)
    .map((probe, index) => ({
      taskId: `task-${index + 1}-${probe.fieldKey}`,
      fieldKey: probe.fieldKey,
      fieldLabel: probe.fieldLabel,
      priorityScore: probe.priorityScore,
      status: probe.status,
      reason: probe.reason,
      recommendedQuestion: probe.recommendedQuestion,
      evidenceBlockIds: probe.evidence.map((item) => item.blockId),
      evidence: probe.evidence,
    }));
}
