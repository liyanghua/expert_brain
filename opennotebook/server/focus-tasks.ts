import { FIELD_DEFINITIONS_ZH, type GroundTruthDraft, type StructuredFieldKey } from "@ebs/ground-truth-schema";
import type { DocumentIR } from "@ebs/document-ir";
import { classifyTaskStatus, retrieveFieldEvidence, type NotebookRetrievalHit, type RetrievalIndexEntry } from "./retrieval.js";

export type NotebookFocusTask = {
  task_id: string;
  field_key: StructuredFieldKey;
  field_label: string;
  priority_score: number;
  status: "weak" | "missing";
  reason: string;
  recommended_question: string;
  evidence_block_ids: string[];
  evidence: NotebookRetrievalHit[];
};

type PriorityFieldConfig = {
  fieldKey: StructuredFieldKey;
  tier: "primary" | "secondary";
  weight: number;
};

const PRIORITY_FIELDS: PriorityFieldConfig[] = [
  { fieldKey: "execution_steps", tier: "primary", weight: 1 },
  { fieldKey: "judgment_basis", tier: "primary", weight: 0.96 },
  { fieldKey: "judgment_criteria", tier: "primary", weight: 0.95 },
  { fieldKey: "tool_templates", tier: "primary", weight: 0.92 },
  { fieldKey: "trigger_conditions", tier: "secondary", weight: 0.79 },
  { fieldKey: "termination_conditions", tier: "secondary", weight: 0.77 },
  { fieldKey: "resolution_methods", tier: "secondary", weight: 0.74 },
  { fieldKey: "validation_methods", tier: "secondary", weight: 0.71 },
];

const STATUS_WEIGHT = {
  missing: 1,
  weak: 0.72,
} as const;

function taskReason(input: {
  fieldKey: StructuredFieldKey;
  status: "weak" | "missing";
  evidence: NotebookRetrievalHit[];
}) {
  const label = FIELD_DEFINITIONS_ZH[input.fieldKey].label;
  if (input.status === "missing") {
    return `当前文档缺少可支撑“${label}”的有效证据，优先请专家直接补充。`;
  }
  const firstEvidence = input.evidence[0];
  return `文档中已出现与“${label}”相关的线索，但还不够完整。优先结合证据 ${firstEvidence?.block_id ?? "block"} 补强。`;
}

function recommendedQuestion(input: {
  fieldKey: StructuredFieldKey;
  status: "weak" | "missing";
}) {
  const label = FIELD_DEFINITIONS_ZH[input.fieldKey].label;
  if (input.status === "missing") {
    return `当前文档没有明确覆盖“${label}”，请专家直接补充可写回内容。`;
  }
  return `请结合已选证据，补充“${label}”中仍缺失的业务规则、步骤或模板。`;
}

export function buildNotebookFocusTasks(input: {
  ir: DocumentIR;
  draft: GroundTruthDraft;
  retrievalIndex: RetrievalIndexEntry[];
  limit?: number;
}): NotebookFocusTask[] {
  const limit = input.limit ?? 3;
  const tasks = PRIORITY_FIELDS.map((config) => {
    const evidence = retrieveFieldEvidence({
      index: input.retrievalIndex,
      fieldKey: config.fieldKey,
      limit: 3,
    });
    const status = classifyTaskStatus({
      fieldKey: config.fieldKey,
      draft: input.draft,
      evidence,
    });
    if (status === "covered") return null;
    const priority = Number((config.weight * STATUS_WEIGHT[status]).toFixed(4));
    return {
      task_id: `task-${config.fieldKey}`,
      field_key: config.fieldKey,
      field_label: FIELD_DEFINITIONS_ZH[config.fieldKey].label,
      priority_score: priority,
      status,
      reason: taskReason({ fieldKey: config.fieldKey, status, evidence }),
      recommended_question: recommendedQuestion({
        fieldKey: config.fieldKey,
        status,
      }),
      evidence_block_ids: evidence.map((item) => item.block_id),
      evidence,
      tier: config.tier,
      fieldOrder: PRIORITY_FIELDS.findIndex((item) => item.fieldKey === config.fieldKey),
    };
  })
    .filter(
      (
        task,
      ): task is NotebookFocusTask & {
        tier: "primary" | "secondary";
        fieldOrder: number;
      } => task !== null,
    )
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === "primary" ? -1 : 1;
      if (a.status !== b.status) {
        const order = { missing: 2, weak: 1 };
        return order[b.status] - order[a.status];
      }
      if (b.priority_score !== a.priority_score) {
        return b.priority_score - a.priority_score;
      }
      return a.fieldOrder - b.fieldOrder;
    })
    .slice(0, limit)
    .map(({ tier: _tier, fieldOrder: _fieldOrder, ...task }) => task);

  return tasks;
}
