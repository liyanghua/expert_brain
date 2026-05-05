import { randomUUID } from "node:crypto";
import { metric } from "../observability/metrics.js";
import type { PipelineState, PlanApproval, StepMetric } from "../types.js";

export function runStep6Approval(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  if (!state.agent_plan_v0) throw new Error("Step 6 requires agent_plan_v0");
  const approvedPlan = structuredClone(state.agent_plan_v0);
  approvedPlan.status = "approved";
  approvedPlan.steps = approvedPlan.steps.map((step) => ({
    ...step,
    status: "pending",
  }));
  const approval: PlanApproval = {
    approval_id: randomUUID(),
    mode: "auto",
    approved_at: new Date().toISOString(),
    approved_step_ids: approvedPlan.steps.map((step) => step.step_id),
    rejected_steps: [],
    edited_steps_count: 0,
  };
  state.approved_agent_plan = approvedPlan;
  state.approval_log = approval;
  return {
    artifacts: {
      approval_log: approval,
      approved_agent_plan: approvedPlan,
    },
    metrics: {
      plan_approval_rate: metric(1, "proxy"),
      step_approval_rate: metric(1, "proxy"),
      edit_before_approval_rate: metric(0),
      rejection_reason_distribution: metric(0, "proxy"),
    },
  };
}
