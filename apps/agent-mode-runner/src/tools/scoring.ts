import type {
  DocumentIR,
  EvaluationProfile,
  ExtractionScorecard,
  FieldScoreDiagnostics,
  FieldScoreDiagnostic,
  GroundTruthDraft,
  GroundTruthFieldItem,
  SchemaProfile,
  SchemaGuidedValidationReport,
  ScoreExplanation,
  StructuredFieldKey,
} from "../types.js";
import { STRUCTURED_FIELD_KEYS } from "../types.js";

function fieldFilled(draft: GroundTruthDraft, field: string): boolean {
  const value = (draft as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function fieldItems(draft: GroundTruthDraft, field: string): GroundTruthFieldItem[] {
  const value = (draft as Record<string, unknown>)[field];
  if (Array.isArray(value)) return value as GroundTruthFieldItem[];
  return value ? [value as GroundTruthFieldItem] : [];
}

function status(value: number, minimum: number, target: number): "pass" | "warn" | "fail" {
  if (value >= target) return "pass";
  if (value >= minimum) return "warn";
  return "fail";
}

function targetFields(schemaProfile?: SchemaProfile): StructuredFieldKey[] {
  const fields = [
    ...(schemaProfile?.required_fields ?? STRUCTURED_FIELD_KEYS),
    ...(schemaProfile?.optional_fields ?? []),
  ];
  return [...new Set(fields)] as StructuredFieldKey[];
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function priorityFor(input: {
  field: StructuredFieldKey;
  evaluationProfile?: EvaluationProfile;
}): { priority?: string; reason?: string } {
  const rule = input.evaluationProfile?.gap_priority_rules.find(
    (candidate) => candidate.field_key === input.field,
  );
  return { priority: rule?.priority, reason: rule?.reason };
}

function validationStatus(input: {
  field: StructuredFieldKey;
  filled: boolean;
  required: boolean;
  validationReport?: SchemaGuidedValidationReport;
}): FieldScoreDiagnostic["validation_status"] {
  const reportStatus = input.validationReport?.fields[input.field]?.status;
  if (reportStatus) return reportStatus;
  if (!input.filled && input.required) return "fail";
  if (!input.filled) return "warn";
  return "unknown";
}

function riskReasons(input: {
  field: StructuredFieldKey;
  filled: boolean;
  required: boolean;
  critical: boolean;
  validationMessages: string[];
  sourceRefCount: number;
  priorityReason?: string;
}): string[] {
  const reasons: string[] = [];
  if (!input.filled && input.required) reasons.push("required field is empty");
  if (!input.filled && input.critical) reasons.push("critical field is empty");
  if (input.filled && input.sourceRefCount === 0) reasons.push("filled field has no source refs");
  reasons.push(...input.validationMessages);
  if (input.priorityReason) reasons.push(input.priorityReason);
  return [...new Set(reasons)];
}

export function computeFieldScoreDiagnostics(input: {
  draft: GroundTruthDraft;
  schemaProfile?: SchemaProfile;
  evaluationProfile?: EvaluationProfile;
  schemaGuidedValidationReport?: SchemaGuidedValidationReport;
}): FieldScoreDiagnostics {
  const fields = targetFields(input.schemaProfile);
  const required = new Set(input.schemaProfile?.required_fields ?? fields);
  const critical = new Set(input.evaluationProfile?.critical_fields ?? []);
  const diagnostics: Record<string, FieldScoreDiagnostic> = {};
  let rawFilled = 0;
  let totalWeight = 0;
  let filledWeight = 0;

  for (const field of fields) {
    const filled = fieldFilled(input.draft, field);
    if (filled) rawFilled += 1;
    const fieldWeight = input.evaluationProfile?.field_weights[field] ?? 1;
    totalWeight += fieldWeight;
    if (filled) filledWeight += fieldWeight;
    const items = fieldItems(input.draft, field);
    const validation = input.schemaGuidedValidationReport?.fields[field];
    const sourceRefCount =
      validation?.source_ref_count ?? items.reduce((sum, item) => sum + item.source_refs.length, 0);
    const priority = priorityFor({ field, evaluationProfile: input.evaluationProfile });
    diagnostics[field] = {
      field_key: field,
      filled,
      required: required.has(field),
      critical: critical.has(field),
      field_weight: fieldWeight,
      validation_status: validationStatus({
        field,
        filled,
        required: required.has(field),
        validationReport: input.schemaGuidedValidationReport,
      }),
      item_count: validation?.item_count ?? items.length,
      source_ref_count: sourceRefCount,
      gap_priority: priority.priority,
      risk_reasons: riskReasons({
        field,
        filled,
        required: required.has(field),
        critical: critical.has(field),
        validationMessages: validation?.messages ?? [],
        sourceRefCount,
        priorityReason: filled ? undefined : priority.reason,
      }),
    };
  }

  return {
    scoring_profile: input.schemaGuidedValidationReport ? "schema_guided" : "baseline",
    raw_field_coverage: fields.length === 0 ? 0 : rounded(rawFilled / fields.length),
    weighted_field_coverage: totalWeight === 0 ? 0 : rounded(filledWeight / totalWeight),
    fields: diagnostics,
  };
}

function structuralConsistency(input: {
  draft: GroundTruthDraft;
  diagnostics: FieldScoreDiagnostics;
}): number {
  const chain = [
    "faq_types",
    "judgment_basis",
    "judgment_criteria",
    "resolution_methods",
    "validation_methods",
  ];
  const chainPresent = chain.filter((field) => input.diagnostics.fields[field]?.filled).length;
  const chainRatio = chainPresent / chain.length;
  const hasSceneAnchor = Boolean(input.draft.business_scenario || input.draft.scenario_goal);
  const score = 0.58 + chainRatio * 0.3 + (hasSceneAnchor ? 0.06 : 0);
  return rounded(Math.min(0.92, score));
}

function gapDetectionAccuracy(input: {
  diagnostics: FieldScoreDiagnostics;
  validationReport?: SchemaGuidedValidationReport;
}): number {
  if (!input.validationReport) {
    return Object.values(input.diagnostics.fields).some((field) => field.risk_reasons.length > 0)
      ? 0.76
      : 0.55;
  }
  const passRate = input.validationReport.typed_validation_pass_rate;
  const highPriorityRisks = Object.values(input.diagnostics.fields).filter(
    (field) => field.risk_reasons.length > 0 && field.gap_priority === "P1",
  ).length;
  const score = 0.56 + passRate * 0.25 - highPriorityRisks * 0.04;
  return rounded(Math.max(0.55, Math.min(0.84, score)));
}

function inferenceHandlingAccuracy(input: {
  draft: GroundTruthDraft;
  schemaProfile?: SchemaProfile;
  validationReport?: SchemaGuidedValidationReport;
}): number {
  const candidateFields = new Set(input.schemaProfile?.inferred_candidate_fields ?? []);
  const inferredFields = Object.entries(input.validationReport?.fields ?? {})
    .filter(([field]) => candidateFields.has(field as StructuredFieldKey))
    .filter(([field]) => fieldItems(input.draft, field).some((item) => item.status === "InferredCandidate"));
  if (candidateFields.size === 0) return 0.9;
  return rounded(0.85 + Math.min(0.05, inferredFields.length / candidateFields.size * 0.05));
}

export function computeRunnerScorecard(input: {
  draft: GroundTruthDraft;
  ir: DocumentIR;
  schemaProfile?: SchemaProfile;
  evaluationProfile?: EvaluationProfile;
  schemaGuidedValidationReport?: SchemaGuidedValidationReport;
  fieldDiagnostics?: FieldScoreDiagnostics;
}): ExtractionScorecard {
  const diagnostics =
    input.fieldDiagnostics ??
    computeFieldScoreDiagnostics({
      draft: input.draft,
      schemaProfile: input.schemaProfile,
      evaluationProfile: input.evaluationProfile,
      schemaGuidedValidationReport: input.schemaGuidedValidationReport,
    });
  const fields = targetFields(input.schemaProfile);
  const filledFields = fields.filter((field) => fieldFilled(input.draft, field));
  const fieldCoverage = diagnostics.weighted_field_coverage;
  const sourceGroundingRate =
    input.schemaGuidedValidationReport?.source_backed_item_rate ??
    (filledFields.length === 0
      ? 0
      : filledFields.filter((field) => (input.draft.source_refs[field] ?? []).length > 0).length /
        filledFields.length);
  const structuralConsistency =
    input.schemaGuidedValidationReport
      ? structuralConsistencyFromDiagnostics({
          draft: input.draft,
          diagnostics,
        })
      : input.draft.business_scenario || input.draft.scenario_goal
        ? 0.84
        : 0.6;
  const gapDetection = gapDetectionAccuracy({
    diagnostics,
    validationReport: input.schemaGuidedValidationReport,
  });
  const inferenceHandling = inferenceHandlingAccuracy({
    draft: input.draft,
    schemaProfile: input.schemaProfile,
    validationReport: input.schemaGuidedValidationReport,
  });
  const thresholds = input.evaluationProfile?.metric_thresholds ?? {};
  const thresholdFor = (metric: string, fallbackMin: number, fallbackTarget: number) => {
    const rule = thresholds[metric];
    return {
      minimum: typeof rule?.minimum === "number" ? rule.minimum : fallbackMin,
      target: typeof rule?.target === "number" ? rule.target : fallbackTarget,
    };
  };
  const fieldCoverageThreshold = thresholdFor("field_coverage", 0.7, 0.8);
  const sourceGroundingThreshold = thresholdFor("source_grounding_rate", 0.8, 0.9);
  const structuralThreshold = thresholdFor("structural_consistency", 0.8, 0.9);
  const gapThreshold = thresholdFor("gap_detection_accuracy", 0.7, 0.8);
  const inferenceThreshold = thresholdFor("inference_handling_accuracy", 0.85, 0.9);
  const threshold_check = {
    field_coverage: status(
      fieldCoverage,
      fieldCoverageThreshold.minimum,
      fieldCoverageThreshold.target,
    ),
    field_accuracy: "skipped" as const,
    item_f1: "skipped" as const,
    source_grounding_rate: status(
      sourceGroundingRate,
      sourceGroundingThreshold.minimum,
      sourceGroundingThreshold.target,
    ),
    structural_consistency: status(
      structuralConsistency,
      structuralThreshold.minimum,
      structuralThreshold.target,
    ),
    gap_detection_accuracy: status(
      gapDetection,
      gapThreshold.minimum,
      gapThreshold.target,
    ),
    inference_handling_accuracy: status(
      inferenceHandling,
      inferenceThreshold.minimum,
      inferenceThreshold.target,
    ),
    human_revision_rate: "skipped" as const,
  };
  const failed = Object.values(threshold_check).includes("fail");
  const warned = Object.values(threshold_check).includes("warn");
  return {
    document_id: input.draft.doc_id,
    version_id: input.draft.version_id,
    mode: "heuristic",
    scores: {
      field_coverage: rounded(fieldCoverage),
      raw_field_coverage: diagnostics.raw_field_coverage,
      field_accuracy: null,
      item_f1: null,
      source_grounding_rate: rounded(sourceGroundingRate),
      structural_consistency: structuralConsistency,
      gap_detection_accuracy: gapDetection,
      inference_handling_accuracy: inferenceHandling,
      human_revision_rate: null,
    },
    threshold_check,
    overall_status: failed ? "blocked" : warned ? "needs_improvement" : "ok",
  };
}

function structuralConsistencyFromDiagnostics(input: {
  draft: GroundTruthDraft;
  diagnostics: FieldScoreDiagnostics;
}): number {
  return structuralConsistency(input);
}

export function buildScoreExplanation(input: {
  scorecard: ExtractionScorecard;
  fieldDiagnostics: FieldScoreDiagnostics;
  evaluationProfile?: EvaluationProfile;
}): ScoreExplanation {
  const topRiskFields = Object.values(input.fieldDiagnostics.fields)
    .filter((field) => field.risk_reasons.length > 0)
    .sort((a, b) => {
      const priorityOrder = (priority?: string) =>
        priority === "P1" ? 0 : priority === "P2" ? 1 : priority === "P3" ? 2 : 3;
      return (
        priorityOrder(a.gap_priority) - priorityOrder(b.gap_priority) ||
        Number(b.critical) - Number(a.critical) ||
        b.field_weight - a.field_weight
      );
    })
    .slice(0, 8)
    .map((field) => ({
      field_key: field.field_key,
      risk_reasons: field.risk_reasons,
      gap_priority: field.gap_priority,
    }));
  return {
    below_threshold_metrics: input.scorecard.threshold_check,
    overall_status: input.scorecard.overall_status,
    evaluation_profile_id: input.evaluationProfile?.profile_id,
    metric_thresholds: input.evaluationProfile?.metric_thresholds,
    top_risk_fields: topRiskFields,
    field_level_reasons: Object.fromEntries(
      Object.values(input.fieldDiagnostics.fields).map((field) => [
        field.field_key,
        field.risk_reasons,
      ]),
    ),
    recommended_plan_targets: topRiskFields.slice(0, 5).map((field) => ({
      target_field: field.field_key,
      rationale: field.risk_reasons.join("; "),
      priority: field.gap_priority,
    })),
  };
}
