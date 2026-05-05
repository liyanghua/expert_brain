import type {
  EvaluationProfile,
  ExpertGuidanceProfile,
  SceneBinding,
  SchemaProfile,
  StructuredFieldKey,
} from "../types.js";
import { STRUCTURED_FIELD_KEYS } from "../types.js";

export function loadDefaultProfiles(): {
  scene_binding: SceneBinding;
  schema_profile: SchemaProfile;
  expert_guidance_profile: ExpertGuidanceProfile;
  evaluation_profile: EvaluationProfile;
} {
  const requiredFields = [...STRUCTURED_FIELD_KEYS] as StructuredFieldKey[];
  return {
    scene_binding: {
      scene_id: "business_doc_default",
      selected_scene: "business_doc_default",
      schema_profile_version: "schema.business_doc.v1",
      expert_guidance_profile_version: "guidance.business_doc.v1",
      evaluation_profile_version: "eval.business_doc.v1",
    },
    schema_profile: {
      profile_id: "schema.business_doc",
      version: "v1",
      required_fields: requiredFields,
      optional_fields: [],
      inferred_candidate_fields: [],
      field_definitions: {},
      normalization_rules: [],
      output_requirements: [],
    },
    expert_guidance_profile: {
      profile_id: "guidance.business_doc",
      version: "v1",
      field_guidance: {
        execution_steps: ["请按真实操作顺序拆解每一步怎么做。"],
        judgment_basis: ["做判断时重点看哪些指标、数据或观察项？"],
        judgment_criteria: ["这些指标达到什么区间算正常、异常或优秀？"],
        tool_templates: ["这里是否有长期复用的表格、模板或 SOP？"],
      },
      extraction_guidance: [],
      gap_detection_guidance: [],
      planning_guidance: [],
      inference_boundaries: [],
      quality_preferences: [],
    },
    evaluation_profile: {
      profile_id: "eval.business_doc",
      version: "v1",
      metrics: [
        "field_coverage",
        "source_grounding_rate",
        "structural_consistency",
        "gap_detection_accuracy",
        "inference_handling_accuracy",
      ],
      metric_thresholds: {},
      field_weights: {},
      critical_fields: [],
      list_fields: [],
      single_fields: [],
      hard_gates: [],
      gap_priority_rules: [],
    },
  };
}
