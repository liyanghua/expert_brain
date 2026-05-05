import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SemanticUnit,
  SemanticUnitEvaluationReport,
  SemanticUnitLlmObservability,
  SemanticUnitMatchValidationReport,
} from "../types.js";

function round(value: number): number {
  return Number(value.toFixed(4));
}

function relationCount(unit: SemanticUnit, relation: string): number {
  return unit.schema_field_matches?.filter((match) => match.relation === relation).length ?? 0;
}

function headingOveruseRate(units: SemanticUnit[]): number {
  if (units.length === 0) return 0;
  const overused = units.filter((unit) => {
    const heading = unit.parent_heading;
    const summary = unit.llm_summary || unit.summary;
    return Boolean(heading && summary.includes(heading));
  }).length;
  return round(overused / units.length);
}

function overTagRate(units: SemanticUnit[]): number {
  if (units.length === 0) return 0;
  const overTagged = units.filter((unit) => (unit.schema_field_matches?.length ?? unit.related_schema_fields.length) > 4).length;
  return round(overTagged / units.length);
}

function averagePrimaryFields(units: SemanticUnit[]): number {
  if (units.length === 0) return 0;
  return round(units.reduce((sum, unit) => sum + relationCount(unit, "primary"), 0) / units.length);
}

function primaryCoverage(units: SemanticUnit[]): number {
  if (units.length === 0) return 0;
  return round(units.filter((unit) => relationCount(unit, "primary") > 0).length / units.length);
}

function compressionRatio(units: SemanticUnit[]): number {
  const ratios = units
    .map((unit) => {
      const summary = unit.llm_summary || unit.summary;
      if (!unit.semantic_text.length) return 1;
      return summary.length / unit.semantic_text.length;
    })
    .filter((value) => Number.isFinite(value));
  if (ratios.length === 0) return 0;
  return round(ratios.reduce((sum, value) => sum + value, 0) / ratios.length);
}

function titleSpecificityProxy(units: SemanticUnit[]): number {
  if (units.length === 0) return 0;
  const specific = units.filter((unit) => {
    const title = unit.unit_title || "";
    return title.length >= 6 && title.length <= 32 && !title.includes(unit.parent_heading || "__never__");
  }).length;
  return round(specific / units.length);
}

function semanticNavigationScore(metrics: Record<string, number>): number {
  const metricValue = (key: string) => metrics[key] ?? 0;
  return round(
    0.2 * metricValue("primary_field_coverage") +
      0.18 * (1 - metricValue("heading_overuse_rate")) +
      0.16 * (1 - metricValue("over_tag_rate")) +
      0.14 * metricValue("title_specificity_proxy") +
      0.12 * metricValue("validation_pass_rate") +
      0.1 * (1 - metricValue("fallback_rate")) +
      0.1 * Math.max(0, 1 - Math.abs(metricValue("avg_primary_fields_per_unit") - 1)),
  );
}

export function evaluateSemanticUnits(input: {
  baselineUnits: SemanticUnit[];
  enhancedUnits: SemanticUnit[];
  validation: { diagnostics: SemanticUnitMatchValidationReport };
  observability: SemanticUnitLlmObservability;
}): SemanticUnitEvaluationReport {
  const fallbackRate =
    input.observability.status === "fallback_rule_based"
      ? 1
      : input.enhancedUnits.length === 0
        ? 0
        : input.validation.diagnostics.fallback_count / input.enhancedUnits.length;
  const metrics = {
    unit_count: input.enhancedUnits.length,
    avg_blocks_per_unit:
      input.enhancedUnits.length === 0
        ? 0
        : round(input.enhancedUnits.reduce((sum, unit) => sum + unit.source_block_ids.length, 0) / input.enhancedUnits.length),
    heading_overuse_rate: headingOveruseRate(input.enhancedUnits),
    summary_compression_ratio: compressionRatio(input.enhancedUnits),
    title_specificity_proxy: titleSpecificityProxy(input.enhancedUnits),
    primary_field_coverage: primaryCoverage(input.enhancedUnits),
    avg_primary_fields_per_unit: averagePrimaryFields(input.enhancedUnits),
    over_tag_rate: overTagRate(input.enhancedUnits),
    context_demotion_rate:
      input.enhancedUnits.length === 0
        ? 0
        : round(input.enhancedUnits.filter((unit) => relationCount(unit, "context") > 0).length / input.enhancedUnits.length),
    rejected_field_rate:
      input.enhancedUnits.length === 0
        ? 0
        : round(input.enhancedUnits.filter((unit) => relationCount(unit, "rejected") > 0).length / input.enhancedUnits.length),
    validation_pass_rate: input.validation.diagnostics.validation_pass_rate,
    fallback_rate: round(fallbackRate),
  };
  return {
    generated_at: new Date().toISOString(),
    metric_notes: "No golden set is available yet; metrics are proxy checks for structure, readability, noise and consistency.",
    metrics,
    semantic_navigation_score: semanticNavigationScore(metrics),
    baseline: {
      unit_count: input.baselineUnits.length,
      over_tag_rate: overTagRate(input.baselineUnits),
      heading_overuse_rate: headingOveruseRate(input.baselineUnits),
    },
    enhanced: {
      unit_count: input.enhancedUnits.length,
      over_tag_rate: overTagRate(input.enhancedUnits),
      heading_overuse_rate: headingOveruseRate(input.enhancedUnits),
    },
    examples: input.enhancedUnits.slice(0, 6).map((unit) => ({
      unit_id: unit.unit_id,
      title: unit.unit_title,
      summary: unit.llm_summary || unit.summary,
      primary_fields: unit.schema_field_matches?.filter((match) => match.relation === "primary").map((match) => match.field_key) ?? [],
      supporting_fields: unit.schema_field_matches?.filter((match) => match.relation === "supporting").map((match) => match.field_key) ?? [],
      context_fields: unit.schema_field_matches?.filter((match) => match.relation === "context").map((match) => match.field_key) ?? [],
      rejected_fields: unit.schema_field_matches?.filter((match) => match.relation === "rejected").map((match) => match.field_key) ?? [],
    })),
  };
}

export function writeSemanticUnitEvaluationReport(input: {
  outputDir: string;
  report: SemanticUnitEvaluationReport;
}): string {
  mkdirSync(input.outputDir, { recursive: true });
  const path = join(input.outputDir, "semantic_unit_schema_match_evaluation.md");
  const lines = [
    "# Semantic Unit & Schema Match Evaluation",
    "",
    "## Summary",
    "",
    `- semantic_navigation_score: ${input.report.semantic_navigation_score}`,
    `- metric_notes: ${input.report.metric_notes}`,
    "",
    "## Metrics",
    "",
    ...Object.entries(input.report.metrics).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Baseline vs Enhanced",
    "",
    `- baseline over_tag_rate: ${input.report.baseline.over_tag_rate}`,
    `- enhanced over_tag_rate: ${input.report.enhanced.over_tag_rate}`,
    `- baseline heading_overuse_rate: ${input.report.baseline.heading_overuse_rate}`,
    `- enhanced heading_overuse_rate: ${input.report.enhanced.heading_overuse_rate}`,
    "",
    "## Examples",
    "",
    ...input.report.examples.flatMap((example) => [
      `### ${example.unit_id} ${example.title ? `· ${example.title}` : ""}`,
      "",
      example.summary,
      "",
      `- primary: ${example.primary_fields.join(", ") || "none"}`,
      `- supporting: ${example.supporting_fields.join(", ") || "none"}`,
      `- context: ${example.context_fields.join(", ") || "none"}`,
      `- rejected: ${example.rejected_fields.join(", ") || "none"}`,
      "",
    ]),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}
