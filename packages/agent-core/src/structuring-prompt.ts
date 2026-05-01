import type { DocumentIR } from "@ebs/document-ir";
import { STRUCTURED_FIELD_KEYS } from "@ebs/ground-truth-schema";

const MAX_BLOCK_CHARS = 4000;
const DEFAULT_MAX_COMPACT_BLOCKS = 80;
const DEFAULT_MAX_COMPACT_BLOCK_CHARS = 900;
const DEFAULT_MAX_COMPACT_TABLE_CHARS = 1800;
const IMPORTANT_BLOCK_PATTERN =
  /商品诊断|生命周期|商品等级|诊断维度|判断标准|核心指标|执行动作|任务清单|排查|定位问题|解决方法|触发|终止|输入|输出|目标|场景|交付|流程|模型|常见问题|FAQ|验证|工具|模板|例外|不适用|指标|阈值|转化率|加购率|退款率|ROI|GMV/i;

export type CompactDocumentContext = {
  text: string;
  totalBlockCount: number;
  selectedBlockCount: number;
  selectedBlockIds: string[];
  contextChars: number;
};

export type CompactDocumentContextOptions = {
  maxBlocks?: number;
  maxBlockChars?: number;
  maxTableChars?: number;
  paragraphsPerHeading?: number;
  maxOutlineItems?: number;
  maxOutlineChars?: number;
};

function compactBlockText(text: string, max = MAX_BLOCK_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function compactBudget(opts?: CompactDocumentContextOptions) {
  return {
    maxBlocks: opts?.maxBlocks ?? positiveInt(
      process.env.EBS_STRUCTURING_MAX_BLOCKS,
      DEFAULT_MAX_COMPACT_BLOCKS,
    ),
    maxBlockChars: opts?.maxBlockChars ?? positiveInt(
      process.env.EBS_STRUCTURING_MAX_BLOCK_CHARS,
      DEFAULT_MAX_COMPACT_BLOCK_CHARS,
    ),
    maxTableChars: opts?.maxTableChars ?? positiveInt(
      process.env.EBS_STRUCTURING_MAX_TABLE_CHARS,
      DEFAULT_MAX_COMPACT_TABLE_CHARS,
    ),
    paragraphsPerHeading: opts?.paragraphsPerHeading ?? 2,
    maxOutlineItems: opts?.maxOutlineItems ?? 48,
    maxOutlineChars: opts?.maxOutlineChars ?? 120,
  };
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
  const context = buildCompactDocumentContext(ir, {
    maxBlocks: Math.min(positiveInt(process.env.EBS_STRUCTURING_MAX_BLOCKS, 80), 60),
  });
  return `doc_id: ${ir.doc_id}
version_id: ${ir.version_id}

Document context:
${context.text}`;
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

export function buildCompactDocumentContext(
  ir: DocumentIR,
  opts?: CompactDocumentContextOptions,
): CompactDocumentContext {
  const budget = compactBudget(opts);
  const selected = new Set<string>();
  const headingIndexes: number[] = [];

  ir.blocks.forEach((block, index) => {
    if (block.block_type === "heading" || block.block_type === "outline") {
      selected.add(block.block_id);
      if ((block.heading_level ?? 0) <= 2) headingIndexes.push(index);
    }
    if (block.block_type === "table") selected.add(block.block_id);
    if (IMPORTANT_BLOCK_PATTERN.test(block.text_content)) {
      selected.add(block.block_id);
    }
  });

  for (const headingIndex of headingIndexes) {
    let addedAfterHeading = 0;
    for (
      let i = headingIndex + 1;
      i < ir.blocks.length && addedAfterHeading < budget.paragraphsPerHeading;
      i += 1
    ) {
      const block = ir.blocks[i]!;
      if (block.block_type === "heading" && (block.heading_level ?? 0) <= 2) break;
      if (block.block_type === "paragraph" || block.block_type === "list") {
        selected.add(block.block_id);
        addedAfterHeading += 1;
      }
    }
  }

  const selectedBlocks = ir.blocks
    .filter((block) => selected.has(block.block_id))
    .slice(0, budget.maxBlocks);
  const outline = ir.blocks
    .filter((block) => block.block_type === "heading" || block.block_type === "outline")
    .slice(0, budget.maxOutlineItems)
    .map((block) => ({
      block_id: block.block_id,
      text: compactBlockText(block.text_content, budget.maxOutlineChars),
      level: block.heading_level,
    }));
  const blocks = selectedBlocks.map((block) => ({
    block_id: block.block_id,
    block_type: block.block_type,
    text_content: compactBlockText(
      block.text_content,
      block.block_type === "table" ? budget.maxTableChars : budget.maxBlockChars,
    ),
    source_span: block.source_span,
  }));
  const text = `Context stats:
${JSON.stringify(
  {
    total_blocks: ir.blocks.length,
    selected_blocks: selectedBlocks.length,
    max_blocks: budget.maxBlocks,
  },
  null,
  2,
)}

Compressed outline:
${JSON.stringify(outline, null, 2)}

Selected key blocks:
${JSON.stringify(blocks, null, 2)}`;

  return {
    text,
    totalBlockCount: ir.blocks.length,
    selectedBlockCount: selectedBlocks.length,
    selectedBlockIds: selectedBlocks.map((block) => block.block_id),
    contextChars: text.length,
  };
}

export function buildDocumentNavigationIndex(ir: DocumentIR): string {
  const maxIndexBlocks = Math.min(
    positiveInt(process.env.EBS_TRIAGE_INDEX_MAX_BLOCKS, 160),
    240,
  );
  const indexedBlocks = ir.blocks.slice(0, maxIndexBlocks);
  const lines = indexedBlocks.map((block, index) => {
    const level = block.heading_level ? ` h${block.heading_level}` : "";
    const span = block.source_span ? ` ${block.source_span}` : "";
    const parent = block.parent_block_id ? ` parent=${block.parent_block_id}` : "";
    const text = compactBlockText(block.text_content.replace(/\s+/g, " "), 60);
    return `${index + 1}. ${block.block_id} ${block.block_type}${level}${span}${parent}: ${text}`;
  });
  const omitted = Math.max(0, ir.blocks.length - indexedBlocks.length);
  return `Document navigation index (all blocks, compact):
total_blocks=${ir.blocks.length}
indexed_blocks=${indexedBlocks.length}
omitted_blocks=${omitted}
${lines.join("\n")}`;
}

export function buildKnowledgeSkeletonPromptInput(ir: DocumentIR): {
  prompt: string;
  context: CompactDocumentContext;
} {
  const context = buildCompactDocumentContext(ir, {
    maxBlocks: Math.min(positiveInt(process.env.EBS_STRUCTURING_MAX_BLOCKS, 80), 14),
    maxBlockChars: Math.min(
      positiveInt(process.env.EBS_STRUCTURING_MAX_BLOCK_CHARS, 900),
      320,
    ),
    maxTableChars: Math.min(
      positiveInt(process.env.EBS_STRUCTURING_MAX_TABLE_CHARS, 1800),
      700,
    ),
    paragraphsPerHeading: 1,
    maxOutlineItems: 20,
    maxOutlineChars: 80,
  });
  return {
    prompt: `doc_id: ${ir.doc_id}
version_id: ${ir.version_id}

Document context:
${context.text}`,
    context,
  };
}

export function buildGlobalQualityTriageSystemPrompt(): string {
  return `Return JSON only. Lightweight quality triage. Use severity/priority only: low, medium, high. source_refs must be objects with block_id. Keep every text field short.`;
}

export function buildGlobalQualityTriagePromptInput(ir: DocumentIR): {
  prompt: string;
  context: CompactDocumentContext;
} {
  const context = buildCompactDocumentContext(ir, {
    maxBlocks: Math.min(positiveInt(process.env.EBS_TRIAGE_MAX_BLOCKS, 4), 4),
    maxBlockChars: 100,
    maxTableChars: 180,
    paragraphsPerHeading: 1,
    maxOutlineItems: 4,
    maxOutlineChars: 32,
  });
  const navigationIndex = buildDocumentNavigationIndex(ir);
  return {
    prompt: `doc_id: ${ir.doc_id}
version_id: ${ir.version_id}

Goal: find at most 3 key tasks for the user. Prefer these fields in order: execution_steps, judgment_basis, judgment_criteria, tool_templates. Use the navigation index to scan the whole document structure, then use selected key blocks for detail. Do not map all fields. Return at most 3 major_gaps, 3 recommended_tasks, 3 suggested_questions. Keep each message/reason/question concise.
JSON keys: summary, major_gaps[{field_key,severity,message,source_refs[{block_id}]}], recommended_tasks[{title,reason,question,target_field,source_block_ids,priority}], suggested_questions[{question,target_field,source_block_ids}], source_refs[{block_id}].
Every recommended task must include target_field or at least one valid source_block_id from the navigation index.

${navigationIndex}

Compact document context:
${context.text}`,
    context,
  };
}

export function buildStructuringPromptInput(
  ir: DocumentIR,
  knowledgeSkeleton?: unknown,
): {
  prompt: string;
  context: CompactDocumentContext;
} {
  const skeleton =
    knowledgeSkeleton === undefined
      ? "(not available)"
      : typeof knowledgeSkeleton === "string"
        ? knowledgeSkeleton
        : JSON.stringify(knowledgeSkeleton, null, 2);
  const context = buildCompactDocumentContext(ir, {
    maxBlocks: Math.min(positiveInt(process.env.EBS_STRUCTURING_MAX_BLOCKS, 80), 24),
    maxBlockChars: Math.min(
      positiveInt(process.env.EBS_STRUCTURING_MAX_BLOCK_CHARS, 900),
      500,
    ),
    maxTableChars: Math.min(
      positiveInt(process.env.EBS_STRUCTURING_MAX_TABLE_CHARS, 1800),
      1000,
    ),
    paragraphsPerHeading: 1,
    maxOutlineItems: 28,
    maxOutlineChars: 100,
  });
  return {
    prompt: `doc_id: ${ir.doc_id}
version_id: ${ir.version_id}

Phase A knowledge skeleton:
${skeleton}

Phase B task:
Map the skeleton and selected source blocks into BusinessDocStructuredDraft JSON. Use exact block_id values in source_refs. If a needed detail is absent from selected blocks, record it in gaps_structured rather than inventing it.

Document IR compact context:
${context.text}`,
    context,
  };
}

export function buildStructuringUserPrompt(
  ir: DocumentIR,
  knowledgeSkeleton?: unknown,
): string {
  return buildStructuringPromptInput(ir, knowledgeSkeleton).prompt;
}
