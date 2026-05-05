import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { ArtifactRegistry } from "./observability/artifact-registry.js";
import { PIPELINE_SPEC_SOURCE, PIPELINE_STEP_ORDER } from "./observability/pipeline-spec.js";
import { RunLogger } from "./observability/run-logger.js";
import { checkThresholds } from "./tools/threshold-checker.js";
import { resolveToolProfile } from "./tools/tool-registry.js";
import { runStep0Profile } from "./steps/step0-profile.js";
import { runStep1Parse } from "./steps/step1-parse.js";
import { runStep2Understanding } from "./steps/step2-understanding.js";
import { runStep3Structuring } from "./steps/step3-structuring.js";
import { runStep4Scorecard } from "./steps/step4-scorecard.js";
import { runStep5Plan } from "./steps/step5-plan.js";
import { runStep6Approval } from "./steps/step6-approval.js";
import { runStep7Execute } from "./steps/step7-execute.js";
import { runStep8Rescore } from "./steps/step8-rescore.js";
import { runStep9Review } from "./steps/step9-review.js";
import type {
  PipelineState,
  RunnerOptions,
  RunnerResult,
  StepMetric,
} from "./types.js";

type StepRunner = (
  state: PipelineState,
) => Promise<{ artifacts: Record<string, unknown>; metrics: Record<string, StepMetric> }> | {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
};

const STEP_RUNNERS: Record<string, StepRunner> = {
  step_0_scene_registration: runStep0Profile,
  step_1_parse_normalize: runStep1Parse,
  step_2_hierarchical_understanding: runStep2Understanding,
  step_3_structured_extraction: runStep3Structuring,
  step_4_initial_scoring: runStep4Scorecard,
  step_5_agent_plan_generation: runStep5Plan,
  step_6_expert_approval: runStep6Approval,
  step_7_stepwise_improvement_run: runStep7Execute,
  step_8_reextract_rescore: runStep8Rescore,
  step_9_expert_review_feedback: runStep9Review,
};

function artifactName(key: string): string {
  return key.endsWith(".json") ? key : `${key}.json`;
}

function thresholdName(stepId: string): string {
  const match = /^step_(\d+)/.exec(stepId);
  return `threshold_report.step_${match?.[1] ?? stepId}.json`;
}

async function runOneStep(input: {
  stepId: string;
  state: PipelineState;
  registry: ArtifactRegistry;
  logger: RunLogger;
}) {
  const record = input.logger.startStep(input.stepId);
  try {
    const runner = STEP_RUNNERS[input.stepId];
    if (!runner) throw new Error(`No runner for ${input.stepId}`);
    const result = await runner(input.state);
    const artifactPaths = Object.entries(result.artifacts).map(([key, value]) =>
      input.registry.writeJson(artifactName(key), value),
    );
    const thresholdReport = checkThresholds({
      stepId: input.stepId,
      metrics: result.metrics,
    });
    const thresholdPath = input.registry.writeJson(
      thresholdName(input.stepId),
      thresholdReport,
    );
    input.logger.completeStep(record, {
      artifacts: [...artifactPaths, thresholdPath],
      metrics: result.metrics,
      thresholdReport: thresholdPath,
    });
  } catch (err) {
    input.logger.failStep(record, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function runPipeline(options: RunnerOptions): Promise<RunnerResult> {
  const runId = options.runId ?? `run_${randomUUID()}`;
  const outputRoot = resolve(options.outputRoot ?? "data/agent-mode-runs");
  const runDir = join(outputRoot, runId);
  const registry = new ArtifactRegistry(runDir);
  const logger = new RunLogger();
  const state: PipelineState = {
    run_id: runId,
    run_dir: runDir,
    input_path: options.input ? resolve(options.input) : "",
    input_was_explicit: Boolean(options.input),
    scene_id: options.sceneId,
    parse_profile: options.parseProfile ?? "builtin",
    understanding_profile: options.understandingProfile ?? "baseline",
    semantic_coherence_profile: options.semanticCoherenceProfile ?? "rules",
    semantic_unit_enhancement_profile: options.semanticUnitEnhancementProfile ?? "rule",
    semantic_unit_match_profile: options.semanticUnitMatchProfile ?? "rule",
    semantic_unit_eval_report: options.semanticUnitEvalReport ?? true,
    extraction_profile: options.extractionProfile ?? "baseline",
    planner_profile: options.plannerProfile ?? "baseline",
  };
  const toolProfile = resolveToolProfile(options.toolProfile);
  registry.writeJson("run_config.json", {
    run_id: runId,
    requested_input: options.input ?? null,
    requested_scene_id: options.sceneId ?? null,
    requested_parse_profile: options.parseProfile ?? "builtin",
    requested_understanding_profile: options.understandingProfile ?? "baseline",
    requested_semantic_coherence_profile: options.semanticCoherenceProfile ?? "rules",
    requested_semantic_unit_enhancement_profile: options.semanticUnitEnhancementProfile ?? "rule",
    requested_semantic_unit_match_profile: options.semanticUnitMatchProfile ?? "rule",
    requested_semantic_unit_eval_report: options.semanticUnitEvalReport ?? true,
    requested_extraction_profile: options.extractionProfile ?? "baseline",
    requested_planner_profile: options.plannerProfile ?? "baseline",
    spec_source: PIPELINE_SPEC_SOURCE,
    tool_profile: toolProfile,
    created_at: new Date().toISOString(),
  });

  for (const stepId of PIPELINE_STEP_ORDER) {
    await runOneStep({ stepId, state, registry, logger });
  }

  const summary = {
    run_id: runId,
    final_status: "completed",
    spec_source: PIPELINE_SPEC_SOURCE,
    scene_id: state.scene_definition?.scene_id,
    scene_name: state.scene_definition?.scene_name,
    parse_profile: state.parse_profile ?? "builtin",
    understanding_profile: state.understanding_profile ?? "baseline",
    semantic_coherence_profile: state.semantic_coherence_profile ?? "rules",
    semantic_unit_enhancement_profile: state.semantic_unit_enhancement_profile ?? "rule",
    semantic_unit_match_profile: state.semantic_unit_match_profile ?? "rule",
    semantic_unit_eval_report: state.semantic_unit_eval_report ?? true,
    extraction_profile: state.extraction_profile ?? "baseline",
    planner_profile: state.planner_profile ?? "baseline",
    profile_versions: {
      schema_profile: state.schema_profile?.profile_id,
      expert_guidance_profile: state.expert_guidance_profile?.profile_id,
      evaluation_profile: state.evaluation_profile?.profile_id,
    },
    step_count: logger.steps.length,
    artifact_count: registry.list().length + 1,
    score_delta: state.score_delta,
    expert_review: state.expert_review,
    completed_at: new Date().toISOString(),
  };
  registry.writeJson("run_config.json", {
    run_id: runId,
    input: state.input_path,
    input_was_explicit: Boolean(state.input_was_explicit),
    scene_id: state.scene_definition?.scene_id,
    scene_name: state.scene_definition?.scene_name,
    parse_profile: state.parse_profile ?? "builtin",
    understanding_profile: state.understanding_profile ?? "baseline",
    semantic_coherence_profile: state.semantic_coherence_profile ?? "rules",
    semantic_unit_enhancement_profile: state.semantic_unit_enhancement_profile ?? "rule",
    semantic_unit_match_profile: state.semantic_unit_match_profile ?? "rule",
    semantic_unit_eval_report: state.semantic_unit_eval_report ?? true,
    extraction_profile: state.extraction_profile ?? "baseline",
    planner_profile: state.planner_profile ?? "baseline",
    spec_source: PIPELINE_SPEC_SOURCE,
    tool_profile: toolProfile,
    profile_source_paths: state.profile_source_paths,
    created_at: new Date().toISOString(),
  });
  registry.writeJson("run_summary.json", summary);
  return {
    run_id: runId,
    run_dir: runDir,
    status: "completed",
    steps: logger.steps,
    artifacts: registry.list(),
  };
}
