import type { DocumentIR } from "@ebs/document-ir";
import { STRUCTURED_FIELD_KEYS } from "@ebs/ground-truth-schema";

const MAX_BLOCK_CHARS = 4000;

function compactBlockText(text: string, max = MAX_BLOCK_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function tableFieldHints(): string {
  return `Table-to-field mapping hints:
- 业务场景 -> business_scenario
- 场景目标 -> scenario_goal
- 前置输入/所需输入 -> required_inputs
- 输出成果/交付物 -> deliverables
- 目标思维框架/业务模型/流程模型 -> process_flow_or_business_model or thinking_framework
- 执行动作 -> execution_steps and execution_actions
- 关键节点思路说明/为什么这么做 -> key_node_rationales
- 页面截图 -> page_screenshots
- 常见问题类型 -> faq_types
- 判断依据/指标 -> judgment_basis
- 判断标准/数量/质量/时限/频率 -> judgment_criteria
- 问题解决方法/执行动作 -> resolution_methods
- 流程触发与终止条件 -> trigger_conditions and termination_conditions
- 验证方法/验证效果 -> validation_methods
- 工具模板/表单 -> tool_templates
- 例外/不适用范围 -> exceptions_and_non_applicable_scope`;
}

export function buildStructuringSystemPrompt(opts?: {
  strict?: boolean;
  qualityIssues?: string[];
}): string {
  const keys = STRUCTURED_FIELD_KEYS.join(", ");
  const qualityNotes =
    opts?.qualityIssues && opts.qualityIssues.length > 0
      ? `\nKnown quality issues from the previous attempt; fix all of them:\n${opts.qualityIssues.map((i) => `- ${i}`).join("\n")}\n`
      : "";
  return `You extract a structured business-document draft as JSON for downstream Zod validation (BusinessDocStructuredDraft / GroundTruthDraft).

Include JSON keys for field payloads: ${keys}

Also allowed on the root object: document_meta, gaps_structured, global_scores, gaps, confidence_by_field, source_refs, schema_name, schema_version.

Field item shape (GroundTruthFieldItem):
- content: object or string (use objects like { "text": "..." } or { "summary": "..." } when helpful)
- status: one of Missing | Partial | Drafted | Confirmed | InferredCandidate (PascalCase as listed)
- confidence: number 0..1
- source_refs: array of { block_id?: string, source_file?: string, page_no?: number|null, source_span?: string }
- item_id?: string
- notes?: string

Rules:
- Prefer verbatim grounding: set source_refs.block_id from the IR blocks when text comes from that block.
- Use status InferredCandidate when content is summarized or inferred beyond strict quotation.
- page_screenshots: tie to blocks where block_type is image; put media_uri in notes if present on that block.
- gaps_structured: populate missing_fields / weak_fields / inferred_fields / needs_confirmation_fields with { field_key, message } entries when appropriate.
- document_meta.document_id must match the input doc_id; include source_files from IR source_file values when obvious.
- Never output placeholder content such as "to be confirmed", "needs expert input", or "待专家确认" when the source document contains concrete content.
- For product-diagnosis or ecommerce-operation documents, extract the core operating knowledge: lifecycle stages, product grade framework, diagnosis dimensions, indicator thresholds, issue investigation logic, execution actions, trigger/termination conditions, and deliverables.
- Prefer the explicit mapping table when present; it often directly names the target structured fields.
- For schema array fields, output arrays of field items. For business_scenario, scenario_goal, and process_flow_or_business_model, output a single field item.
- Preserve business meaning. Do not merely copy the first blocks or table headers.
- Output JSON only (no markdown code fences).
- schema_name must be "BusinessDocStructuredDraft".
${tableFieldHints()}${qualityNotes}${opts?.strict ? "\nThis is a strict retry. Return a complete, non-placeholder draft that passes the schema and quality gate." : ""}`;
}

export function buildKnowledgeSkeletonSystemPrompt(): string {
  return `You are extracting the core knowledge skeleton of a Chinese business document before schema mapping.
Return JSON only. Focus on reusable operating knowledge, not formatting.
For ecommerce/product-diagnosis documents, include lifecycle_stages, product_grade_framework, diagnosis_dimensions, indicator_thresholds, investigation_logic, execution_actions, deliverables, triggers, termination_conditions, and source_block_ids.`;
}

export function buildKnowledgeSkeletonUserPrompt(ir: DocumentIR): string {
  return `doc_id: ${ir.doc_id}
version_id: ${ir.version_id}

Document context:
${buildDocumentContext(ir)}`;
}

export function buildDocumentContext(ir: DocumentIR): string {
  const headings = ir.blocks
    .filter((b) => b.block_type === "heading" || b.block_type === "outline")
    .map((b) => ({
      block_id: b.block_id,
      text: b.text_content,
      level: b.heading_level,
      parent_block_id: b.parent_block_id ?? undefined,
    }));
  const tables = ir.blocks
    .filter((b) => b.block_type === "table")
    .map((b) => ({
      block_id: b.block_id,
      source_span: b.source_span,
      text: compactBlockText(b.text_content, 8000),
    }));
  const blocks = ir.blocks.map((b) => ({
    block_id: b.block_id,
    block_type: b.block_type,
    text_content:
      b.block_type === "table"
        ? compactBlockText(b.text_content, 1200)
        : compactBlockText(b.text_content),
    page_no: b.page_no ?? undefined,
    media_uri: b.media_uri ?? undefined,
    source_file: b.source_file,
    source_span: b.source_span,
    parent_block_id: b.parent_block_id ?? undefined,
    children_block_ids:
      b.children_block_ids.length > 0 ? b.children_block_ids : undefined,
  }));
  return `Outline:
${JSON.stringify(headings, null, 2)}

Tables:
${JSON.stringify(tables, null, 2)}

All blocks:
${JSON.stringify(blocks, null, 2)}`;
}

export function buildStructuringUserPrompt(
  ir: DocumentIR,
  knowledgeSkeleton?: unknown,
): string {
  const skeleton =
    knowledgeSkeleton === undefined
      ? "(not available)"
      : typeof knowledgeSkeleton === "string"
        ? knowledgeSkeleton
        : JSON.stringify(knowledgeSkeleton, null, 2);
  return `doc_id: ${ir.doc_id}
version_id: ${ir.version_id}

Phase A knowledge skeleton:
${skeleton}

Phase B task:
Map the skeleton and source blocks into BusinessDocStructuredDraft JSON. Use exact block_id values in source_refs.

Document IR context:
${buildDocumentContext(ir)}`;
}
