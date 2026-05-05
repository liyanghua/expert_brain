import { randomUUID } from "node:crypto";
import { metric } from "../observability/metrics.js";
import { selectEvidenceForField } from "../tools/evidence-selector.js";
import {
  STRUCTURED_FIELD_KEYS,
  type AgentPlan,
  type AgentPlanStep,
  type PlannerProfile,
  type StepMetric,
  type StructuredFieldKey,
} from "../types.js";
import type { PlannerAdapter, PlannerAdapterInput, PlannerCoverage } from "./planner-adapter.js";

function missingFields(input: PlannerAdapterInput): StructuredFieldKey[] {
  const targetFields = [
    ...(input.schemaProfile?.required_fields ?? STRUCTURED_FIELD_KEYS),
    ...(input.schemaProfile?.optional_fields ?? []),
  ];
  return [...new Set(targetFields)].filter((field) => {
    const value = input.draft[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
}

function planPriorityFields(input: PlannerAdapterInput): StructuredFieldKey[] {
  const fromScoreExplanation =
    input.scoreExplanation?.recommended_plan_targets
      .map((target) => target.target_field)
      .filter((field): field is StructuredFieldKey =>
        STRUCTURED_FIELD_KEYS.includes(field as StructuredFieldKey),
      ) ?? [];
  const fromFieldDiagnostics = Object.values(input.fieldDiagnostics?.fields ?? {})
    .filter((field) => field.risk_reasons.length > 0)
    .map((field) => field.field_key)
    .filter((field): field is StructuredFieldKey =>
      STRUCTURED_FIELD_KEYS.includes(field as StructuredFieldKey),
    );
  const fromEval =
    input.evaluationProfile?.gap_priority_rules
      .map((rule) => rule.field_key)
      .filter((field): field is StructuredFieldKey => Boolean(field)) ?? [];
  const fromGuidance =
    input.expertGuidanceProfile?.planning_guidance
      .map((line) => STRUCTURED_FIELD_KEYS.find((field) => line.includes(field)))
      .filter((field): field is StructuredFieldKey => Boolean(field)) ?? [];
  return [...new Set([...fromScoreExplanation, ...fromFieldDiagnostics, ...fromEval, ...fromGuidance])];
}

function guidanceForField(input: PlannerAdapterInput, field: StructuredFieldKey): string {
  const recommended = input.scoreExplanation?.recommended_plan_targets.find(
    (target) => target.target_field === field,
  )?.rationale;
  if (recommended) return recommended;
  const reasons = input.fieldDiagnostics?.fields[field]?.risk_reasons ?? [];
  if (reasons.length > 0) return reasons.join("；");
  return (
    input.expertGuidanceProfile?.planning_guidance.find((line) => line.includes(field)) ??
    `当前 ${field} 覆盖不足，需要基于局部证据补强。`
  );
}

function buildTargetFields(input: PlannerAdapterInput): StructuredFieldKey[] {
  const fallbackFields: StructuredFieldKey[] = [
    "execution_steps",
    "judgment_basis",
    "judgment_criteria",
  ];
  return [...new Set([...planPriorityFields(input), ...missingFields(input), ...fallbackFields])].slice(0, 5);
}

function targetMetricDistribution(steps: AgentPlanStep[]): Record<string, number> {
  return steps.reduce<Record<string, number>>((acc, step) => {
    acc[step.target_metric] = (acc[step.target_metric] ?? 0) + 1;
    return acc;
  }, {});
}

function riskCoverage(input: PlannerAdapterInput, steps: AgentPlanStep[]): number {
  const topRiskFields = input.scoreExplanation?.top_risk_fields.map((field) => field.field_key) ?? [];
  if (topRiskFields.length === 0) return 1;
  const covered = topRiskFields.filter((field) =>
    steps.some((step) => step.target_field === field),
  ).length;
  return Number((covered / topRiskFields.length).toFixed(4));
}

export function buildBaselinePlan(input: PlannerAdapterInput, plannerProfile: PlannerProfile = "baseline"): {
  plan: AgentPlan;
  coverage: PlannerCoverage;
  metrics: Record<string, StepMetric>;
} {
  const targetFields = buildTargetFields(input);
  const steps: AgentPlanStep[] = targetFields.map((field, index) => {
    const evidence = selectEvidenceForField({
      fieldKey: field,
      sectionCards: input.sectionCards,
      totalBlockCount: input.ir.blocks.length,
    });
    return {
      step_id: `plan_step_${index + 1}`,
      title: `补强 ${field}`,
      target_metric: "field_coverage",
      target_field: field,
      rationale: guidanceForField(input, field),
      evidence_block_ids: evidence.block_ids,
      action_type: "add_missing_field",
      expected_output: `按照 ${input.schemaProfile?.profile_id ?? "default_schema"} 生成 ${field} 的候选补充内容并绑定来源。`,
      status: "pending",
    };
  });
  const plan: AgentPlan = {
    plan_id: randomUUID(),
    goal: "按低分指标补强结构化业务文档",
    steps,
    expected_improvement: {
      field_coverage: Number(
        (
          steps.length /
          (input.schemaProfile?.required_fields.length ?? STRUCTURED_FIELD_KEYS.length)
        ).toFixed(4),
      ),
      source_grounding_rate: 0.1,
    },
    status: "draft",
  };
  const coveredMetrics = new Set(steps.map((step) => step.target_metric));
  const coverage: PlannerCoverage = {
    plan_step_count: steps.length,
    evidence_block_ids: [...new Set(steps.flatMap((step) => step.evidence_block_ids))],
    planning_guidance: input.expertGuidanceProfile?.planning_guidance ?? [],
    gap_priority_rules: input.evaluationProfile?.gap_priority_rules ?? [],
    planner_profile: plannerProfile,
    target_metric_distribution: targetMetricDistribution(steps),
    top_risk_fields_covered_rate: riskCoverage(input, steps),
    planner_fallback_count: 0,
  };
  return {
    plan,
    coverage,
    metrics: {
      plan_coverage: metric(coveredMetrics.has("field_coverage") ? 0.9 : 0.5, "proxy"),
      plan_precision: metric(0.8, "proxy"),
      plan_actionability: metric(steps.length > 0 ? 0.9 : 0),
      expected_score_gain_quality: metric(0.75, "proxy"),
      plan_acceptance_rate: metric(1, "proxy"),
      plan_generation_duration_ms: metric(0),
      plan_step_count: metric(steps.length),
      top_risk_fields_covered_rate: metric(coverage.top_risk_fields_covered_rate, "proxy"),
      planner_fallback_count: metric(0),
    },
  };
}

export const baselinePlannerAdapter: PlannerAdapter = {
  profile: "baseline",
  plan(input) {
    return buildBaselinePlan(input, "baseline");
  },
};
