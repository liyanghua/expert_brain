import { z } from "zod";

/** PRD §2.2 / §4.2 */
export const DocumentStatusSchema = z.enum([
  "Draft",
  "Extracted",
  "Under Review",
  "Revised",
  "Approved",
  "Published",
]);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const FieldCardStatusSchema = z.enum([
  "Missing",
  "Partial",
  "Drafted",
  "Confirmed",
  "InferredCandidate",
]);

export type FieldCardStatus = z.infer<typeof FieldCardStatusSchema>;

/** AGENTS §3.5 + PRD SuggestionCard */
export const SuggestionTypeSchema = z.enum([
  "rewrite",
  "add",
  "clarify",
  "split",
  "merge",
  "validation-needed",
  "delete",
  "question",
]);

export type SuggestionType = z.infer<typeof SuggestionTypeSchema>;

export const SuggestionStatusSchema = z.enum([
  "draft",
  "accepted",
  "rejected",
  "edited",
  "deferred",
]);

export type SuggestionStatus = z.infer<typeof SuggestionStatusSchema>;

export const SourceRefSchema = z.object({
  block_id: z.string().optional(),
  source_file: z.string().optional(),
  source_span: z.string().optional(),
  page_no: z.number().nullable().optional(),
  sheet_name: z.string().nullable().optional(),
  node_path: z.string().nullable().optional(),
  note: z.string().optional(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;

export const ExpertProfileSchema = z.object({
  expert_id: z.string().default("local-expert"),
  display_name: z.string().default("本地专家"),
  question_style: z.string().default("追问业务目标、判断依据、执行动作和验证标准"),
  focus_metrics: z.array(z.string()).default([]),
  preferred_terms: z.array(z.string()).default([]),
});

export type ExpertProfile = z.infer<typeof ExpertProfileSchema>;

export const ExpertMemorySchema = z.object({
  profile: ExpertProfileSchema.default({}),
  correction_summaries: z.array(z.string()).default([]),
  recent_questions: z.array(z.string()).default([]),
  updated_at: z.string().optional(),
});

export type ExpertMemory = z.infer<typeof ExpertMemorySchema>;

/** Structured field item with provenance (IR.md §2.6) */
export const GroundTruthFieldItemSchema = z.object({
  item_id: z.string().optional(),
  content: z.unknown(),
  status: FieldCardStatusSchema.default("Drafted"),
  confidence: z.number().min(0).max(1).optional(),
  source_refs: z.array(SourceRefSchema).default([]),
  notes: z.string().optional(),
});

export type GroundTruthFieldItem = z.infer<typeof GroundTruthFieldItemSchema>;

export const GapSchema = z.object({
  field_key: z.string(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  message: z.string(),
  suggested_action: z.string().optional(),
});

export type Gap = z.infer<typeof GapSchema>;

export const GapStructuredEntrySchema = z.object({
  field_key: z.string(),
  message: z.string().optional(),
});

export const GapsStructuredSchema = z.object({
  missing_fields: z.array(GapStructuredEntrySchema).default([]),
  weak_fields: z.array(GapStructuredEntrySchema).default([]),
  inferred_fields: z.array(GapStructuredEntrySchema).default([]),
  needs_confirmation_fields: z.array(GapStructuredEntrySchema).default([]),
});

export type GapsStructured = z.infer<typeof GapsStructuredSchema>;

export const DocumentMetaDraftSchema = z.object({
  document_id: z.string(),
  title: z.string().optional(),
  doc_type: z.string().optional(),
  domain: z.string().optional(),
  scene: z.string().optional(),
  source_files: z.array(z.string()).default([]),
  version: z.string().optional(),
  status: z.string().optional(),
});

export type DocumentMetaDraft = z.infer<typeof DocumentMetaDraftSchema>;

export const GlobalScoresSchema = z.object({
  completeness_score: z.number().min(0).max(1).optional(),
  extraction_confidence_score: z.number().min(0).max(1).optional(),
  grounding_score: z.number().min(0).max(1).optional(),
});

export type GlobalScores = z.infer<typeof GlobalScoresSchema>;

/** IR.md + PRD 全集：用于完整度与评测遍历 */
export const STRUCTURED_FIELD_KEYS = [
  "business_scenario",
  "scenario_goal",
  "required_inputs",
  "deliverables",
  "process_flow_or_business_model",
  "thinking_framework",
  "execution_steps",
  "execution_actions",
  "key_node_rationales",
  "page_screenshots",
  "faq_types",
  "judgment_basis",
  "judgment_criteria",
  "resolution_methods",
  "trigger_conditions",
  "termination_conditions",
  "validation_methods",
  "tool_templates",
  "exceptions_and_non_applicable_scope",
] as const;

/** @deprecated 使用 STRUCTURED_FIELD_KEYS；保留别名兼容旧引用 */
export const GROUND_TRUTH_FIELD_KEYS = STRUCTURED_FIELD_KEYS;

export type StructuredFieldKey = (typeof STRUCTURED_FIELD_KEYS)[number];
export type GroundTruthFieldKey = StructuredFieldKey;

export const GroundTruthDraftSchema = z.object({
  schema_name: z.literal("BusinessDocStructuredDraft").optional(),
  schema_version: z.string().optional(),
  doc_id: z.string().min(1),
  version_id: z.string().min(1),
  document_meta: DocumentMetaDraftSchema.optional(),
  business_scenario: GroundTruthFieldItemSchema.optional(),
  scenario_goal: GroundTruthFieldItemSchema.optional(),
  required_inputs: z.array(GroundTruthFieldItemSchema).default([]),
  deliverables: z.array(GroundTruthFieldItemSchema).default([]),
  process_flow_or_business_model: GroundTruthFieldItemSchema.optional(),
  thinking_framework: z.array(GroundTruthFieldItemSchema).default([]),
  execution_steps: z.array(GroundTruthFieldItemSchema).default([]),
  execution_actions: z.array(GroundTruthFieldItemSchema).default([]),
  key_node_rationales: z.array(GroundTruthFieldItemSchema).default([]),
  page_screenshots: z.array(GroundTruthFieldItemSchema).default([]),
  faq_types: z.array(GroundTruthFieldItemSchema).default([]),
  judgment_basis: z.array(GroundTruthFieldItemSchema).default([]),
  judgment_criteria: z.array(GroundTruthFieldItemSchema).default([]),
  resolution_methods: z.array(GroundTruthFieldItemSchema).default([]),
  trigger_conditions: z.array(GroundTruthFieldItemSchema).default([]),
  termination_conditions: z.array(GroundTruthFieldItemSchema).default([]),
  validation_methods: z.array(GroundTruthFieldItemSchema).default([]),
  tool_templates: z.array(GroundTruthFieldItemSchema).default([]),
  exceptions_and_non_applicable_scope: z.array(GroundTruthFieldItemSchema).default(
    [],
  ),
  gaps_structured: GapsStructuredSchema.optional(),
  global_scores: GlobalScoresSchema.optional(),
  gaps: z.array(GapSchema).default([]),
  confidence_by_field: z.record(z.number().min(0).max(1)).default({}),
  source_refs: z.record(z.array(SourceRefSchema)).default({}),
});

export type GroundTruthDraft = z.infer<typeof GroundTruthDraftSchema>;

export const SuggestionRecordSchema = z.object({
  suggestion_id: z.string().min(1),
  target_block_id: z.string(),
  target_field: z.string().nullable().optional(),
  suggestion_type: SuggestionTypeSchema,
  suggestion_text: z.string(),
  rationale: z.string(),
  source_refs: z.array(SourceRefSchema).default([]),
  status: SuggestionStatusSchema.default("draft"),
  confidence: z.number().min(0).max(1).optional(),
  created_at: z.string().datetime().optional(),
});

export type SuggestionRecord = z.infer<typeof SuggestionRecordSchema>;

export const VersionRecordSchema = z.object({
  version_id: z.string().min(1),
  parent_version_id: z.string().nullable(),
  doc_snapshot_path: z.string(),
  ground_truth_snapshot_path: z.string(),
  change_summary: z.string(),
  created_by: z.string(),
  created_at: z.string().datetime(),
});

export type VersionRecord = z.infer<typeof VersionRecordSchema>;

/** AGENTS §15.1 */
export const QAResponseSchema = z.object({
  direct_answer: z.string(),
  rationale: z.string(),
  source_block_refs: z.array(z.string()).default([]),
  next_step_suggestion: z.string().optional(),
  target_field: z.string().nullable().optional(),
  suggested_writeback: z
    .object({
      field_key: z.string(),
      content: z.unknown(),
    })
    .optional(),
});

export type QAResponse = z.infer<typeof QAResponseSchema>;

/** AGENTS §15.2 */
export const SuggestionResponseSchema = z.object({
  suggestion_type: SuggestionTypeSchema,
  target_block_id: z.string(),
  target_field: z.string().nullable(),
  suggested_text: z.string(),
  rationale: z.string(),
  action_options: z.array(z.string()),
});

export type SuggestionResponse = z.infer<typeof SuggestionResponseSchema>;

/** AGENTS §15.3 */
export const StructuringResponseSchema = z.object({
  extracted_fields: z.record(z.unknown()),
  confidence_by_field: z.record(z.number()),
  missing_fields: z.array(z.string()),
  source_references: z.record(z.array(SourceRefSchema)),
});

export type StructuringResponse = z.infer<typeof StructuringResponseSchema>;

/** AGENTS §15.4 */
export const VersionActionResponseSchema = z.object({
  new_version_id: z.string(),
  summary_of_changes: z.string(),
  affected_fields: z.array(z.string()),
  diff_available: z.boolean(),
});

export type VersionActionResponse = z.infer<typeof VersionActionResponseSchema>;

/** AGENTS §15.5 */
export const PublishReadinessResponseSchema = z.object({
  readiness_status: z.enum(["not_ready", "ready", "blocked"]),
  blocking_issues: z.array(z.string()),
  completeness_summary: z.record(z.number()),
  review_summary: z.string(),
});

export type PublishReadinessResponse = z.infer<
  typeof PublishReadinessResponseSchema
>;

export function emptyGroundTruthDraft(
  docId: string,
  versionId: string,
): GroundTruthDraft {
  return GroundTruthDraftSchema.parse({
    schema_name: "BusinessDocStructuredDraft",
    schema_version: "v1",
    doc_id: docId,
    version_id: versionId,
    document_meta: {
      document_id: docId,
      version: versionId,
      source_files: [],
    },
    required_inputs: [],
    deliverables: [],
    thinking_framework: [],
    execution_steps: [],
    execution_actions: [],
    key_node_rationales: [],
    page_screenshots: [],
    faq_types: [],
    judgment_basis: [],
    judgment_criteria: [],
    resolution_methods: [],
    trigger_conditions: [],
    termination_conditions: [],
    validation_methods: [],
    tool_templates: [],
    exceptions_and_non_applicable_scope: [],
    gaps_structured: {
      missing_fields: [],
      weak_fields: [],
      inferred_fields: [],
      needs_confirmation_fields: [],
    },
    gaps: [],
    confidence_by_field: {},
    source_refs: {},
  });
}
