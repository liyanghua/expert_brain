import type {
  DocumentIR,
  ExpertGuidanceProfile,
  SchemaProfile,
  SemanticUnit,
  SemanticUnitLlmEnhancementArtifact,
  SemanticUnitLlmObservability,
  SemanticUnitSchemaFieldMatch,
  SemanticUnitSchemaMatchRelation,
} from "../types.js";

export type SemanticUnitEnhancementCompletion = (input: {
  system: string;
  user: string;
}) => string;

function compact(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function schemaFields(schemaProfile?: SchemaProfile): string[] {
  return unique([
    ...(schemaProfile?.required_fields ?? []),
    ...(schemaProfile?.optional_fields ?? []),
  ]);
}

function parentHeadingForUnit(input: { unit: SemanticUnit; ir: DocumentIR }): string | undefined {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const firstBlock = blockById.get(input.unit.source_block_ids[0] ?? "");
  const parent = firstBlock?.parent_block_id ? blockById.get(firstBlock.parent_block_id) : undefined;
  if (parent?.block_type === "heading") return parent.text_content;
  return undefined;
}

function stripParentHeading(summary: string, parentHeading?: string): string {
  const withoutParentHeading = parentHeading ? summary.replace(parentHeading, "") : summary;
  return withoutParentHeading
    .replace(/^[^：:]{2,32}[：:]/, "")
    .replace(/^[:：\s]+/, "")
    .trim();
}

function titleFromText(unit: SemanticUnit): string {
  const text = unit.semantic_text.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  const firstClause = text.split(/[。；;]/)[0] ?? text;
  return compact(firstClause, 26) || unit.unit_id;
}

function relationRank(relation: SemanticUnitSchemaMatchRelation): number {
  return { primary: 0, supporting: 1, context: 2, rejected: 3 }[relation];
}

function matchesFromBuckets(input: {
  unitId: string;
  buckets: Record<string, unknown>;
  reasons?: Record<string, string>;
  validFields: Set<string>;
  source: "llm" | "rule";
}): SemanticUnitSchemaFieldMatch[] {
  const relationByKey: Record<string, SemanticUnitSchemaMatchRelation> = {
    primary_schema_fields: "primary",
    supporting_schema_fields: "supporting",
    context_schema_fields: "context",
    rejected_schema_fields: "rejected",
  };
  const matches: SemanticUnitSchemaFieldMatch[] = [];
  for (const [bucket, relation] of Object.entries(relationByKey)) {
    const fields = Array.isArray(input.buckets[bucket]) ? input.buckets[bucket] as unknown[] : [];
    for (const value of fields) {
      const field = String(value ?? "").trim();
      if (!input.validFields.has(field)) continue;
      matches.push({
        field_key: field,
        relation,
        score: relation === "primary" ? 0.92 : relation === "supporting" ? 0.72 : relation === "context" ? 0.45 : 0.1,
        reason: input.reasons?.[field] || `${input.source === "llm" ? "LLM" : "规则"}判断为${relation}`,
        matched_signals: [],
        source: input.source,
      });
    }
  }
  return uniqueByField(matches).sort((a, b) => relationRank(a.relation) - relationRank(b.relation));
}

function uniqueByField(matches: SemanticUnitSchemaFieldMatch[]): SemanticUnitSchemaFieldMatch[] {
  const byField = new Map<string, SemanticUnitSchemaFieldMatch>();
  for (const match of matches) {
    const existing = byField.get(match.field_key);
    if (!existing || relationRank(match.relation) < relationRank(existing.relation)) {
      byField.set(match.field_key, match);
    }
  }
  return [...byField.values()];
}

function fallbackMatches(unit: SemanticUnit, validFields: Set<string>): SemanticUnitSchemaFieldMatch[] {
  const fields = unit.related_schema_fields.filter((field) => validFields.has(field));
  return fields.slice(0, 4).map((field, index) => ({
    field_key: field,
    relation: index === 0 ? "primary" : index <= 2 ? "supporting" : "context",
    score: index === 0 ? 0.64 : index <= 2 ? 0.48 : 0.32,
    reason: "LLM 不可用，基于现有 semantic unit 相关字段兜底。",
    matched_signals: [],
    source: "rule",
  }));
}

function buildPrompt(input: {
  units: SemanticUnit[];
  ir: DocumentIR;
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
}) {
  const fieldDefinitions = input.schemaProfile?.field_definitions as
    | Record<string, { description?: string; extraction_hint?: string } | undefined>
    | undefined;
  const fields = schemaFields(input.schemaProfile).map((field) => ({
    field_key: field,
    description: fieldDefinitions?.[field]?.description,
    extraction_hint: fieldDefinitions?.[field]?.extraction_hint,
    expert_guidance: input.expertGuidanceProfile?.field_guidance[field] ?? [],
  }));
  const unitPayload = input.units.map((unit) => ({
    unit_id: unit.unit_id,
    parent_heading: parentHeadingForUnit({ unit, ir: input.ir }),
    source_block_ids: unit.source_block_ids,
    semantic_text: unit.semantic_text,
    current_summary: unit.summary,
    current_related_schema_fields: unit.related_schema_fields,
  }));
  return {
    system:
      "你是业务文档理解评审器。请只基于输入的 semantic unit 原文，在给定 schema 字段中选择字段关系，输出严格 JSON。",
    user: JSON.stringify({
      task: "为每个 semantic unit 生成业务友好的 unit_title/unit_summary，并把 schema 字段分成 primary/supporting/context/rejected。",
      rules: [
        "父标题只能作为 parent_heading/context，不要复读到 unit_summary 主体。",
        "primary_schema_fields 最多 2 个。",
        "supporting_schema_fields 最多 3 个。",
        "如果字段只是章节背景，请放入 context_schema_fields。",
        "如果容易误判但原文没有证据，请放入 rejected_schema_fields。",
      ],
      fields,
      units: unitPayload,
      output_schema: {
        units: [
          {
            unit_id: "string",
            unit_title: "string",
            unit_summary: "string",
            primary_schema_fields: ["field_key"],
            supporting_schema_fields: ["field_key"],
            context_schema_fields: ["field_key"],
            rejected_schema_fields: ["field_key"],
            field_match_reasons: { field_key: "reason" },
          },
        ],
      },
    }, null, 2),
  };
}

function parseResponse(raw: string): Record<string, unknown>[] {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { units?: unknown[] };
  if (!Array.isArray(parsed.units)) throw new Error("semantic unit LLM response missing units");
  return parsed.units.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export function enhanceSemanticUnitsWithLlm(input: {
  units: SemanticUnit[];
  ir: DocumentIR;
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
  completion?: SemanticUnitEnhancementCompletion;
}): SemanticUnitLlmEnhancementArtifact {
  const validFields = new Set(schemaFields(input.schemaProfile));
  const prompt = buildPrompt(input);
  const completion = input.completion ??
    (process.env.AGENT_MODE_RUNNER_LLM_SEMANTIC_UNIT_MOCK_RESPONSE
      ? () => process.env.AGENT_MODE_RUNNER_LLM_SEMANTIC_UNIT_MOCK_RESPONSE ?? ""
      : undefined);
  let observability: SemanticUnitLlmObservability;
  let byUnit = new Map<string, Record<string, unknown>>();
  if (completion) {
    try {
      const raw = completion(prompt);
      const parsedUnits = parseResponse(raw);
      byUnit = new Map(parsedUnits.map((unit) => [String(unit.unit_id), unit]));
      observability = {
        status: "llm_generated",
        provider: input.completion ? "mock" : "env_mock",
        model: input.completion ? "mock" : "env_mock",
        prompt,
        raw_response: raw,
        parsed_result: { units: parsedUnits },
        unit_count: input.units.length,
      };
    } catch (err) {
      observability = {
        status: "fallback_rule_based",
        prompt,
        fallback_reason: err instanceof Error ? err.message : String(err),
        unit_count: input.units.length,
      };
    }
  } else {
    observability = {
      status: "fallback_rule_based",
      prompt,
      fallback_reason: "semantic unit LLM completion not configured",
      unit_count: input.units.length,
    };
  }

  const enhanced = input.units.map((unit) => {
    const parentHeading = parentHeadingForUnit({ unit, ir: input.ir });
    const record = byUnit.get(unit.unit_id);
    const reasons = record?.field_match_reasons && typeof record.field_match_reasons === "object"
      ? record.field_match_reasons as Record<string, string>
      : undefined;
    const llmMatches =
      record
        ? matchesFromBuckets({
            unitId: unit.unit_id,
            buckets: record,
            reasons,
            validFields,
            source: "llm",
          })
        : [];
    const matches = llmMatches.length > 0 ? llmMatches : fallbackMatches(unit, validFields);
    const llmSummary = String(record?.unit_summary ?? "").trim();
    return {
      ...unit,
      parent_heading: parentHeading,
      unit_title: String(record?.unit_title ?? "").trim() || titleFromText(unit),
      llm_summary: llmSummary || compact(stripParentHeading(unit.semantic_text || unit.summary, parentHeading), 240),
      schema_field_matches: matches,
    };
  });

  return {
    enhancement_profile: observability.status === "llm_generated" ? "llm" : "rule",
    match_profile: observability.status === "llm_generated" ? "llm" : "rule",
    generated_at: new Date().toISOString(),
    units: enhanced,
    observability,
  };
}
