import type {
  DocumentIR,
  SchemaProfile,
  SemanticUnit,
  SemanticUnitMatchValidationReport,
  SemanticUnitSchemaFieldMatch,
  SemanticUnitSchemaMatchRelation,
} from "../types.js";

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function schemaFields(schemaProfile?: SchemaProfile): string[] {
  return unique([
    ...(schemaProfile?.required_fields ?? []),
    ...(schemaProfile?.optional_fields ?? []),
  ]);
}

function relationRank(relation: SemanticUnitSchemaMatchRelation): number {
  return { primary: 0, supporting: 1, context: 2, rejected: 3 }[relation];
}

function demotionReason(field: string, text: string): string | null {
  if (field === "trigger_conditions" && !/(触发|启动|条件|情况下|达到|进入诊断)/.test(text)) {
    return "缺少触发/启动/条件类信号，不能作为强证据";
  }
  if (field === "termination_conditions" && !/(结束|停止|终止|维持|退出|转入)/.test(text)) {
    return "缺少结束/停止/维持类信号，不能作为强证据";
  }
  return null;
}

function fallbackMatches(unit: SemanticUnit, validFields: Set<string>): SemanticUnitSchemaFieldMatch[] {
  return unit.related_schema_fields
    .filter((field) => validFields.has(field))
    .slice(0, 5)
    .map((field, index) => ({
      field_key: field,
      relation: index === 0 ? "primary" : index <= 2 ? "supporting" : "context",
      score: index === 0 ? 0.62 : index <= 2 ? 0.46 : 0.28,
      reason: "字段匹配为空，使用规则兜底。",
      matched_signals: [],
      source: "validator",
    }));
}

function dedupeMatches(matches: SemanticUnitSchemaFieldMatch[]): SemanticUnitSchemaFieldMatch[] {
  const byField = new Map<string, SemanticUnitSchemaFieldMatch>();
  for (const match of matches) {
    const existing = byField.get(match.field_key);
    if (!existing || relationRank(match.relation) < relationRank(existing.relation)) byField.set(match.field_key, match);
  }
  return [...byField.values()].sort((a, b) => relationRank(a.relation) - relationRank(b.relation));
}

export function validateSemanticUnitMatches(input: {
  units: SemanticUnit[];
  ir: DocumentIR;
  schemaProfile?: SchemaProfile;
}): {
  units: SemanticUnit[];
  diagnostics: SemanticUnitMatchValidationReport;
} {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const validFields = new Set(schemaFields(input.schemaProfile));
  let fallbackCount = 0;
  let demotedFieldCount = 0;
  let passCount = 0;
  const diagnostics: SemanticUnitMatchValidationReport["diagnostics"] = [];

  const units = input.units.map((unit) => {
    const messages: string[] = [];
    const sourceBlocks = unit.source_block_ids
      .map((blockId) => blockById.get(blockId))
      .filter(Boolean);
    const headingOnly = sourceBlocks.length > 0 && sourceBlocks.every((block) => block?.block_type === "heading");
    let matches = (unit.schema_field_matches ?? []).filter((match) => validFields.has(match.field_key));
    if (matches.length === 0) {
      fallbackCount += 1;
      messages.push("字段匹配为空，已使用 related_schema_fields 兜底。");
      matches = fallbackMatches(unit, validFields);
    }

    matches = matches.map((match) => {
      if (headingOnly && match.relation === "primary") {
        demotedFieldCount += 1;
        messages.push(`${match.field_key} 因 heading-only evidence 从 primary 降级为 context。`);
        return {
          ...match,
          relation: "context" as const,
          score: Math.min(match.score, 0.35),
          reason: `${match.reason}；heading 只能作为上下文。`,
          source: "validator" as const,
        };
      }
      const demoteReason = match.relation === "primary" ? demotionReason(match.field_key, unit.semantic_text) : null;
      if (demoteReason) {
        demotedFieldCount += 1;
        messages.push(`${match.field_key} 从 primary 降级为 context：${demoteReason}。`);
        return {
          ...match,
          relation: "context" as const,
          score: Math.min(match.score, 0.38),
          reason: `${match.reason}；${demoteReason}。`,
          source: "validator" as const,
        };
      }
      return match;
    });

    matches = dedupeMatches(matches);
    const primary = matches.filter((match) => match.relation === "primary");
    if (primary.length > 2) {
      const keep = new Set(primary.slice(0, 2).map((match) => match.field_key));
      messages.push("primary 字段超过 2 个，已将低优先级字段降级为 supporting。");
      matches = matches.map((match) =>
        match.relation === "primary" && !keep.has(match.field_key)
          ? { ...match, relation: "supporting" as const, score: Math.min(match.score, 0.68), source: "validator" as const }
          : match,
      );
    }
    if (!matches.some((match) => match.relation === "primary")) {
      const promotable = matches.find((match) => match.relation === "supporting") ?? matches.find((match) => match.relation === "context");
      if (promotable && !headingOnly) {
        messages.push(`${promotable.field_key} 被提升为 primary，保证语义单元有主字段。`);
        matches = matches.map((match) =>
          match.field_key === promotable.field_key
            ? { ...match, relation: "primary" as const, score: Math.max(match.score, 0.6), source: "validator" as const }
            : match,
        );
      }
    }
    if (matches.length > 0) passCount += 1;
    diagnostics.push({ unit_id: unit.unit_id, messages });
    return {
      ...unit,
      schema_field_matches: dedupeMatches(matches),
    };
  });

  return {
    units,
    diagnostics: {
      validation_profile: "semantic_unit_match_validator.v0",
      validation_pass_rate: units.length === 0 ? 1 : Number((passCount / units.length).toFixed(4)),
      fallback_count: fallbackCount,
      demoted_field_count: demotedFieldCount,
      diagnostics,
    },
  };
}
