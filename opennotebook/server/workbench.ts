import type { DocumentIR } from "@ebs/document-ir";
import { FIELD_DEFINITIONS_ZH, type GroundTruthDraft, type StructuredFieldKey } from "@ebs/ground-truth-schema";
import type { NotebookFocusTask } from "./focus-tasks.js";
import type { RetrievalIndexEntry } from "./retrieval.js";

export type NotebookMultimodalNodeType =
  | "text"
  | "table"
  | "image"
  | "equation"
  | "outline";

export type MultimodalSourceNode = {
  node_id: string;
  block_id: string;
  node_type: NotebookMultimodalNodeType;
  block_type: DocumentIR["blocks"][number]["block_type"];
  title: string;
  text_excerpt: string;
  media_uri?: string;
  source_ref: {
    source_file: string;
    source_span?: string;
    page_no?: number | null;
    sheet_name?: string | null;
    node_path?: string | null;
  };
  hierarchy_path: string[];
  evidence_tags: string[];
};

export type SourceViewSection = {
  section_id: string;
  title: string;
  block_ids: string[];
};

export type SourceViewModel = {
  sections: SourceViewSection[];
  nodes: MultimodalSourceNode[];
  block_node_map: Record<string, string>;
};

export type FieldAssessmentStatus =
  | "covered"
  | "weak"
  | "missing"
  | "conflicting"
  | "inferred";

export type FieldAssessment = {
  field_key: StructuredFieldKey;
  field_label: string;
  status: FieldAssessmentStatus;
  reason: string;
  completion_criteria: string;
  evidence_block_ids: string[];
  evidence_preview: Array<{
    block_id: string;
    excerpt: string;
    source_span?: string;
    score: number;
  }>;
  priority_score: number;
};

export const PRIMARY_FIELDS: StructuredFieldKey[] = [
  "execution_steps",
  "judgment_basis",
  "judgment_criteria",
  "tool_templates",
];

export const SECONDARY_FIELDS: StructuredFieldKey[] = [
  "trigger_conditions",
  "termination_conditions",
  "resolution_methods",
  "validation_methods",
];

export const ORDERED_FIELDS: StructuredFieldKey[] = [...PRIMARY_FIELDS, ...SECONDARY_FIELDS];

const STATUS_WEIGHT: Record<FieldAssessmentStatus, number> = {
  missing: 1,
  conflicting: 0.9,
  weak: 0.72,
  inferred: 0.55,
  covered: 0,
};

export const FIELD_QUERY_HINTS: Record<StructuredFieldKey, string[]> = {
  business_scenario: ["业务场景", "适用范围"],
  scenario_goal: ["目标", "目的"],
  required_inputs: ["前置", "输入", "权限", "准备"],
  deliverables: ["输出", "产出", "交付"],
  process_flow_or_business_model: ["流程", "链路", "业务模型"],
  thinking_framework: ["框架", "维度", "思路"],
  execution_steps: ["步骤", "首先", "然后", "最后", "流程"],
  execution_actions: ["动作", "执行", "操作"],
  key_node_rationales: ["原因", "为什么", "说明"],
  page_screenshots: ["截图", "页面", "界面"],
  faq_types: ["FAQ", "常见问题", "异常"],
  judgment_basis: ["依据", "指标", "观察项", "数据"],
  judgment_criteria: ["标准", "阈值", "条件", "通过", "异常"],
  resolution_methods: ["解决", "处理", "修复", "排查"],
  trigger_conditions: ["触发", "开始", "启动条件"],
  termination_conditions: ["终止", "结束", "停止处理"],
  validation_methods: ["验证", "验收", "复核", "校验"],
  tool_templates: ["工具", "模板", "表单", "检查表"],
  exceptions_and_non_applicable_scope: ["例外", "不适用", "边界"],
};

function hasFieldContent(draft: GroundTruthDraft, fieldKey: StructuredFieldKey) {
  const value = draft[fieldKey];
  if (!value) return false;
  return Array.isArray(value) ? value.length > 0 : true;
}

function readFieldTexts(draft: GroundTruthDraft, fieldKey: StructuredFieldKey) {
  const value = draft[fieldKey];
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object" || !("content" in item)) return "";
      const content = (item as { content?: unknown }).content;
      if (typeof content === "string") return content;
      if (content && typeof content === "object" && "text" in content) {
        const text = (content as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return JSON.stringify(content);
    })
    .filter(Boolean);
}

export function fieldCompletionCriteria(fieldKey: StructuredFieldKey) {
  switch (fieldKey) {
    case "execution_steps":
      return "至少能说明开始到完成的关键步骤顺序，并附带明确证据。";
    case "judgment_basis":
      return "至少明确关键观察项、数据或页面信号，并附带证据来源。";
    case "judgment_criteria":
      return "至少明确正常/异常/通过的判定口径或阈值，并附带证据来源。";
    case "tool_templates":
      return "至少明确执行时要用到的模板、表单、截图或工具，并附带证据来源。";
    default:
      return `${FIELD_DEFINITIONS_ZH[fieldKey].label} 至少需要可写回内容和来源证据。`;
  }
}

function multimodalNodeType(
  block: DocumentIR["blocks"][number],
): NotebookMultimodalNodeType {
  switch (block.block_type) {
    case "table":
      return "table";
    case "image":
      return "image";
    case "heading":
    case "outline":
      return "outline";
    case "paragraph":
    case "list":
    default:
      return "text";
  }
}

function fieldStatus(input: {
  fieldKey: StructuredFieldKey;
  draft: GroundTruthDraft;
  evidence: RetrievalIndexEntry[];
}): FieldAssessmentStatus {
  const hasDraft = hasFieldContent(input.draft, input.fieldKey);
  const evidenceCount = input.evidence.length;
  const topScore = input.evidence[0]?.keyword_scores[input.fieldKey] ?? 0;
  const draftTexts = readFieldTexts(input.draft, input.fieldKey).join("\n");

  if (!hasDraft && evidenceCount === 0) return "missing";
  if (!hasDraft && evidenceCount > 0) return "weak";

  if (draftTexts && /待专家确认|to be confirmed|待确认/.test(draftTexts)) {
    return evidenceCount > 0 ? "inferred" : "missing";
  }

  if (evidenceCount >= 2 && topScore >= 2.5 && /冲突|相反|不同|但是/.test(draftTexts)) {
    return "conflicting";
  }

  if (hasDraft && evidenceCount >= 1 && topScore >= 2) return "covered";
  if (hasDraft && evidenceCount >= 1) return "weak";
  return "inferred";
}

function fieldReason(input: {
  fieldKey: StructuredFieldKey;
  status: FieldAssessmentStatus;
  evidenceCount: number;
}) {
  const label = FIELD_DEFINITIONS_ZH[input.fieldKey].label;
  switch (input.status) {
    case "missing":
      return `当前文档里还没有足够支撑“${label}”的有效证据。`;
    case "weak":
      return `文档中出现了与“${label}”相关的线索，但还不足以形成可靠 Ground Truth。`;
    case "conflicting":
      return `“${label}”相关内容存在潜在冲突，需要专家明确口径。`;
    case "inferred":
      return `“${label}”当前主要是推断性内容，还没有足够的直接证据支撑。`;
    case "covered":
      return `“${label}”已有较完整内容与证据支撑。`;
  }
}

function recommendedQuestionFromAssessment(assessment: FieldAssessment) {
  if (assessment.status === "missing") {
    return `请直接补充“${assessment.field_label}”，并尽量明确可写回的业务内容。`;
  }
  if (assessment.status === "conflicting") {
    return `请澄清“${assessment.field_label}”的真实口径，并指出哪条证据应作为准则。`;
  }
  return `请结合当前证据，补强“${assessment.field_label}”中缺失的业务规则、步骤或模板。`;
}

export function buildSourceViewModel(ir: DocumentIR): SourceViewModel {
  const sections: SourceViewSection[] = [];
  const nodes: MultimodalSourceNode[] = [];
  const blockNodeMap: Record<string, string> = {};
  let currentSection: SourceViewSection | null = null;
  let untitledCount = 0;

  for (const block of ir.blocks) {
    if (block.block_type === "heading" || (!currentSection && block.block_type === "outline")) {
      currentSection = {
        section_id: block.block_id,
        title: block.text_content.trim() || `未命名章节 ${++untitledCount}`,
        block_ids: [],
      };
      sections.push(currentSection);
    } else if (!currentSection) {
      currentSection = {
        section_id: `section-${++untitledCount}`,
        title: `未命名章节 ${untitledCount}`,
        block_ids: [],
      };
      sections.push(currentSection);
    }

    currentSection.block_ids.push(block.block_id);
    const nodeId = `node-${block.block_id}`;
    blockNodeMap[block.block_id] = nodeId;
    nodes.push({
      node_id: nodeId,
      block_id: block.block_id,
      node_type: multimodalNodeType(block),
      block_type: block.block_type,
      title:
        block.block_type === "heading" || block.block_type === "outline"
          ? block.text_content
          : `${block.block_type.toUpperCase()} ${block.source_span ?? block.source_file}`,
      text_excerpt: block.text_content.slice(0, block.block_type === "table" ? 360 : 240),
      media_uri: block.media_uri,
      source_ref: {
        source_file: block.source_file,
        source_span: block.source_span ?? undefined,
        page_no: block.page_no ?? null,
        sheet_name: block.sheet_name ?? null,
        node_path: block.node_path ?? null,
      },
      hierarchy_path: currentSection ? [currentSection.title] : [],
      evidence_tags: [],
    });
  }

  return { sections, nodes, block_node_map: blockNodeMap };
}

export function buildFieldAssessments(input: {
  draft: GroundTruthDraft;
  retrievalIndex: RetrievalIndexEntry[];
}): FieldAssessment[] {
  return ORDERED_FIELDS.map((fieldKey, index) => {
    const evidence = input.retrievalIndex
      .filter((entry) => (entry.keyword_scores[fieldKey] ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.keyword_scores[fieldKey] ?? 0) - (a.keyword_scores[fieldKey] ?? 0),
      )
      .slice(0, 4);
    const status = fieldStatus({ fieldKey, draft: input.draft, evidence });
    const priorityBase =
      (PRIMARY_FIELDS.includes(fieldKey) ? 1 : 0.78) * STATUS_WEIGHT[status];
    return {
      field_key: fieldKey,
      field_label: FIELD_DEFINITIONS_ZH[fieldKey].label,
      status,
      reason: fieldReason({ fieldKey, status, evidenceCount: evidence.length }),
      completion_criteria: fieldCompletionCriteria(fieldKey),
      evidence_block_ids: evidence.map((item) => item.block_id),
      evidence_preview: evidence.map((item) => ({
        block_id: item.block_id,
        excerpt: item.text.slice(0, 160),
        source_span: item.source_span,
        score: item.keyword_scores[fieldKey] ?? 0,
      })),
      priority_score: Number((priorityBase - index * 0.0001).toFixed(4)),
    };
  });
}

export function buildFocusTasksFromAssessments(
  assessments: FieldAssessment[],
  limit = 3,
): NotebookFocusTask[] {
  return [...assessments]
    .filter((item) => item.status !== "covered")
    .sort((a, b) => {
      const primaryA = PRIMARY_FIELDS.includes(a.field_key) ? 1 : 0;
      const primaryB = PRIMARY_FIELDS.includes(b.field_key) ? 1 : 0;
      if (primaryA !== primaryB) return primaryB - primaryA;
      const statusRank = {
        missing: 4,
        conflicting: 3,
        weak: 2,
        inferred: 1,
        covered: 0,
      } as const;
      if (statusRank[a.status] !== statusRank[b.status]) {
        return statusRank[b.status] - statusRank[a.status];
      }
      if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
      return ORDERED_FIELDS.indexOf(a.field_key) - ORDERED_FIELDS.indexOf(b.field_key);
    })
    .slice(0, limit)
    .map((assessment) => ({
      task_id: `task-${assessment.field_key}`,
      field_key: assessment.field_key,
      field_label: assessment.field_label,
      priority_score: assessment.priority_score,
      status:
        assessment.status === "covered"
          ? "weak"
          : assessment.status === "conflicting"
            ? "weak"
            : assessment.status === "inferred"
              ? "weak"
              : assessment.status,
      reason: assessment.reason,
      recommended_question: recommendedQuestionFromAssessment(assessment),
      evidence_block_ids: assessment.evidence_block_ids,
      evidence: assessment.evidence_preview.map((item) => ({
        block_id: item.block_id,
        block_type: "text",
        source_file: "",
        source_span: item.source_span,
        excerpt: item.excerpt,
        normalized_text: item.excerpt.toLowerCase(),
        tokens: item.excerpt.split(/\s+/).filter(Boolean),
        section_hints: FIELD_QUERY_HINTS[assessment.field_key],
        keyword_scores: { [assessment.field_key]: item.score },
        score: item.score,
      })),
    }));
}
