import type { StructuredFieldKey } from "@ebs/ground-truth-schema";

export type QuestionGuidance = {
  fieldKey: StructuredFieldKey;
  label: string;
  examples: string[];
};

export const QUESTION_GUIDANCE_BY_FIELD = {
  business_scenario: {
    fieldKey: "business_scenario",
    label: "业务场景",
    examples: [
      "老师，您能先帮我们描述一下，这个经营策略通常发生在什么业务场景里吗？",
      "它在整个电商经营链路中大概处于哪个环节？",
    ],
  },
  scenario_goal: {
    fieldKey: "scenario_goal",
    label: "场景目标",
    examples: [
      "这个场景最核心想解决的问题是什么？",
      "这个场景与哪些经营环节有关联？",
    ],
  },
  required_inputs: {
    fieldKey: "required_inputs",
    label: "前置输入与依赖",
    examples: [
      "每个阶段通常需要哪些角色、系统后台或数据先准备好？",
      "执行前有哪些权限、资料或页面是一定要提前确认的？",
    ],
  },
  deliverables: {
    fieldKey: "deliverables",
    label: "输出成果",
    examples: [
      "这个场景最终会产出什么结果？通常以什么形式呈现？",
      "这些成果通常是给谁使用的？",
    ],
  },
  process_flow_or_business_model: {
    fieldKey: "process_flow_or_business_model",
    label: "流程或业务模型",
    examples: [
      "如果把这个场景完整走一遍，您通常会按照怎样的流程推进？",
      "这里面有没有长期沉淀下来的经营模型、判断框架或者固定方法论？",
      "哪些步骤是一定不能跳过的？",
    ],
  },
  thinking_framework: {
    fieldKey: "thinking_framework",
    label: "思考框架",
    examples: [
      "这里面有没有您长期沉淀下来的经营模型、判断框架或者固定方法论？",
      "新手最容易忽略、但实际上最体现经验价值的判断点是什么？",
    ],
  },
  execution_steps: {
    fieldKey: "execution_steps",
    label: "执行步骤",
    examples: [
      "能不能请您按照实际操作顺序，详细拆解一下每一步具体怎么做？",
      "每个阶段通常是什么角色负责？会用到哪些系统、后台或数据？",
      "在执行过程中，哪些动作看起来简单，但其实特别关键？",
    ],
  },
  execution_actions: {
    fieldKey: "execution_actions",
    label: "执行动作",
    examples: [
      "针对不同类型的问题，您通常会采取哪些处理办法？",
      "有没有一些是您踩过坑之后，才总结出来的高效解决办法？",
    ],
  },
  key_node_rationales: {
    fieldKey: "key_node_rationales",
    label: "关键节点判断理由",
    examples: [
      "您为什么会这样安排这个步骤？背后的业务逻辑或因果关系是什么？",
      "新手最容易忽略、但实际上最体现经验价值的判断点是什么？",
    ],
  },
  page_screenshots: {
    fieldKey: "page_screenshots",
    label: "页面截图或证据截图",
    examples: [
      "在实际操作时，每个操作步骤需要用到哪些后台页面？",
      "有没有一些页面字段或者数据，是您每次都会重点关注的？",
      "如果方便的话，能否结合页面说明一下，哪些地方最容易看错或漏掉？",
    ],
  },
  faq_types: {
    fieldKey: "faq_types",
    label: "常见问题类型",
    examples: [
      "在实际经营过程中，这个场景最常见的问题通常有哪些？",
      "这些问题更多是出在数据、流程、人员协同，还是策略判断上？",
      "有没有一些问题是表面看不出来，但经验丰富的人会提前发现的？",
    ],
  },
  judgment_basis: {
    fieldKey: "judgment_basis",
    label: "判断依据",
    examples: [
      "您通常通过哪些核心指标来判断这个场景做得好不好？",
      "除了结果指标，过程中有没有一些预警信号或关键观察点？",
      "除了这些指标外，有没有一些例外情况？",
    ],
  },
  judgment_criteria: {
    fieldKey: "judgment_criteria",
    label: "判断标准",
    examples: [
      "对于这些指标，您心里有没有相对的优秀、正常、较差的区间标准？",
      "不同阶段或者不同规模店铺，判断标准会有什么差异吗？",
      "您一般会拿什么做参考基准？比如行业平均、自身历史，还是竞品表现？",
    ],
  },
  resolution_methods: {
    fieldKey: "resolution_methods",
    label: "处理方法",
    examples: [
      "当发现问题后，您通常第一步会怎么判断原因？",
      "针对不同类型的问题，您通常会采取哪些处理办法？",
      "有没有一些踩过坑之后总结出的高效解决办法？",
    ],
  },
  trigger_conditions: {
    fieldKey: "trigger_conditions",
    label: "触发条件",
    examples: [
      "一般在什么情况下，您会启动这套经营或优化动作？",
      "有没有一些明确的边界条件，可以帮助团队判断是马上执行还是继续观察？",
    ],
  },
  termination_conditions: {
    fieldKey: "termination_conditions",
    label: "终止条件",
    examples: [
      "做到什么程度时，您会认为这个流程可以结束或者暂时停止？",
      "有没有一些边界条件，可以帮助团队避免过度操作？",
    ],
  },
  validation_methods: {
    fieldKey: "validation_methods",
    label: "验证方法",
    examples: [
      "您通常会怎么验证这套策略是真的有效，而不是短期波动？",
      "会重点观察哪些数据变化？一般观察周期多久比较合理？",
      "如果效果不明显，会如何处理？",
    ],
  },
  tool_templates: {
    fieldKey: "tool_templates",
    label: "工具与模板",
    examples: [
      "在这个场景中，有哪些长期复用或正在使用的表格、模板、SOP 或分析工具？",
      "这些工具里，哪个表单是您认为最关键的？",
      "如果让新人快速上手，您最推荐先掌握哪些工具或模板？",
    ],
  },
  exceptions_and_non_applicable_scope: {
    fieldKey: "exceptions_and_non_applicable_scope",
    label: "例外与不适用范围",
    examples: [
      "除了这些指标外，有没有一些例外情况？",
      "有没有一些明确的边界条件，可以帮助团队避免过度操作？",
      "哪些情况不适合套用这个流程，需要换一种处理方式？",
    ],
  },
} satisfies Record<StructuredFieldKey, QuestionGuidance>;

export function guidanceForField(
  fieldKey: string | null | undefined,
): QuestionGuidance | null {
  if (!fieldKey) return null;
  return (
    QUESTION_GUIDANCE_BY_FIELD[
      fieldKey as keyof typeof QUESTION_GUIDANCE_BY_FIELD
    ] ?? null
  );
}

export function guidanceForPrompt(
  fieldKey: string | null | undefined,
  limit = 3,
): string {
  const guidance = guidanceForField(fieldKey);
  if (!guidance) return "";
  return [
    `目标字段：${guidance.label}`,
    ...guidance.examples.slice(0, limit).map((example) => `- ${example}`),
  ].join("\n");
}

export function buildGuidedQuestionSeed(input: {
  fieldKey: string | null | undefined;
  seed?: string | null;
  gapReason?: string | null;
}): string {
  const guidance = guidanceForField(input.fieldKey);
  const seed = input.seed?.trim();
  const gap = input.gapReason?.trim();
  if (!guidance) {
    return [seed || "请结合当前证据补充专家判断。", gap]
      .filter(Boolean)
      .join(" ");
  }
  const lead = guidance.examples[0] ?? `请补充“${guidance.label}”的专家判断。`;
  const expertLead = lead.startsWith("老师") ? lead : `老师，${lead}`;
  return [
    expertLead,
    seed && !lead.includes(seed) ? `当前系统推荐追问是：${seed}` : "",
    gap ? `这次主要想补齐：${gap}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
