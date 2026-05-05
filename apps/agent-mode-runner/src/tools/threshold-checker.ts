import type {
  StepMetric,
  ThresholdReport,
  ThresholdResult,
  ThresholdRule,
  ThresholdStatus,
} from "../types.js";
import { getStepSpec } from "../observability/pipeline-spec.js";

function evaluateNumeric(value: number, threshold?: ThresholdRule): ThresholdStatus {
  if (!threshold) return "skipped";
  if (threshold.hard_max != null || threshold.target_max != null) {
    const hardMax = threshold.hard_max ?? threshold.target_max;
    const targetMax = threshold.target_max ?? hardMax;
    if (hardMax == null || targetMax == null) return "skipped";
    if (value <= targetMax) return "pass";
    if (value <= hardMax) return "warn";
    return "fail";
  }
  if (typeof threshold.target === "number" || typeof threshold.minimum === "number") {
    const target =
      typeof threshold.target === "number"
        ? threshold.target
        : typeof threshold.minimum === "number"
          ? threshold.minimum
          : undefined;
    const minimum =
      typeof threshold.minimum === "number"
        ? threshold.minimum
        : typeof threshold.target === "number"
          ? threshold.target
          : undefined;
    if (target == null || minimum == null) return "skipped";
    if (value >= target) return "pass";
    if (value >= minimum) return "warn";
    return "fail";
  }
  if (threshold.minimum === "non_negative") {
    return value > 0 ? "pass" : value >= 0 ? "warn" : "fail";
  }
  return "skipped";
}

function evaluateMetric(metric: string, value: StepMetric, rule?: ThresholdRule): ThresholdResult {
  const status =
    typeof value.value === "number" ? evaluateNumeric(value.value, rule) : "skipped";
  return {
    metric,
    value: value.value,
    measurement_status: value.measurement_status,
    status,
    threshold: rule,
  };
}

export function checkThresholds(input: {
  stepId: string;
  metrics: Record<string, StepMetric>;
}): ThresholdReport {
  const spec = getStepSpec(input.stepId);
  const results: Record<string, ThresholdResult> = {};
  for (const [metric, value] of Object.entries(input.metrics)) {
    results[metric] = evaluateMetric(metric, value, spec.metrics[metric]);
  }
  const statuses = Object.values(results).map((result) => result.status);
  const overall_status =
    statuses.includes("fail") ? "fail" : statuses.includes("warn") ? "warn" : "pass";
  return {
    step_id: input.stepId,
    overall_status,
    results,
    generated_at: new Date().toISOString(),
  };
}
