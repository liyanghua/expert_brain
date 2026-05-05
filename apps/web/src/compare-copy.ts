export type EvidenceOpsCopyInput = {
  blockType: string;
  blockTypeLabel?: string;
  text: string;
  targetFieldLabel?: string | null;
};

export type StructuredFieldOpsCopyInput = {
  fieldLabel: string;
  status: "covered" | "missing" | "weak_source" | "needs_confirmation";
  statusLabel: string;
  reason?: string | null;
  itemCount: number;
  sourceCount: number;
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  heading: "章节",
  paragraph: "正文",
  list: "清单",
  table: "表格",
  image: "图片",
  outline: "大纲",
};

function compactText(text: string, limit: number) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

export function describeEvidenceForOps(input: EvidenceOpsCopyInput) {
  const fieldLabel = input.targetFieldLabel?.trim();
  return {
    typeLabel:
      input.blockTypeLabel?.trim() ||
      BLOCK_TYPE_LABELS[input.blockType] ||
      input.blockType,
    excerpt: compactText(input.text, 180),
    usageHint: fieldLabel
      ? `可用于补充“${fieldLabel}”的判断依据或执行动作。`
      : "可用于判断这段原文能补充哪个结构化字段。",
    actionLabel: "用这段作为问答依据",
  };
}

export function describeStructuredFieldForOps(input: StructuredFieldOpsCopyInput) {
  const reason = input.reason?.trim();
  const gapSummary =
    reason ||
    (input.status === "covered"
      ? `已有 ${input.itemCount} 条内容，并关联 ${input.sourceCount} 个原文依据。`
      : "还缺少足够清晰、可追溯的结构化内容。");
  const headline =
    input.status === "covered"
      ? `“${input.fieldLabel}”已有初步内容`
      : input.status === "weak_source"
        ? `“${input.fieldLabel}”有内容，但缺少可靠出处`
        : input.status === "needs_confirmation"
          ? `“${input.fieldLabel}”需要专家确认`
          : `“${input.fieldLabel}”还没有可直接采用的内容`;

  return {
    headline,
    gapSummary,
    nextStep:
      input.status === "covered"
        ? "可以继续追问细节，或处理下一个优先任务。"
        : "建议先确认左侧原文依据，再让 Agent 生成可写入草稿的补充内容。",
    statusText: input.statusLabel,
  };
}
