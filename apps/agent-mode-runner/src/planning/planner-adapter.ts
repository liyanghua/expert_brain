import type {
  AgentPlan,
  AgentPlanGenerationTrace,
  DocumentIR,
  DocumentUnderstanding,
  EvaluationProfile,
  ExpertGuidanceProfile,
  ExtractionScorecard,
  FieldScoreDiagnostics,
  GroundTruthDraft,
  PlannerProfile,
  SchemaProfile,
  ScoreExplanation,
  SectionCard,
  StepMetric,
} from "../types.js";

export type PlannerCoverage = {
  plan_step_count: number;
  evidence_block_ids: string[];
  planning_guidance: string[];
  gap_priority_rules: EvaluationProfile["gap_priority_rules"];
  planner_profile: PlannerProfile;
  target_metric_distribution: Record<string, number>;
  top_risk_fields_covered_rate: number;
  planner_fallback_count: number;
};

export type PlannerAdapterInput = {
  plannerProfile: PlannerProfile;
  ir: DocumentIR;
  sectionCards: SectionCard[];
  draft: GroundTruthDraft;
  scorecard: ExtractionScorecard;
  documentUnderstanding?: DocumentUnderstanding;
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
  evaluationProfile?: EvaluationProfile;
  fieldDiagnostics?: FieldScoreDiagnostics;
  scoreExplanation?: ScoreExplanation;
};

export type PlannerAdapterResult = {
  plan: AgentPlan;
  coverage: PlannerCoverage;
  metrics: Record<string, StepMetric>;
  extraArtifacts?: {
    agent_plan_generation_trace?: AgentPlanGenerationTrace;
  };
};

export type PlannerAdapter = {
  profile: PlannerProfile;
  plan(input: PlannerAdapterInput): Promise<PlannerAdapterResult> | PlannerAdapterResult;
};

export type LlmCompletion = (input: {
  system: string;
  user: string;
  provider: Exclude<PlannerProfile, "baseline">;
}) => Promise<string>;
