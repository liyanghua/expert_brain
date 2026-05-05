import {
  STRUCTURED_FIELD_KEYS,
  type EvaluationProfile,
  type ExpertGuidanceProfile,
  type SchemaProfile,
  type StructuredFieldKey,
} from "../../types.js";

export type SchemaGuidedFieldPlan = {
  field: StructuredFieldKey;
  fieldType?: string;
  required: boolean;
  cardinality: "single" | "list";
  inferenceMode: "explicit" | "candidate_allowed";
  guidance: string[];
  tablePreferred: boolean;
  priority: number;
};

const DEFAULT_SINGLE_FIELDS = new Set([
  "business_scenario",
  "scenario_goal",
  "process_flow_or_business_model",
]);

const TABLE_PREFERRED_FIELDS = new Set([
  "judgment_basis",
  "judgment_criteria",
  "validation_methods",
  "tool_templates",
]);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isListField(input: {
  field: StructuredFieldKey;
  fieldType?: string;
  evaluationProfile?: EvaluationProfile;
}): boolean {
  if (input.evaluationProfile?.list_fields.includes(input.field)) return true;
  if (input.evaluationProfile?.single_fields.includes(input.field)) return false;
  if (input.fieldType?.startsWith("list_")) return true;
  return !DEFAULT_SINGLE_FIELDS.has(input.field);
}

export function buildSchemaGuidedFieldPlan(input: {
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
  evaluationProfile?: EvaluationProfile;
}): SchemaGuidedFieldPlan[] {
  const configuredFields = unique([
    ...(input.schemaProfile?.required_fields ?? []),
    ...(input.schemaProfile?.optional_fields ?? []),
  ]);
  const fields = configuredFields.length > 0 ? configuredFields : [...STRUCTURED_FIELD_KEYS];
  const required = new Set(input.schemaProfile?.required_fields ?? fields);
  const inferred = new Set(input.schemaProfile?.inferred_candidate_fields ?? []);
  const critical = new Set(input.evaluationProfile?.critical_fields ?? []);
  return fields.map((field, index) => {
    const definition = input.schemaProfile?.field_definitions[field];
    const fieldType = definition?.type;
    return {
      field,
      fieldType,
      required: required.has(field),
      cardinality: isListField({
        field,
        fieldType,
        evaluationProfile: input.evaluationProfile,
      })
        ? "list"
        : "single",
      inferenceMode: inferred.has(field) ? "candidate_allowed" : "explicit",
      guidance: [
        definition?.description,
        definition?.extraction_hint,
        ...(input.expertGuidanceProfile?.field_guidance[field] ?? []),
      ].filter((item): item is string => Boolean(item)),
      tablePreferred: TABLE_PREFERRED_FIELDS.has(field),
      priority: (critical.has(field) ? 0 : 100) + (required.has(field) ? 10 : 50) + index,
    };
  });
}
