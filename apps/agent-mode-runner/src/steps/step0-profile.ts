import { loadSceneProfiles } from "../config/scene-registry.js";
import { metric } from "../observability/metrics.js";
import type { PipelineState, StepMetric } from "../types.js";

export function runStep0Profile(state: PipelineState): {
  artifacts: Record<string, unknown>;
  metrics: Record<string, StepMetric>;
} {
  const profiles = loadSceneProfiles(state.scene_id);
  state.scene_registry = profiles.registry;
  state.scene_definition = profiles.scene;
  state.profile_source_paths = profiles.paths;
  if (!state.input_was_explicit) state.input_path = profiles.paths.source_document;
  state.scene_binding = {
    scene_id: profiles.scene.scene_id,
    scene_name: profiles.scene.scene_name,
    domain: profiles.scene.domain,
    selected_scene: profiles.scene.scene_id,
    default_input_path: profiles.paths.source_document,
    schema_profile_version: profiles.schema_profile.profile_id,
    expert_guidance_profile_version: profiles.expert_guidance_profile.profile_id,
    evaluation_profile_version: profiles.evaluation_profile.profile_id,
  };
  state.schema_profile = profiles.schema_profile;
  state.expert_guidance_profile = profiles.expert_guidance_profile;
  state.evaluation_profile = profiles.evaluation_profile;
  const profile_load_diagnostics = {
    scene_id: profiles.scene.scene_id,
    scene_name: profiles.scene.scene_name,
    input_was_explicit: Boolean(state.input_was_explicit),
    source_document: state.input_path,
    profile_source_paths: profiles.paths,
    required_field_count: profiles.schema_profile.required_fields.length,
    optional_field_count: profiles.schema_profile.optional_fields.length,
    guidance_rule_count:
      profiles.expert_guidance_profile.extraction_guidance.length +
      profiles.expert_guidance_profile.planning_guidance.length,
    metric_threshold_count: Object.keys(
      profiles.evaluation_profile.metric_thresholds,
    ).length,
  };
  return {
    artifacts: {
      scene_registry: profiles.registry,
      scene_binding: state.scene_binding,
      schema_profile: profiles.schema_profile,
      expert_guidance_profile: profiles.expert_guidance_profile,
      evaluation_profile: profiles.evaluation_profile,
      profile_load_diagnostics,
    },
    metrics: {
      scene_match_accuracy: metric(0.9, "proxy", "显式 scene_id 选择，未做文档场景分类"),
      profile_load_success_rate: metric(1),
      wrong_profile_rate: metric(0, "proxy"),
    },
  };
}
