import type {
  DocumentBlock,
  GroundTruthDraft,
  GroundTruthFieldItem,
  SchemaGuidedTraceField,
  SourceRef,
  StructuredFieldKey,
} from "../../types.js";
import type { ExtractionAdapterInput } from "../extraction-adapter.js";
import type { SelectedFieldEvidence } from "./evidence-selector.js";
import type { SchemaGuidedFieldPlan } from "./field-plan.js";

export type SchemaGuidedDraftBuildResult = {
  draft: GroundTruthDraft;
  traceFields: Record<string, SchemaGuidedTraceField>;
  tableRowExtractionCount: number;
};

type TableRow = Record<string, string>;

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

function compact(text: string, limit = 420): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function isSingleField(field: string): boolean {
  return ["business_scenario", "scenario_goal", "process_flow_or_business_model"].includes(field);
}

function sourceRefs(blocks: DocumentBlock[]): SourceRef[] {
  return blocks.map((block) => ({
    block_id: block.block_id,
    source_file: block.source_file,
    source_span: block.source_span,
  }));
}

function item(input: {
  content: unknown;
  blocks: DocumentBlock[];
  status: GroundTruthFieldItem["status"];
  confidence: number;
  notes?: string;
}): GroundTruthFieldItem {
  return {
    content: input.content,
    status: input.status,
    confidence: input.confidence,
    source_refs: sourceRefs(input.blocks),
    notes: input.notes,
  };
}

function setDraftField(
  draft: GroundTruthDraft,
  field: StructuredFieldKey,
  values: GroundTruthFieldItem[],
) {
  if (values.length === 0) return;
  if (isSingleField(field)) {
    (draft as Record<string, unknown>)[field] = values[0];
  } else {
    (draft as unknown as Record<string, GroundTruthFieldItem[]>)[field] = values;
  }
  const refs = values.flatMap((value) => value.source_refs);
  draft.confidence_by_field[field] =
    values.reduce((sum, value) => sum + (value.confidence ?? 0), 0) / values.length;
  draft.source_refs[field] = refs;
}

function parseMarkdownTable(text: string): TableRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (lines.length < 3) return [];
  const headers = lines[0]!
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  const bodyLines = lines.slice(2).filter((line) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line));
  return bodyLines.map((line) => {
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function tableValueForField(row: TableRow, field: string): string {
  const entries = Object.entries(row);
  const match = (patterns: RegExp[]) =>
    entries.find(([header]) => patterns.some((pattern) => pattern.test(header)))?.[1];
  if (field === "judgment_basis") return match([/指标/, /依据/, /变量/, /数据/]) ?? entries[0]?.[1] ?? "";
  if (field === "judgment_criteria") return match([/标准/, /阈值/, /判断/, /等级/]) ?? "";
  if (field === "validation_methods") return match([/验证/, /复盘/, /证明/, /效果/]) ?? "";
  if (field === "resolution_methods") return match([/动作/, /方法/, /解决/, /优化/]) ?? "";
  if (field === "faq_types") return match([/问题/, /类型/, /异常/]) ?? "";
  if (field === "tool_templates") return match([/工具/, /模板/, /表格/]) ?? entries.map(([key, value]) => `${key}: ${value}`).join("; ");
  return entries.map(([key, value]) => `${key}: ${value}`).join("; ");
}

function splitListText(text: string): string[] {
  return text
    .split(/\n+|(?:^|\s)(?:\d+[.、)]|[-*])\s+/)
    .map((part) => compact(part, 220))
    .filter((part) => part.length >= 4)
    .slice(0, 6);
}

function itemsFromTable(input: {
  field: StructuredFieldKey;
  blocks: DocumentBlock[];
  status: GroundTruthFieldItem["status"];
}): { items: GroundTruthFieldItem[]; rowCount: number } {
  const tableBlocks = input.blocks.filter((block) => block.block_type === "table");
  const items: GroundTruthFieldItem[] = [];
  let rowCount = 0;
  for (const block of tableBlocks) {
    const rows = parseMarkdownTable(block.text_content);
    rowCount += rows.length;
    for (const row of rows) {
      const value = tableValueForField(row, input.field);
      if (!value) continue;
      items.push(
        item({
          content: value,
          blocks: [block],
          status: input.status,
          confidence: 0.88,
          notes: "schema_guided_table_row",
        }),
      );
    }
  }
  return { items, rowCount };
}

function itemsFromText(input: {
  plan: SchemaGuidedFieldPlan;
  evidence: SelectedFieldEvidence;
  status: GroundTruthFieldItem["status"];
  adapterInput: ExtractionAdapterInput;
}): GroundTruthFieldItem[] {
  const text = input.evidence.blocks.map((block) => block.text_content).join("\n").trim();
  if (!text && input.adapterInput.documentSynthesis?.summary_for_agent) {
    return [];
  }
  if (input.plan.cardinality === "single") {
    return [
      item({
        content: compact(text || (input.adapterInput.documentSynthesis?.summary_for_agent ?? "")),
        blocks: input.evidence.blocks,
        status: input.status,
        confidence: input.evidence.source_grounded ? 0.82 : 0.52,
        notes: "schema_guided_single_text",
      }),
    ].filter((value) => Boolean(value.content));
  }
  return splitListText(text).map((content) =>
    item({
      content,
      blocks: input.evidence.blocks,
      status: input.status,
      confidence: input.evidence.source_grounded ? 0.78 : 0.5,
      notes: "schema_guided_list_text",
    }),
  );
}

export function buildSchemaGuidedDraft(input: {
  adapterInput: ExtractionAdapterInput;
  plans: SchemaGuidedFieldPlan[];
  selected: Record<string, SelectedFieldEvidence>;
}): SchemaGuidedDraftBuildResult {
  const draft = emptyDraft(input.adapterInput.ir.doc_id, input.adapterInput.ir.version_id);
  draft.document_meta = {
    document_id: input.adapterInput.ir.doc_id,
    version: input.adapterInput.ir.version_id,
    source_files: [...new Set(input.adapterInput.ir.blocks.map((block) => block.source_file))],
    scene: input.adapterInput.schemaProfile?.scene ?? input.adapterInput.understanding.business_scene,
  };
  const traceFields: Record<string, SchemaGuidedTraceField> = {};
  let tableRowExtractionCount = 0;

  for (const plan of input.plans) {
    const evidence = input.selected[plan.field];
    const status: GroundTruthFieldItem["status"] =
      plan.inferenceMode === "candidate_allowed" ? "InferredCandidate" : "Drafted";
    if (!evidence || evidence.blocks.length === 0) {
      traceFields[plan.field] = {
        field: plan.field,
        field_type: plan.fieldType,
        selected_block_ids: [],
        extraction_method: "schema_guided_no_grounded_evidence",
        item_count: 0,
        status: "Missing",
        validation_status: plan.required ? "fail" : "warn",
        confidence: 0,
        fallback_reason: "no source-grounded candidate blocks",
      };
      continue;
    }
    const tableResult =
      plan.cardinality === "list" && evidence.table_backed
        ? itemsFromTable({ field: plan.field, blocks: evidence.blocks, status })
        : { items: [], rowCount: 0 };
    const extractedItems =
      tableResult.items.length > 0
        ? tableResult.items
        : itemsFromText({
            plan,
            evidence,
            status,
            adapterInput: input.adapterInput,
          });
    tableRowExtractionCount += tableResult.rowCount;
    setDraftField(draft, plan.field, extractedItems);
    traceFields[plan.field] = {
      field: plan.field,
      field_type: plan.fieldType,
      selected_block_ids: evidence.selected_block_ids,
      extraction_method: tableResult.items.length > 0 ? "schema_guided_table_row" : "schema_guided_text",
      item_count: extractedItems.length,
      status: extractedItems[0]?.status ?? "Missing",
      validation_status: extractedItems.length > 0 ? "pass" : plan.required ? "fail" : "warn",
      confidence: extractedItems[0]?.confidence ?? 0,
      fallback_reason: extractedItems.length === 0 ? "selected evidence did not produce typed content" : undefined,
    };
  }

  return { draft, traceFields, tableRowExtractionCount };
}
