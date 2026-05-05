import {
  STRUCTURED_FIELD_KEYS,
  type AgentPlan,
  type AgentPlanStep,
  type StructuredFieldKey,
} from "../types.js";

const ACTION_TYPES = new Set<AgentPlanStep["action_type"]>([
  "clarify_structure",
  "add_missing_field",
  "rewrite_section",
  "complete_list",
  "rebind_sources",
  "validate_inference",
  "request_expert_input",
]);

function jsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeActionType(value: unknown): AgentPlanStep["action_type"] {
  if (typeof value !== "string") throw new Error("action_type must be a string");
  if (ACTION_TYPES.has(value as AgentPlanStep["action_type"])) {
    return value as AgentPlanStep["action_type"];
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("rewrite") || value.includes("改写")) return "rewrite_section";
  if (normalized.includes("source") || normalized.includes("bind") || value.includes("来源")) {
    return "rebind_sources";
  }
  if (normalized.includes("validate") || value.includes("验证")) return "validate_inference";
  if (normalized.includes("clarify") || value.includes("澄清")) return "clarify_structure";
  if (normalized.includes("complete") || normalized.includes("completion") || value.includes("补全")) {
    return "complete_list";
  }
  if (normalized.includes("expert") || normalized.includes("confirm") || value.includes("专家")) {
    return "request_expert_input";
  }
  if (normalized.includes("add") || normalized.includes("missing") || value.includes("补")) {
    return "add_missing_field";
  }
  if (normalized.includes("extract")) return "add_missing_field";
  if (normalized.includes("field")) return "add_missing_field";
  return "add_missing_field";
}

function validateStep(value: unknown, index: number): AgentPlanStep {
  const step = requireObject(value, `steps[${index}]`);
  const targetField = step.target_field;
  if (
    typeof targetField !== "string" ||
    !STRUCTURED_FIELD_KEYS.includes(targetField as StructuredFieldKey)
  ) {
    throw new Error(`steps[${index}].target_field must be a valid structured field`);
  }
  const actionType = normalizeActionType(step.action_type);
  const evidence = step.evidence_block_ids;
  if (!Array.isArray(evidence) || !evidence.every((blockId) => typeof blockId === "string")) {
    throw new Error(`steps[${index}].evidence_block_ids must be string[]`);
  }
  for (const key of ["step_id", "title", "target_metric", "rationale", "expected_output"] as const) {
    if (typeof step[key] !== "string" || step[key] === "") {
      throw new Error(`steps[${index}].${key} must be a non-empty string`);
    }
  }
  const stepId = step.step_id as string;
  const title = step.title as string;
  const targetMetric = step.target_metric as string;
  const rationale = step.rationale as string;
  const expectedOutput = step.expected_output as string;
  return {
    step_id: stepId,
    title,
    target_metric: targetMetric,
    target_field: targetField as StructuredFieldKey,
    rationale,
    evidence_block_ids: evidence,
    action_type: actionType,
    expected_output: expectedOutput,
    status: "pending",
  };
}

export function parseAndValidateAgentPlan(text: string): AgentPlan {
  const raw = requireObject(jsonFromText(text), "AgentPlan");
  if (typeof raw.plan_id !== "string" || raw.plan_id === "") {
    throw new Error("plan_id must be a non-empty string");
  }
  if (typeof raw.goal !== "string" || raw.goal === "") {
    throw new Error("goal must be a non-empty string");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("steps must contain at least one item");
  }
  const steps = raw.steps
    .slice(0, 5)
    .flatMap((step, index) => {
      try {
        return [validateStep(step, index)];
      } catch {
        return [];
      }
    });
  if (steps.length === 0) throw new Error("steps must contain at least one valid item");
  const expected =
    raw.expected_improvement && typeof raw.expected_improvement === "object" && !Array.isArray(raw.expected_improvement)
      ? (raw.expected_improvement as Record<string, unknown>)
      : {};
  return {
    plan_id: raw.plan_id,
    goal: raw.goal,
    steps,
    expected_improvement: Object.fromEntries(
      Object.entries(expected).filter(([, value]) => typeof value === "number"),
    ) as Record<string, number>,
    status: "draft",
  };
}
