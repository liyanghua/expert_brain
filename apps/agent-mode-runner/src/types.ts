export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type MeasurementStatus = "measured" | "proxy" | "pending_gold";
export type ThresholdStatus = "pass" | "warn" | "fail" | "skipped";
export type ParserProfile = "builtin" | "marked" | "docling";
export type UnderstandingProfile = "baseline" | "profile_table" | "structured_context";
export type SemanticCoherenceProfile = "rules" | "embedding";
export type SemanticUnitEnhancementProfile = "rule" | "llm";
export type SemanticUnitMatchProfile = "rule" | "llm";
export type ExtractionProfile = "baseline" | "hinted" | "schema_guided";
export type PlannerProfile = "baseline" | "deepseek" | "qwen_plus";

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

export type StructuredFieldKey = (typeof STRUCTURED_FIELD_KEYS)[number];

export type DocumentBlock = {
  block_id: string;
  block_type: "heading" | "paragraph" | "list" | "table" | "image" | "outline";
  text_content: string;
  heading_level: number;
  source_file: string;
  source_span?: string;
  page_no?: number | null;
  sheet_name?: string | null;
  node_path?: string | null;
  attachment_refs: string[];
  parent_block_id?: string | null;
  children_block_ids: string[];
};

export type DocumentIR = {
  doc_id: string;
  version_id: string;
  blocks: DocumentBlock[];
};

export type SourceRef = {
  block_id?: string;
  source_file?: string;
  source_span?: string;
};

export type GroundTruthFieldItem = {
  item_id?: string;
  content: unknown;
  status: "Missing" | "Partial" | "Drafted" | "Confirmed" | "InferredCandidate";
  confidence?: number;
  source_refs: SourceRef[];
  notes?: string;
};

export type GroundTruthDraft = {
  schema_name?: "BusinessDocStructuredDraft";
  schema_version?: string;
  doc_id: string;
  version_id: string;
  document_meta?: {
    document_id: string;
    title?: string;
    source_files: string[];
    version?: string;
    scene?: string;
  };
  business_scenario?: GroundTruthFieldItem;
  scenario_goal?: GroundTruthFieldItem;
  process_flow_or_business_model?: GroundTruthFieldItem;
  required_inputs: GroundTruthFieldItem[];
  deliverables: GroundTruthFieldItem[];
  thinking_framework: GroundTruthFieldItem[];
  execution_steps: GroundTruthFieldItem[];
  execution_actions: GroundTruthFieldItem[];
  key_node_rationales: GroundTruthFieldItem[];
  page_screenshots: GroundTruthFieldItem[];
  faq_types: GroundTruthFieldItem[];
  judgment_basis: GroundTruthFieldItem[];
  judgment_criteria: GroundTruthFieldItem[];
  resolution_methods: GroundTruthFieldItem[];
  trigger_conditions: GroundTruthFieldItem[];
  termination_conditions: GroundTruthFieldItem[];
  validation_methods: GroundTruthFieldItem[];
  tool_templates: GroundTruthFieldItem[];
  exceptions_and_non_applicable_scope: GroundTruthFieldItem[];
  gaps_structured?: {
    missing_fields: { field_key: string; message?: string }[];
    weak_fields: { field_key: string; message?: string }[];
    inferred_fields: { field_key: string; message?: string }[];
    needs_confirmation_fields: { field_key: string; message?: string }[];
  };
  gaps: { field_key: string; severity: "low" | "medium" | "high"; message: string; suggested_action?: string }[];
  confidence_by_field: Record<string, number>;
  source_refs: Record<string, SourceRef[]>;
};

export type ExtractionScorecard = {
  document_id: string;
  version_id: string;
  mode: "heuristic" | "gold";
  scores: Record<string, number | null | undefined>;
  threshold_check?: Record<string, "pass" | "warn" | "fail" | "skipped">;
  overall_status: "ok" | "needs_improvement" | "blocked";
};

export type RunnerOptions = {
  input?: string;
  sceneId?: string;
  parseProfile?: ParserProfile;
  understandingProfile?: UnderstandingProfile;
  semanticCoherenceProfile?: SemanticCoherenceProfile;
  semanticUnitEnhancementProfile?: SemanticUnitEnhancementProfile;
  semanticUnitMatchProfile?: SemanticUnitMatchProfile;
  semanticUnitEvalReport?: boolean;
  extractionProfile?: ExtractionProfile;
  plannerProfile?: PlannerProfile;
  outputRoot?: string;
  runId?: string;
  approvalMode?: "auto" | "manual-json";
  approvalJson?: string;
  reviewMode?: "mock" | "manual-json";
  reviewJson?: string;
  toolProfile?: string;
};

export type StepMetric = {
  value: number | string | boolean | null;
  measurement_status: MeasurementStatus;
  notes?: string;
};

export type ThresholdRule = {
  target?: number | string;
  minimum?: number | string;
  target_max?: number;
  hard_max?: number;
};

export type ThresholdResult = {
  metric: string;
  value: StepMetric["value"];
  measurement_status: MeasurementStatus;
  status: ThresholdStatus;
  threshold?: ThresholdRule;
};

export type ThresholdReport = {
  step_id: string;
  overall_status: Exclude<ThresholdStatus, "skipped">;
  results: Record<string, ThresholdResult>;
  generated_at: string;
};

export type PipelineStepRecord = {
  step_id: string;
  name: string;
  status: StepStatus;
  started_at?: string;
  ended_at?: string;
  artifacts: string[];
  metrics: Record<string, StepMetric>;
  threshold_report?: string;
  error_reason?: string;
};

export type RunnerResult = {
  run_id: string;
  run_dir: string;
  status: "completed" | "failed";
  steps: PipelineStepRecord[];
  artifacts: string[];
};

export type SceneBinding = {
  scene_id: string;
  scene_name?: string;
  domain?: string;
  default_input_path?: string;
  schema_profile_version: string;
  expert_guidance_profile_version: string;
  evaluation_profile_version: string;
  selected_scene: string;
};

export type SceneDefinition = {
  scene_id: string;
  scene_name: string;
  domain: string;
  directory: string;
  default_input: string;
  schema_profile: string;
  expert_guidance_profile: string;
  evaluation_profile: string;
};

export type SceneRegistry = {
  version: string;
  default_scene_id: string;
  scenes: SceneDefinition[];
};

export type ProfileSourcePaths = {
  scene_dir: string;
  source_document: string;
  schema_profile: string;
  expert_guidance_profile: string;
  evaluation_profile: string;
};

export type FieldDefinition = {
  type?: string;
  required?: boolean;
  description?: string;
  extraction_hint?: string;
};

export type FieldBoundaryRule = {
  allowed_primary_roles?: BlockRole[];
  disallowed_primary_roles?: BlockRole[];
  required_any_signals?: string[];
  negative_signals?: string[];
  notes?: string;
};

export type SchemaProfile = {
  profile_id: string;
  profile_name?: string;
  scene?: string;
  domain?: string;
  version: string;
  required_fields: StructuredFieldKey[];
  optional_fields: StructuredFieldKey[];
  inferred_candidate_fields: StructuredFieldKey[];
  field_definitions: Partial<Record<StructuredFieldKey, FieldDefinition>>;
  field_boundary_rules?: Partial<Record<StructuredFieldKey, FieldBoundaryRule>>;
  normalization_rules: string[];
  output_requirements: string[];
};

export type ExpertGuidanceProfile = {
  profile_id: string;
  profile_name?: string;
  scene?: string;
  domain?: string;
  role?: string;
  version: string;
  field_guidance: Record<string, string[]>;
  extraction_guidance: string[];
  gap_detection_guidance: string[];
  planning_guidance: string[];
  inference_boundaries: string[];
  quality_preferences: string[];
};

export type GapPriorityRule = {
  priority: string;
  field_key?: StructuredFieldKey;
  reason: string;
};

export type EvaluationProfile = {
  profile_id: string;
  profile_name?: string;
  scene?: string;
  domain?: string;
  version: string;
  metrics: string[];
  metric_thresholds: Record<string, ThresholdRule>;
  field_weights: Record<string, number>;
  critical_fields: StructuredFieldKey[];
  list_fields: StructuredFieldKey[];
  single_fields: StructuredFieldKey[];
  hard_gates: { gate_id: string; description?: string; condition?: string }[];
  gap_priority_rules: GapPriorityRule[];
};

export type DocumentMapSection = {
  section_id: string;
  title: string;
  level: number;
  heading_block_id: string;
  block_ids: string[];
  start_index: number;
  end_index: number;
};

export type DocumentMap = {
  doc_id: string;
  version_id: string;
  total_blocks: number;
  sections: DocumentMapSection[];
  table_block_ids: string[];
  image_block_ids: string[];
  field_candidate_blocks: Record<string, string[]>;
};

export type StructuredSection = {
  section_id: string;
  title: string;
  heading_level: number;
  parent_section_id?: string | null;
  block_ids: string[];
  start_block_id: string;
  end_block_id: string;
  token_count: number;
  section_type:
    | "intro"
    | "preparation"
    | "framework"
    | "diagnosis"
    | "metrics"
    | "actions"
    | "validation"
    | "template"
    | "appendix";
  confidence: number;
};

export type StructuredSectionSummary = {
  section_id: string;
  title: string;
  section_type: StructuredSection["section_type"];
  main_purpose: string;
  key_points: string[];
  related_schema_fields: string[];
  extracted_signals: string[];
  likely_gaps: string[];
  source_block_ids: string[];
  confidence: number;
};

export type SectionCard = {
  section_id: string;
  title: string;
  source_block_ids: string[];
  summary: string;
  key_signals: string[];
  covered_schema_fields: string[];
  likely_gaps: string[];
  confidence: number;
};

export type FieldEvidenceHint = {
  block_ids: string[];
  signals: string[];
  reason: string;
};

export type SectionEvidenceHint = {
  section_id: string;
  title: string;
  source_block_ids: string[];
  table_block_ids: string[];
  list_block_ids: string[];
  field_evidence_hints: Record<string, FieldEvidenceHint>;
};

export type SectionEvidenceHints = {
  understanding_profile: UnderstandingProfile;
  field_signals: Record<string, string[]>;
  sections: SectionEvidenceHint[];
};

export type DocumentSynthesis = {
  document_theme: string;
  business_scene: string;
  primary_goal: string;
  process_spine: { section_id: string; role: string }[];
  key_signals: string[];
  likely_gaps: string[];
  quality_risks: string[];
  summary_for_agent: string;
  confidence: number;
};

export type ContextualizedBlock = {
  block_id: string;
  block_type: DocumentBlock["block_type"];
  text_content: string;
  block_summary?: string;
  semantic_unit_id?: string;
  semantic_unit_summary?: string;
  semantic_segment_id?: string;
  segment_summary?: string;
  segment_field_coverage?: {
    related_schema_fields: string[];
    missing_or_weak_fields: string[];
  };
  source_refs: SourceRef[];
  section_context: {
    section_id: string;
    section_title: string;
    section_type: StructuredSection["section_type"];
    section_main_purpose: string;
    section_key_points: string[];
  };
  document_context: {
    document_theme: string;
    business_scene: string;
    primary_goal: string;
    process_role: string;
  };
  extraction_context: {
    likely_related_schema_fields: string[];
    likely_signal_types: string[];
    likely_gap_hints: string[];
    inference_risk_level: "low" | "medium" | "high";
  };
};

export type ContinuityRelation = "continuation" | "elaboration" | "list_expansion" | "same_sentence";

export type ContinuityEdge = {
  from_block_id: string;
  to_block_id: string;
  relation: ContinuityRelation;
  signals: string[];
  confidence: number;
};

export type ContinuityDecision = ContinuityEdge & {
  should_merge: boolean;
  rule_score: number;
  embedding_similarity?: number;
  final_score: number;
  merge_reason: string;
};

export type ContinuityDecisionTrace = {
  semantic_coherence_profile: SemanticCoherenceProfile;
  decisions: ContinuityDecision[];
};

export type SemanticUnit = {
  unit_id: string;
  source_block_ids: string[];
  anchor_block_id: string;
  semantic_text: string;
  summary: string;
  unit_title?: string;
  llm_summary?: string;
  parent_heading?: string;
  schema_field_matches?: SemanticUnitSchemaFieldMatch[];
  continuity_edges: ContinuityEdge[];
  related_schema_fields: string[];
  missing_or_weak_fields: string[];
  confidence: number;
};

export type SemanticUnitSchemaMatchRelation = "primary" | "supporting" | "context" | "rejected";

export type SemanticUnitSchemaFieldMatch = {
  field_key: string;
  relation: SemanticUnitSchemaMatchRelation;
  score: number;
  reason: string;
  matched_signals: string[];
  source: "llm" | "rule" | "validator";
};

export type SemanticUnitLlmObservability = {
  status: "llm_generated" | "fallback_rule_based";
  model?: string;
  provider?: string;
  prompt?: { system: string; user: string };
  raw_response?: string;
  parsed_result?: unknown;
  fallback_reason?: string;
  unit_count: number;
};

export type SemanticUnitLlmEnhancementArtifact = {
  enhancement_profile: SemanticUnitEnhancementProfile;
  match_profile: SemanticUnitMatchProfile;
  generated_at: string;
  units: SemanticUnit[];
  observability: SemanticUnitLlmObservability;
};

export type SemanticUnitMatchValidationReport = {
  validation_profile: "semantic_unit_match_validator.v0";
  validation_pass_rate: number;
  fallback_count: number;
  demoted_field_count: number;
  diagnostics: {
    unit_id: string;
    messages: string[];
  }[];
};

export type SemanticUnitEvaluationReport = {
  generated_at: string;
  metric_notes: string;
  metrics: Record<string, number>;
  semantic_navigation_score: number;
  baseline: {
    unit_count: number;
    over_tag_rate: number;
    heading_overuse_rate: number;
  };
  enhanced: {
    unit_count: number;
    over_tag_rate: number;
    heading_overuse_rate: number;
  };
  examples: {
    unit_id: string;
    title?: string;
    summary: string;
    primary_fields: string[];
    supporting_fields: string[];
    context_fields: string[];
    rejected_fields: string[];
  }[];
};

export type SemanticSegment = {
  segment_id: string;
  title?: string;
  summary: string;
  source_block_ids: string[];
  semantic_unit_ids?: string[];
  anchor_block_id: string;
  primary_role: BlockRole;
  related_schema_fields: string[];
  missing_or_weak_fields: string[];
  coherence_reason: string;
  confidence: number;
};

export type BlockRole =
  | "overview_statement"
  | "business_definition"
  | "process_model"
  | "metric_basis"
  | "diagnosis_issue"
  | "action_method"
  | "validation_rule"
  | "boundary_condition"
  | "supporting_detail"
  | "unknown";

export type BlockRoleEntry = {
  block_id: string;
  primary_role: BlockRole;
  primary_label: string;
  secondary_roles: BlockRole[];
  compatible_fields: StructuredFieldKey[];
  excluded_primary_fields: StructuredFieldKey[];
  confidence: number;
  reason: string;
};

export type BlockRoleMap = {
  understanding_profile: "structured_context";
  blocks: Record<string, BlockRoleEntry>;
};

export type ExtractionEvidenceTrace = {
  extraction_profile: ExtractionProfile;
  fields: Record<
    string,
    {
      block_ids: string[];
      signals: string[];
      table_backed: boolean;
      extraction_method: string;
      confidence: number;
      fallback_reason?: string;
    }
  >;
};

export type SchemaGuidedFieldEvidence = {
  field: string;
  field_type?: string;
  candidate_block_ids: string[];
  selected_block_ids: string[];
  scored_candidates?: {
    block_id: string;
    score: number;
    signal_score: number;
    role_score: number;
    section_score: number;
    segment_score?: number;
    boundary_penalty: number;
    global_fit_score: number;
    matched_signals: string[];
    primary_role?: BlockRole;
    rejected?: boolean;
    reject_reasons?: string[];
  }[];
  signals: string[];
  semantic_unit_ids?: string[];
  selected_semantic_unit_id?: string;
  semantic_segment_ids?: string[];
  selected_semantic_segment_id?: string;
  source_grounded: boolean;
  table_backed: boolean;
  selection_reason: string;
};

export type SchemaGuidedEvidenceMap = {
  extraction_profile: "schema_guided";
  fields: Record<string, SchemaGuidedFieldEvidence>;
};

export type SchemaGuidedTraceField = {
  field: string;
  field_type?: string;
  selected_block_ids: string[];
  extraction_method: string;
  item_count: number;
  status: GroundTruthFieldItem["status"] | "Missing";
  validation_status: "pass" | "warn" | "fail";
  confidence: number;
  fallback_reason?: string;
};

export type SchemaGuidedExtractionTrace = {
  extraction_profile: "schema_guided";
  fields: Record<string, SchemaGuidedTraceField>;
};

export type SchemaGuidedValidationField = {
  status: "pass" | "warn" | "fail";
  messages: string[];
  item_count: number;
  source_ref_count: number;
};

export type SchemaGuidedValidationReport = {
  extraction_profile: "schema_guided";
  typed_validation_pass_rate: number;
  source_backed_item_rate: number;
  inferred_field_count: number;
  gap_count: number;
  table_row_extraction_count: number;
  fields: Record<string, SchemaGuidedValidationField>;
};

export type FieldScoreDiagnostic = {
  field_key: string;
  filled: boolean;
  required: boolean;
  critical: boolean;
  field_weight: number;
  validation_status: "pass" | "warn" | "fail" | "unknown";
  item_count: number;
  source_ref_count: number;
  gap_priority?: string;
  risk_reasons: string[];
};

export type FieldScoreDiagnostics = {
  scoring_profile: "baseline" | "schema_guided";
  raw_field_coverage: number;
  weighted_field_coverage: number;
  fields: Record<string, FieldScoreDiagnostic>;
};

export type ScoreExplanation = {
  below_threshold_metrics: ExtractionScorecard["threshold_check"];
  overall_status: ExtractionScorecard["overall_status"];
  evaluation_profile_id?: string;
  metric_thresholds?: EvaluationProfile["metric_thresholds"];
  top_risk_fields: {
    field_key: string;
    risk_reasons: string[];
    gap_priority?: string;
  }[];
  field_level_reasons: Record<string, string[]>;
  recommended_plan_targets: {
    target_field: string;
    rationale: string;
    priority?: string;
  }[];
};

export type AgentPlanGenerationTrace = {
  planner_profile: PlannerProfile;
  planner_provider: PlannerProfile;
  planner_version: string;
  model?: string;
  base_host?: string;
  timeout_ms?: number;
  prompt_chars?: number;
  response_chars?: number;
  duration_ms: number;
  used_fallback: boolean;
  fallback_reason?: string;
  response_preview?: string;
};

export type DocumentUnderstanding = {
  document_theme: string;
  business_scene: string;
  primary_goal: string;
  section_summaries: SectionCard[];
  key_signals: string[];
  likely_gaps: string[];
  process_spine?: DocumentSynthesis["process_spine"];
  quality_risks?: string[];
  summary_for_agent?: string;
  confidence: number;
};

export type ContextCoverage = {
  total_blocks: number;
  scanned_blocks: number;
  cited_blocks: string[];
  covered_sections: string[];
  uncovered_sections: string[];
  risk: "low" | "medium" | "high";
};

export type AgentPlanStep = {
  step_id: string;
  title: string;
  target_metric: string;
  target_field?: StructuredFieldKey;
  rationale: string;
  evidence_block_ids: string[];
  action_type:
    | "clarify_structure"
    | "add_missing_field"
    | "rewrite_section"
    | "complete_list"
    | "rebind_sources"
    | "validate_inference"
    | "request_expert_input";
  expected_output: string;
  status: StepStatus;
};

export type AgentPlan = {
  plan_id: string;
  goal: string;
  steps: AgentPlanStep[];
  expected_improvement: Record<string, number>;
  status: "draft" | "approved" | "running" | "completed";
};

export type PlanApproval = {
  approval_id: string;
  mode: "auto" | "manual-json";
  approved_at: string;
  approved_step_ids: string[];
  rejected_steps: { step_id: string; reason: string }[];
  edited_steps_count: number;
};

export type StepOutput = {
  step_id: string;
  status: StepStatus;
  candidate_item?: GroundTruthFieldItem;
  changed_fields: string[];
  source_backed: boolean;
  inference_overreach: boolean;
};

export type ScoreDelta = {
  score_delta_by_metric: Record<string, number | null>;
  improved_fields_count: number;
  regressed_fields_count: number;
  net_quality_gain: number;
};

export type ExpertReview = {
  overall_score: number;
  dimension_scores: {
    completeness: number;
    accuracy: number;
    clarity: number;
    actionability: number;
    traceability: number;
  };
  comments: string;
  accepted_final_version: boolean;
};

export type PipelineState = {
  run_id: string;
  run_dir: string;
  input_path: string;
  input_was_explicit?: boolean;
  parse_profile?: ParserProfile;
  understanding_profile?: UnderstandingProfile;
  semantic_coherence_profile?: SemanticCoherenceProfile;
  semantic_unit_enhancement_profile?: SemanticUnitEnhancementProfile;
  semantic_unit_match_profile?: SemanticUnitMatchProfile;
  semantic_unit_eval_report?: boolean;
  extraction_profile?: ExtractionProfile;
  planner_profile?: PlannerProfile;
  scene_id?: string;
  scene_definition?: SceneDefinition;
  scene_registry?: SceneRegistry;
  profile_source_paths?: ProfileSourcePaths;
  scene_binding?: SceneBinding;
  schema_profile?: SchemaProfile;
  expert_guidance_profile?: ExpertGuidanceProfile;
  evaluation_profile?: EvaluationProfile;
  document_ir?: DocumentIR;
  document_map?: DocumentMap;
  section_cards?: SectionCard[];
  structured_sections?: StructuredSection[];
  structured_section_summaries?: StructuredSectionSummary[];
  document_synthesis?: DocumentSynthesis;
  contextualized_blocks?: ContextualizedBlock[];
  semantic_units?: SemanticUnit[];
  continuity_decision_trace?: ContinuityDecisionTrace;
  semantic_segments?: SemanticSegment[];
  block_role_map?: BlockRoleMap;
  section_evidence_hints?: SectionEvidenceHints;
  document_understanding?: DocumentUnderstanding;
  structured_draft_v0?: GroundTruthDraft;
  schema_guided_validation_report?: SchemaGuidedValidationReport;
  schema_guided_evidence_map?: SchemaGuidedEvidenceMap;
  schema_guided_extraction_trace?: SchemaGuidedExtractionTrace;
  scorecard_v0?: ExtractionScorecard;
  field_score_diagnostics_v0?: FieldScoreDiagnostics;
  score_explanation_v0?: ScoreExplanation;
  agent_plan_generation_trace?: AgentPlanGenerationTrace;
  agent_plan_v0?: AgentPlan;
  approved_agent_plan?: AgentPlan;
  approval_log?: PlanApproval;
  structured_draft_candidate_v1?: GroundTruthDraft;
  structured_draft_v1?: GroundTruthDraft;
  scorecard_v1?: ExtractionScorecard;
  score_delta?: ScoreDelta;
  expert_review?: ExpertReview;
};
