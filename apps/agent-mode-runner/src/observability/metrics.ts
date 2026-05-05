import type { MeasurementStatus, StepMetric } from "../types.js";

export function metric(
  value: StepMetric["value"],
  measurement_status: MeasurementStatus = "measured",
  notes?: string,
): StepMetric {
  return { value, measurement_status, notes };
}

export function durationMetric(startedAt: number): StepMetric {
  return metric(Date.now() - startedAt, "measured");
}
