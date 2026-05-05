import { metric } from "../observability/metrics.js";
import { resolvePlannerProviderConfig } from "../tools/key-config.js";
import type { AgentPlanGenerationTrace, PlannerProfile } from "../types.js";
import { parseAndValidateAgentPlan } from "./agent-plan-validator.js";
import { buildBaselinePlan } from "./baseline-planner.js";
import { buildLlmPlannerPrompt } from "./llm-planner-prompt.js";
import type { LlmCompletion, PlannerAdapter, PlannerAdapterInput } from "./planner-adapter.js";

async function defaultCompletion(input: {
  system: string;
  user: string;
  provider: Exclude<PlannerProfile, "baseline">;
}): Promise<string> {
  const mock = process.env.AGENT_MODE_RUNNER_LLM_PLANNER_MOCK_RESPONSE;
  if (mock != null) return mock;
  const config = resolvePlannerProviderConfig({ provider: input.provider });
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await fetch(`${config.base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      break;
    } catch (err) {
      lastError = err;
      if (attempt === 2) throw err;
    }
  }
  if (!response) {
    throw lastError instanceof Error ? lastError : new Error("Planner LLM request failed");
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Planner LLM HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Planner LLM returned empty content");
  return content;
}

function traceFor(input: {
  provider: Exclude<PlannerProfile, "baseline">;
  startedAt: number;
  promptChars: number;
  response?: string;
  fallbackReason?: string;
}): AgentPlanGenerationTrace {
  const config = resolvePlannerProviderConfig({ provider: input.provider });
  return {
    planner_profile: input.provider,
    planner_provider: input.provider,
    planner_version: "llm_planner.v1",
    model: config.safeSummary.model,
    base_host: config.safeSummary.baseHost,
    timeout_ms: config.safeSummary.timeoutMs,
    prompt_chars: input.promptChars,
    response_chars: input.response?.length ?? 0,
    duration_ms: Date.now() - input.startedAt,
    used_fallback: Boolean(input.fallbackReason),
    fallback_reason: input.fallbackReason,
    response_preview: input.response?.slice(0, 600),
  };
}

export function createLlmPlannerAdapter(
  provider: Exclude<PlannerProfile, "baseline">,
  completion: LlmCompletion = defaultCompletion,
): PlannerAdapter {
  return {
    profile: provider,
    async plan(input: PlannerAdapterInput) {
      const startedAt = Date.now();
      const baseline = buildBaselinePlan(input, provider);
      const prompt = buildLlmPlannerPrompt({ ...input, provider });
      const promptChars = prompt.system.length + prompt.user.length;
      let response = "";
      try {
        response = await completion({
          system: prompt.system,
          user: prompt.user,
          provider,
        });
        const plan = parseAndValidateAgentPlan(response);
        const trace = traceFor({ provider, startedAt, promptChars, response });
        const coveredMetrics = new Set(plan.steps.map((step) => step.target_metric));
        const coverage = {
          ...baseline.coverage,
          plan_step_count: plan.steps.length,
          evidence_block_ids: [...new Set(plan.steps.flatMap((step) => step.evidence_block_ids))],
          planner_profile: provider,
          target_metric_distribution: plan.steps.reduce<Record<string, number>>((acc, step) => {
            acc[step.target_metric] = (acc[step.target_metric] ?? 0) + 1;
            return acc;
          }, {}),
        };
        return {
          plan,
          coverage,
          metrics: {
            ...baseline.metrics,
            plan_coverage: metric(coveredMetrics.has("field_coverage") ? 0.9 : 0.75, "proxy"),
            plan_precision: metric(0.82, "proxy"),
            plan_actionability: metric(plan.steps.length > 0 ? 0.9 : 0),
            plan_generation_duration_ms: metric(trace.duration_ms),
            plan_step_count: metric(plan.steps.length),
            planner_fallback_count: metric(0),
          },
          extraArtifacts: {
            agent_plan_generation_trace: trace,
          },
        };
      } catch (err) {
        const fallbackReason = err instanceof Error ? err.message : String(err);
        const trace = traceFor({ provider, startedAt, promptChars, response, fallbackReason });
        return {
          ...baseline,
          coverage: {
            ...baseline.coverage,
            planner_profile: provider,
            planner_fallback_count: 1,
          },
          metrics: {
            ...baseline.metrics,
            planner_fallback_count: metric(1),
            plan_generation_duration_ms: metric(trace.duration_ms),
          },
          extraArtifacts: {
            agent_plan_generation_trace: trace,
          },
        };
      }
    },
  };
}
