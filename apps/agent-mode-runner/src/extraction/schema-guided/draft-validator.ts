import type {
  GroundTruthDraft,
  GroundTruthFieldItem,
  SchemaGuidedValidationField,
  SchemaGuidedValidationReport,
  StructuredFieldKey,
} from "../../types.js";
import type { SchemaGuidedFieldPlan } from "./field-plan.js";

function fieldItems(draft: GroundTruthDraft, field: StructuredFieldKey): GroundTruthFieldItem[] {
  const value = draft[field];
  if (Array.isArray(value)) return value;
  return value ? [value as GroundTruthFieldItem] : [];
}

function statusFor(input: {
  plan: SchemaGuidedFieldPlan;
  items: GroundTruthFieldItem[];
}): SchemaGuidedValidationField {
  const messages: string[] = [];
  if (input.items.length === 0) {
    messages.push(input.plan.required ? "required field has no grounded extraction" : "optional field has no grounded extraction");
  }
  if (input.plan.cardinality === "single" && input.items.length > 1) {
    messages.push("single field produced multiple items");
  }
  const sourceRefCount = input.items.reduce((sum, item) => sum + item.source_refs.length, 0);
  if (input.items.length > 0 && sourceRefCount === 0) {
    messages.push("extracted field has no source refs");
  }
  const hasInvalidInference =
    input.plan.inferenceMode === "candidate_allowed" &&
    input.items.some((item) => item.status !== "InferredCandidate");
  if (hasInvalidInference) {
    messages.push("candidate field must be marked InferredCandidate");
  }
  const status =
    messages.length === 0
      ? "pass"
      : input.plan.required || sourceRefCount === 0
        ? "fail"
        : "warn";
  return {
    status,
    messages,
    item_count: input.items.length,
    source_ref_count: sourceRefCount,
  };
}

export function validateSchemaGuidedDraft(input: {
  draft: GroundTruthDraft;
  plans: SchemaGuidedFieldPlan[];
  tableRowExtractionCount: number;
}): SchemaGuidedValidationReport {
  const fields: Record<string, SchemaGuidedValidationField> = {};
  let passCount = 0;
  let itemCount = 0;
  let sourceBackedItemCount = 0;
  let inferredFieldCount = 0;

  for (const plan of input.plans) {
    const items = fieldItems(input.draft, plan.field);
    const fieldReport = statusFor({ plan, items });
    fields[plan.field] = fieldReport;
    if (fieldReport.status === "pass") passCount += 1;
    itemCount += items.length;
    sourceBackedItemCount += items.filter((item) => item.source_refs.length > 0).length;
    if (items.some((item) => item.status === "InferredCandidate")) inferredFieldCount += 1;
  }

  const missingFields = input.plans
    .filter((plan) => fieldItems(input.draft, plan.field).length === 0 && fields[plan.field]?.status === "fail")
    .map((plan) => ({
      field_key: plan.field,
      message: "schema_guided 未找到 source-grounded 证据",
    }));
  const weakFields = input.plans
    .filter((plan) => fields[plan.field]?.status === "warn")
    .map((plan) => ({
      field_key: plan.field,
      message: fields[plan.field]?.messages.join("; "),
    }));
  const inferredFields = input.plans
    .filter((plan) => fieldItems(input.draft, plan.field).some((item) => item.status === "InferredCandidate"))
    .map((plan) => ({
      field_key: plan.field,
      message: "该字段按 profile 边界标记为 InferredCandidate",
    }));

  input.draft.gaps_structured = {
    missing_fields: missingFields,
    weak_fields: weakFields,
    inferred_fields: inferredFields,
    needs_confirmation_fields: inferredFields,
  };
  input.draft.gaps = [
    ...missingFields.map((gap) => ({
      field_key: gap.field_key,
      severity: "medium" as const,
      message: gap.message,
      suggested_action: "补充原文证据或请专家确认",
    })),
    ...weakFields.map((gap) => ({
      field_key: gap.field_key,
      severity: "low" as const,
      message: gap.message ?? "字段校验为 weak",
      suggested_action: "检查字段类型、source refs 或 candidate 状态",
    })),
  ];

  return {
    extraction_profile: "schema_guided",
    typed_validation_pass_rate:
      input.plans.length === 0 ? 0 : Number((passCount / input.plans.length).toFixed(4)),
    source_backed_item_rate:
      itemCount === 0 ? 0 : Number((sourceBackedItemCount / itemCount).toFixed(4)),
    inferred_field_count: inferredFieldCount,
    gap_count: input.draft.gaps.length,
    table_row_extraction_count: input.tableRowExtractionCount,
    fields,
  };
}
