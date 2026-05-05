export type QualityIssueOpsCopyInput = {
  summary?: string | null;
  reason?: string | null;
  fieldLabel?: string | null;
  issueType?: string | null;
  severity?: "low" | "medium" | "high" | null;
};

const FIELD_COPY: Record<string, { headline: string; description: string }> = {
  执行步骤: {
    headline: "补充可落地的操作步骤",
    description: "这部分已经说明了方向，但还缺少专家可直接复用的操作顺序、责任角色或关键动作。",
  },
  判断依据: {
    headline: "补充判断依据和关键观察信号",
    description: "这部分需要说明专家通常看哪些指标、信号或例外情况，避免只停留在结论。",
  },
  判断标准: {
    headline: "补充清晰的判断标准",
    description: "这部分需要补充优秀、正常、较差的区间口径，以及不同阶段或不同规模下的判断差异。",
  },
  工具与模板: {
    headline: "补充可复用的工具模板",
    description: "这部分提到了提效或诊断方法，但还缺少可直接复用的表格、模板、SOP 或分析工具。",
  },
};

function hasChinese(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

function looksLikeEnglishModelCopy(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const asciiLetters = (trimmed.match(/[a-z]/gi) ?? []).length;
  const chineseChars = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return asciiLetters > chineseChars * 2;
}

function cleanChineseText(text?: string | null) {
  const trimmed = text?.trim();
  if (!trimmed) return "";
  return hasChinese(trimmed) && !looksLikeEnglishModelCopy(trimmed) ? trimmed : "";
}

function fieldCopy(fieldLabel?: string | null) {
  const label = fieldLabel?.trim();
  if (!label) return null;
  return FIELD_COPY[label] ?? null;
}

export function describeQualityIssueForOps(input: QualityIssueOpsCopyInput) {
  const byField = fieldCopy(input.fieldLabel);
  const chineseSummary = cleanChineseText(input.summary);
  const chineseReason = cleanChineseText(input.reason);
  const fieldLabel = input.fieldLabel?.trim();
  const fallbackHeadline = fieldLabel
    ? `补强“${fieldLabel}”`
    : "补充这段原文的关键信息";

  return {
    headline: chineseSummary || byField?.headline || fallbackHeadline,
    description:
      chineseReason ||
      byField?.description ||
      "这段原文还有可补充的信息，建议请专家说明更具体的判断依据、执行动作或可回写内容。",
    priorityLabel: input.severity === "high" ? "高优先级" : "待补强",
  };
}
