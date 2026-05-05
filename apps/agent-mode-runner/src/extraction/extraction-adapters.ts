import { extractDraftHeuristically } from "../tools/field-extractor.js";
import type {
  DocumentBlock,
  ExtractionEvidenceTrace,
  GroundTruthDraft,
  GroundTruthFieldItem,
  SectionEvidenceHint,
  StructuredFieldKey,
} from "../types.js";
import type {
  ExtractionAdapter,
  ExtractionAdapterInput,
  ExtractionResult,
} from "./extraction-adapter.js";
export { schemaGuidedExtractionAdapter } from "./schema-guided/schema-guided-adapter.js";

const TABLE_PREFERRED_FIELDS = new Set([
  "judgment_basis",
  "judgment_criteria",
  "validation_methods",
  "tool_templates",
]);

type HintEntry = {
  field: StructuredFieldKey;
  hint: SectionEvidenceHint["field_evidence_hints"][string];
  section: SectionEvidenceHint;
};

export const baselineExtractionAdapter: ExtractionAdapter = {
  profile: "baseline",
  extract(input: ExtractionAdapterInput): ExtractionResult {
    return {
      adapterProfile: "baseline",
      draft: extractDraftHeuristically(input),
    };
  },
};

function isSingleField(field: string): boolean {
  return ["business_scenario", "scenario_goal", "process_flow_or_business_model"].includes(field);
}

function item(input: {
  content: unknown;
  blockIds: string[];
  confidence: number;
  notes?: string;
}): GroundTruthFieldItem {
  return {
    content: input.content,
    status: "Drafted",
    confidence: input.confidence,
    source_refs: input.blockIds.map((block_id) => ({ block_id })),
    notes: input.notes,
  };
}

function setDraftField(
  draft: GroundTruthDraft,
  field: StructuredFieldKey,
  value: GroundTruthFieldItem,
) {
  if (isSingleField(field)) {
    (draft as Record<string, unknown>)[field] = value;
  } else {
    (draft as unknown as Record<string, GroundTruthFieldItem[]>)[field] = [value];
  }
  draft.confidence_by_field[field] = value.confidence ?? 0.6;
  draft.source_refs[field] = value.source_refs;
}

function blockById(blocks: DocumentBlock[]): Map<string, DocumentBlock> {
  return new Map(blocks.map((block) => [block.block_id, block]));
}

function contentFromBlocks(blocks: DocumentBlock[], field: string): string {
  const joined = blocks.map((block) => block.text_content).join("\n").trim();
  if (!joined) return "";
  if (TABLE_PREFERRED_FIELDS.has(field)) return joined;
  return joined.replace(/\s+/g, " ").slice(0, 480);
}

function hintEntries(input: ExtractionAdapterInput): HintEntry[] {
  const configuredFields = [
    ...(input.schemaProfile?.required_fields ?? []),
    ...(input.schemaProfile?.optional_fields ?? []),
  ];
  const targetFields = [...new Set(configuredFields)] as StructuredFieldKey[];
  const sections = input.sectionEvidenceHints?.sections ?? [];
  const out: HintEntry[] = [];
  for (const field of targetFields) {
    const candidates = sections.filter((candidate) => candidate.field_evidence_hints[field]);
    const section =
      TABLE_PREFERRED_FIELDS.has(field)
        ? candidates.find((candidate) => {
            const hint = candidate.field_evidence_hints[field];
            return (
              candidate.table_block_ids.length > 0 &&
              candidate.table_block_ids.some((id) => hint?.block_ids.includes(id))
            );
          }) ?? candidates[0]
        : candidates[0];
    const hint = section?.field_evidence_hints[field];
    if (section && hint) out.push({ field, hint, section });
  }
  return out;
}

function removeResolvedGaps(draft: GroundTruthDraft, fields: Set<string>) {
  draft.gaps_structured = {
    missing_fields:
      draft.gaps_structured?.missing_fields.filter((gap) => !fields.has(gap.field_key)) ?? [],
    weak_fields: draft.gaps_structured?.weak_fields ?? [],
    inferred_fields: draft.gaps_structured?.inferred_fields ?? [],
    needs_confirmation_fields: draft.gaps_structured?.needs_confirmation_fields ?? [],
  };
  draft.gaps = draft.gaps.filter((gap) => !fields.has(gap.field_key));
}

export const hintedExtractionAdapter: ExtractionAdapter = {
  profile: "hinted",
  extract(input: ExtractionAdapterInput): ExtractionResult {
    const draft = extractDraftHeuristically(input);
    const blocksById = blockById(input.ir.blocks);
    const trace: ExtractionEvidenceTrace = {
      extraction_profile: "hinted",
      fields: {},
    };
    const resolvedFields = new Set<string>();

    for (const { field, hint, section } of hintEntries(input)) {
      const uniqueBlockIds = [...new Set(hint.block_ids)];
      const evidenceBlocks = uniqueBlockIds
        .map((id) => blocksById.get(id))
        .filter((block): block is DocumentBlock => Boolean(block));
      const tableBacked = evidenceBlocks.some((block) => block.block_type === "table");
      const content = contentFromBlocks(evidenceBlocks, field);
      if (!content) {
        trace.fields[field] = {
          block_ids: uniqueBlockIds,
          signals: hint.signals,
          table_backed: tableBacked,
          extraction_method: "hinted_no_content",
          confidence: 0.45,
          fallback_reason: "hint block ids did not resolve to text content",
        };
        continue;
      }
      const confidence = Math.min(0.92, tableBacked ? 0.86 : 0.8);
      setDraftField(
        draft,
        field,
        item({
          content,
          blockIds: uniqueBlockIds,
          confidence,
          notes: `hinted_from_section:${section.section_id}; signals:${hint.signals.join(", ")}`,
        }),
      );
      resolvedFields.add(field);
      trace.fields[field] = {
        block_ids: uniqueBlockIds,
        signals: hint.signals,
        table_backed: tableBacked,
        extraction_method: tableBacked ? "hinted_table_evidence" : "hinted_section_evidence",
        confidence,
      };
    }

    removeResolvedGaps(draft, resolvedFields);
    return {
      adapterProfile: "hinted",
      draft,
      evidenceTrace: trace,
      extraArtifacts: {
        extraction_evidence_trace: trace,
      },
    };
  },
};
