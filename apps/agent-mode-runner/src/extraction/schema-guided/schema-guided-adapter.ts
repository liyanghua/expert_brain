import { metric } from "../../observability/metrics.js";
import type { SchemaGuidedExtractionTrace } from "../../types.js";
import type { ExtractionAdapter, ExtractionAdapterInput, ExtractionResult } from "../extraction-adapter.js";
import { validateSchemaGuidedDraft } from "./draft-validator.js";
import { selectSchemaGuidedEvidence } from "./evidence-selector.js";
import { buildSchemaGuidedDraft } from "./field-extractors.js";
import { buildSchemaGuidedFieldPlan } from "./field-plan.js";

export const schemaGuidedExtractionAdapter: ExtractionAdapter = {
  profile: "schema_guided",
  extract(input: ExtractionAdapterInput): ExtractionResult {
    const plans = buildSchemaGuidedFieldPlan({
      schemaProfile: input.schemaProfile,
      expertGuidanceProfile: input.expertGuidanceProfile,
      evaluationProfile: input.evaluationProfile,
    });
    const evidenceSelection = selectSchemaGuidedEvidence({
      adapterInput: input,
      plans,
    });
    const draftResult = buildSchemaGuidedDraft({
      adapterInput: input,
      plans,
      selected: evidenceSelection.selected,
    });
    const validationReport = validateSchemaGuidedDraft({
      draft: draftResult.draft,
      plans,
      tableRowExtractionCount: draftResult.tableRowExtractionCount,
    });
    const trace: SchemaGuidedExtractionTrace = {
      extraction_profile: "schema_guided",
      fields: Object.fromEntries(
        Object.entries(draftResult.traceFields).map(([field, traceField]) => [
          field,
          {
            ...traceField,
            validation_status: validationReport.fields[field]?.status ?? traceField.validation_status,
          },
        ]),
      ),
    };

    return {
      adapterProfile: "schema_guided",
      draft: draftResult.draft,
      metrics: {
        typed_validation_pass_rate: metric(validationReport.typed_validation_pass_rate),
        source_backed_item_rate: metric(validationReport.source_backed_item_rate),
        inferred_field_count: metric(validationReport.inferred_field_count),
        gap_count: metric(validationReport.gap_count),
        table_row_extraction_count: metric(validationReport.table_row_extraction_count),
      },
      extraArtifacts: {
        schema_guided_evidence_map: evidenceSelection.evidenceMap,
        schema_guided_extraction_trace: trace,
        schema_guided_validation_report: validationReport,
      },
    };
  },
};
