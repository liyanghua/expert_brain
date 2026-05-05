import type { DocumentBlock, PlannerProfile } from "../types.js";
import type { PlannerAdapterInput } from "./planner-adapter.js";

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function evidenceBlocksForTargets(input: PlannerAdapterInput): DocumentBlock[] {
  const targetFields = input.scoreExplanation?.recommended_plan_targets.map(
    (target) => target.target_field,
  ) ?? [];
  const targetBlockIds = new Set(
    input.sectionCards
      .filter((card) => card.covered_schema_fields.some((field) => targetFields.includes(field)))
      .flatMap((card) => card.source_block_ids),
  );
  const blocks = input.ir.blocks.filter((block) => targetBlockIds.has(block.block_id));
  return (blocks.length > 0 ? blocks : input.ir.blocks.slice(0, 8)).slice(0, 12);
}

export function buildLlmPlannerPrompt(input: PlannerAdapterInput & { provider: Exclude<PlannerProfile, "baseline"> }) {
  const compactContext = {
    document: {
      doc_id: input.ir.doc_id,
      theme: input.documentUnderstanding?.document_theme,
      business_scene: input.documentUnderstanding?.business_scene,
      primary_goal: input.documentUnderstanding?.primary_goal,
      summary_for_agent: input.documentUnderstanding?.summary_for_agent,
    },
    scorecard: {
      scores: input.scorecard.scores,
      threshold_check: input.scorecard.threshold_check,
      overall_status: input.scorecard.overall_status,
    },
    top_risk_fields: input.scoreExplanation?.top_risk_fields ?? [],
    recommended_plan_targets: input.scoreExplanation?.recommended_plan_targets ?? [],
    field_diagnostics: Object.fromEntries(
      Object.entries(input.fieldDiagnostics?.fields ?? {})
        .filter(([, field]) => field.risk_reasons.length > 0)
        .map(([key, field]) => [
          key,
          {
            validation_status: field.validation_status,
            required: field.required,
            critical: field.critical,
            risk_reasons: field.risk_reasons,
            gap_priority: field.gap_priority,
          },
        ]),
    ),
    schema: {
      profile_id: input.schemaProfile?.profile_id,
      required_fields: input.schemaProfile?.required_fields,
      optional_fields: input.schemaProfile?.optional_fields,
    },
    expert_planning_guidance: input.expertGuidanceProfile?.planning_guidance ?? [],
    evidence_blocks: evidenceBlocksForTargets(input).map((block) => ({
      block_id: block.block_id,
      block_type: block.block_type,
      source_span: block.source_span,
      text: truncate(block.text_content, 600),
    })),
  };

  const system = [
    "你是 Expert Brain Studio 的 Agent Plan 生成器。",
    "你只生成 JSON，不输出 Markdown。",
    "计划必须可审批、可执行、可追踪，每一步都要绑定 evidence_block_ids。",
    "优先覆盖 top_risk_fields 和 recommended_plan_targets。",
    "不要把不确定内容伪装成事实；需要专家确认时使用 request_expert_input 或 validate_inference。",
  ].join("\n");
  const user = [
    "请基于以下上下文生成 AgentPlan JSON。",
    "输出结构必须是：{ plan_id, goal, steps, expected_improvement, status }。",
    "steps 最多 5 个，每个 step 必须包含 step_id/title/target_metric/target_field/rationale/evidence_block_ids/action_type/expected_output/status。",
    "status 固定 draft；step status 固定 pending。",
    "",
    JSON.stringify(compactContext, null, 2),
  ].join("\n");

  return { system, user };
}
