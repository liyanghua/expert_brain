import { FIELD_DEFINITIONS_ZH, type GroundTruthDraft, type StructuredFieldKey } from "@ebs/ground-truth-schema";
import type { DocumentIR } from "@ebs/document-ir";

export type NotebookRetrievalHit = {
  block_id: string;
  block_type: string;
  source_file: string;
  source_span?: string;
  excerpt: string;
  normalized_text: string;
  tokens: string[];
  section_hints: string[];
  keyword_scores: Record<string, number>;
  score: number;
};

export type RetrievalIndexEntry = {
  block_id: string;
  block_type: string;
  source_file: string;
  source_span?: string;
  text: string;
  normalized_text: string;
  tokens: string[];
  section_hints: string[];
  keyword_scores: Record<string, number>;
};

const FIELD_QUERY_MAP: Record<StructuredFieldKey, string[]> = {
  business_scenario: ["业务场景", "场景", "适用场景", "适用范围"],
  scenario_goal: ["目标", "目的", "结果", "期望"],
  required_inputs: ["输入", "前置条件", "准备", "权限"],
  deliverables: ["输出", "交付", "产出", "结果物"],
  process_flow_or_business_model: ["流程", "业务模型", "链路", "路径"],
  thinking_framework: ["框架", "思路", "原则", "方法论"],
  execution_steps: ["执行步骤", "步骤", "首先", "然后", "最后", "依次", "点击", "进入"],
  execution_actions: ["动作", "执行", "操作", "处理", "完成"],
  key_node_rationales: ["原因", "原理", "为什么", "节点说明"],
  page_screenshots: ["截图", "页面", "界面", "图示"],
  faq_types: ["FAQ", "常见问题", "问题类型", "异常类型"],
  judgment_basis: ["判断依据", "依据", "信号", "标签", "地址", "备注", "风控"],
  judgment_criteria: ["判断标准", "标准", "阈值", "条件", "通过", "异常", "大于", "小于"],
  resolution_methods: ["解决方法", "处理方法", "修复", "排查", "升级处理"],
  trigger_conditions: ["触发", "启动条件", "什么时候开始", "命中后"],
  termination_conditions: ["终止", "结束", "停止处理", "无需继续"],
  validation_methods: ["验证", "校验", "验收", "复核"],
  tool_templates: ["工具", "模板", "表单", "记录表", "检查表", "链接", "截图"],
  exceptions_and_non_applicable_scope: ["例外", "不适用", "边界", "例外情况"],
};

function normalize(text: string) {
  return text.toLowerCase();
}

function tokenize(text: string) {
  return normalize(text)
    .split(/[\s,，。；;：:\n\r\t()（）【】\[\]、]+/)
    .filter(Boolean);
}

function keywordScore(text: string, keyword: string) {
  const q = normalize(keyword);
  if (!q) return 0;
  if (text.includes(q)) return q.length <= 2 ? 1 : 2;
  return 0;
}

function fieldHasContent(draft: GroundTruthDraft, fieldKey: StructuredFieldKey) {
  const value = draft[fieldKey];
  if (!value) return false;
  return Array.isArray(value) ? value.length > 0 : true;
}

export function buildRetrievalIndex(ir: DocumentIR): RetrievalIndexEntry[] {
  return ir.blocks.map((block) => {
    const normalizedText = normalize(block.text_content);
    const tokens = tokenize(block.text_content);
    const sectionHints = [
      block.block_type,
      block.source_span,
      block.source_file,
      ...(block.heading_level ? [`h${block.heading_level}`] : []),
    ].filter((value): value is string => Boolean(value));
    const keyword_scores: Record<string, number> = {};
    for (const [fieldKey, queries] of Object.entries(FIELD_QUERY_MAP)) {
      const guidance = FIELD_DEFINITIONS_ZH[fieldKey as StructuredFieldKey]?.gap_guidance ?? "";
      const score =
        queries.reduce((sum, query) => sum + keywordScore(normalizedText, query), 0) +
        tokenize(guidance).reduce(
          (sum, token) => sum + (token.length >= 2 && normalizedText.includes(token) ? 0.25 : 0),
          0,
        );
      keyword_scores[fieldKey] = Number(score.toFixed(2));
    }
    return {
      block_id: block.block_id,
      block_type: block.block_type,
      source_file: block.source_file,
      source_span: block.source_span ?? undefined,
      text: block.text_content,
      normalized_text: normalizedText,
      tokens,
      section_hints: sectionHints,
      keyword_scores,
    };
  });
}

export function retrieveFieldEvidence(input: {
  index: RetrievalIndexEntry[];
  fieldKey: StructuredFieldKey;
  limit?: number;
}): NotebookRetrievalHit[] {
  const limit = input.limit ?? 3;
  return input.index
    .map((entry) => ({
      ...entry,
      excerpt: entry.text.slice(0, 220),
      score: entry.keyword_scores[input.fieldKey] ?? 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function classifyTaskStatus(input: {
  fieldKey: StructuredFieldKey;
  draft: GroundTruthDraft;
  evidence: NotebookRetrievalHit[];
}): "covered" | "weak" | "missing" {
  const hasDraft = fieldHasContent(input.draft, input.fieldKey);
  const evidenceCount = input.evidence.length;
  const topScore = input.evidence[0]?.score ?? 0;
  if (hasDraft && evidenceCount >= 1 && topScore >= 2) return "covered";
  if (evidenceCount >= 1 && topScore >= 1) return "weak";
  return "missing";
}
