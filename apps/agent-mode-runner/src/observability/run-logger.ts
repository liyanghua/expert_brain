import type { PipelineStepRecord, StepMetric } from "../types.js";
import { getStepSpec } from "./pipeline-spec.js";

export class RunLogger {
  readonly steps: PipelineStepRecord[] = [];

  startStep(stepId: string): PipelineStepRecord {
    const spec = getStepSpec(stepId);
    const record: PipelineStepRecord = {
      step_id: stepId,
      name: spec.name,
      status: "running",
      started_at: new Date().toISOString(),
      artifacts: [],
      metrics: {},
    };
    this.steps.push(record);
    return record;
  }

  completeStep(
    record: PipelineStepRecord,
    input: {
      artifacts?: string[];
      metrics?: Record<string, StepMetric>;
      thresholdReport?: string;
    },
  ) {
    record.status = "completed";
    record.ended_at = new Date().toISOString();
    record.artifacts.push(...(input.artifacts ?? []));
    record.metrics = input.metrics ?? {};
    record.threshold_report = input.thresholdReport;
  }

  failStep(record: PipelineStepRecord, reason: string) {
    record.status = "failed";
    record.ended_at = new Date().toISOString();
    record.error_reason = reason;
  }
}
