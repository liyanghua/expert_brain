import {
  STRUCTURED_FIELD_KEYS,
  type ExpertGuidanceProfile,
  type GroundTruthDraft,
  type GroundTruthFieldItem,
  type SchemaProfile,
  type StructuredFieldKey,
  type DocumentIR,
} from "../types.js";
import type { DocumentUnderstanding, SectionCard } from "../types.js";

const PRIORITY_FIELDS: StructuredFieldKey[] = [
  "business_scenario",
  "scenario_goal",
  "execution_steps",
  "judgment_basis",
  "judgment_criteria",
  "validation_methods",
  "tool_templates",
];

function item(
  content: unknown,
  blockId?: string,
  status: GroundTruthFieldItem["status"] = "Drafted",
  notes?: string,
): GroundTruthFieldItem {
  return {
    content,
    status,
    confidence: blockId ? 0.78 : 0.58,
    source_refs: blockId ? [{ block_id: blockId }] : [],
    notes,
  };
}

function emptyDraft(docId: string, versionId: string): GroundTruthDraft {
  return {
    schema_name: "BusinessDocStructuredDraft",
    schema_version: "v1",
    doc_id: docId,
    version_id: versionId,
    document_meta: {
      document_id: docId,
      version: versionId,
      source_files: [],
    },
    required_inputs: [],
    deliverables: [],
    thinking_framework: [],
    execution_steps: [],
    execution_actions: [],
    key_node_rationales: [],
    page_screenshots: [],
    faq_types: [],
    judgment_basis: [],
    judgment_criteria: [],
    resolution_methods: [],
    trigger_conditions: [],
    termination_conditions: [],
    validation_methods: [],
    tool_templates: [],
    exceptions_and_non_applicable_scope: [],
    gaps_structured: {
      missing_fields: [],
      weak_fields: [],
      inferred_fields: [],
      needs_confirmation_fields: [],
    },
    gaps: [],
    confidence_by_field: {},
    source_refs: {},
  };
}

function arrayField(draft: GroundTruthDraft, field: StructuredFieldKey): GroundTruthFieldItem[] {
  const value = draft[field];
  return Array.isArray(value) ? value : [];
}

function setField(
  draft: GroundTruthDraft,
  field: StructuredFieldKey,
  value: GroundTruthFieldItem,
) {
  if (field === "business_scenario" || field === "scenario_goal" || field === "process_flow_or_business_model") {
    (draft as Record<string, unknown>)[field] = value;
  } else {
    (draft as unknown as Record<string, GroundTruthFieldItem[]>)[field] = [
      ...arrayField(draft, field),
      value,
    ];
  }
  draft.confidence_by_field[field] = value.confidence ?? 0.6;
  draft.source_refs[field] = value.source_refs;
}

function representativeBlock(ir: DocumentIR, card?: SectionCard): string | undefined {
  return card?.source_block_ids.find((id) => ir.blocks.some((block) => block.block_id === id));
}

export function extractDraftHeuristically(input: {
  ir: DocumentIR;
  understanding: DocumentUnderstanding;
  sectionCards: SectionCard[];
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
}): GroundTruthDraft {
  const draft = emptyDraft(input.ir.doc_id, input.ir.version_id);
  draft.document_meta = {
    document_id: input.ir.doc_id,
    version: input.ir.version_id,
    source_files: [...new Set(input.ir.blocks.map((block) => block.source_file))],
    scene: input.schemaProfile?.scene ?? input.understanding.business_scene,
  };

  const configuredFields = [
    ...(input.schemaProfile?.required_fields ?? PRIORITY_FIELDS),
    ...(input.schemaProfile?.optional_fields ?? []),
  ];
  const targetFields = [...new Set(configuredFields)].slice(0, 10);

  for (const field of targetFields) {
    const card =
      input.sectionCards.find((section) =>
        section.covered_schema_fields.includes(field),
      ) ?? input.sectionCards[0];
    const blockId = representativeBlock(input.ir, card);
    const text = card?.summary ?? input.understanding.primary_goal;
    const definition = input.schemaProfile?.field_definitions[field];
    const guidance = definition?.extraction_hint
      ? `profile_hint: ${definition.extraction_hint}`
      : input.expertGuidanceProfile?.extraction_guidance[0];
    setField(
      draft,
      field,
      item(
        field === "execution_steps"
          ? [`围绕“${card?.title ?? "文档"}”执行：${text}`]
          : text,
        blockId,
        "Drafted",
        guidance,
      ),
    );
  }

  const expectedFields = [...new Set(configuredFields.length > 0 ? configuredFields : STRUCTURED_FIELD_KEYS)];
  const missing = expectedFields.filter((field) => {
    const value = draft[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });
  draft.gaps_structured = {
    missing_fields: missing.map((field_key) => ({
      field_key,
      message: "当前 runner 启发式抽取未覆盖该字段",
    })),
    weak_fields: [],
    inferred_fields: [],
    needs_confirmation_fields: [],
  };
  draft.gaps = missing.slice(0, 6).map((field_key) => ({
    field_key,
    severity: "medium",
    message: `缺少 ${field_key} 的可采用内容`,
    suggested_action: "在 Agent Plan 中生成定向补强步骤",
  }));
  return draft;
}

export function addDraftItem(
  draft: GroundTruthDraft,
  field: StructuredFieldKey,
  content: string,
  blockIds: string[],
  status: GroundTruthFieldItem["status"] = "Drafted",
  notes?: string,
): GroundTruthDraft {
  const next = structuredClone(draft) as GroundTruthDraft;
  setField(next, field, item(content, blockIds[0], status, notes));
  if (blockIds.length > 1) {
    next.source_refs[field] = blockIds.map((block_id) => ({ block_id }));
  }
  next.gaps_structured = {
    missing_fields:
      next.gaps_structured?.missing_fields.filter((gap) => gap.field_key !== field) ??
      [],
    weak_fields: next.gaps_structured?.weak_fields ?? [],
    inferred_fields: next.gaps_structured?.inferred_fields ?? [],
    needs_confirmation_fields: next.gaps_structured?.needs_confirmation_fields ?? [],
  };
  next.gaps = next.gaps.filter((gap) => gap.field_key !== field);
  return next;
}
