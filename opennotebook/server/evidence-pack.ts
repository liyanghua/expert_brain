import type { DocumentIR } from "@ebs/document-ir";
import {
  FIELD_DEFINITIONS_ZH,
  STRUCTURED_FIELD_KEYS,
  emptyGroundTruthDraft,
  type GroundTruthDraft,
  type GroundTruthFieldItem,
  type StructuredFieldKey,
} from "@ebs/ground-truth-schema";
import type { RetrievalIndexEntry } from "./retrieval.js";
import type { MultimodalSourceNode, SourceViewModel } from "./workbench.js";
import { fieldCompletionCriteria } from "./workbench.js";

export type NotebookDocumentUnderstanding = {
  summary: string;
  section_roles: Array<{
    section_id: string;
    title: string;
    role: "overview" | "procedure" | "criteria" | "tooling" | "evidence" | "other";
  }>;
  process_spine: string[];
  evidence_dense_block_ids: string[];
  weak_signal_block_ids: string[];
};

export type NotebookContentListItem = {
  id: string;
  block_id: string;
  node_type: "text" | "table" | "image" | "equation" | "outline";
  title?: string;
  text?: string;
  media_uri?: string;
  source_file: string;
  source_span?: string;
  page_no?: number | null;
  sheet_name?: string | null;
  node_path?: string | null;
  hierarchy_path: string[];
};

export type NotebookEvidencePackBlock = {
  block_id: string;
  block_type: string;
  text_excerpt: string;
  source_file: string;
  source_span?: string;
  media_uri?: string;
  origin: "manual" | "retrieval";
  score: number;
};

export type NotebookEvidencePack = {
  doc_id: string;
  version_id: string;
  field_key?: StructuredFieldKey | null;
  blocks: NotebookEvidencePackBlock[];
  manual_block_ids: string[];
  retrieval_block_ids: string[];
  summary: string;
  related_structured_items: Array<{
    field_key: StructuredFieldKey;
    content: unknown;
    status?: string;
  }>;
  completion_criteria: string;
  parse_mode: string;
  retrieval_mode: string;
  fallback_reason?: string | null;
  context_budget: {
    manual_limit: number;
    retrieval_limit: number;
    summary_slots: number;
    draft_slots: number;
  };
  stats: {
    total_blocks: number;
    manual_blocks: number;
    retrieval_blocks: number;
  };
};

export function buildContentListFromIr(ir: DocumentIR): NotebookContentListItem[] {
  const hierarchy: string[] = [];
  return ir.blocks.map((block) => {
    if (block.block_type === "heading" || block.block_type === "outline") {
      hierarchy.length = Math.max(0, (block.heading_level ?? 1) - 1);
      hierarchy.push(block.text_content);
    }

    return {
      id: block.block_id,
      block_id: block.block_id,
      node_type:
        block.block_type === "table"
          ? "table"
          : block.block_type === "image"
            ? "image"
            : block.block_type === "heading" || block.block_type === "outline"
              ? "outline"
              : "text",
      title:
        block.block_type === "heading" || block.block_type === "outline"
          ? block.text_content
          : undefined,
      text: block.text_content,
      media_uri: block.media_uri,
      source_file: block.source_file,
      source_span: block.source_span ?? undefined,
      page_no: block.page_no ?? null,
      sheet_name: block.sheet_name ?? null,
      node_path: block.node_path ?? null,
      hierarchy_path: [...hierarchy],
    };
  });
}

function sectionRole(title: string, blockIds: string[], retrievalIndex: RetrievalIndexEntry[]) {
  const joined = [
    title,
    ...blockIds.map((blockId) => retrievalIndex.find((item) => item.block_id === blockId)?.text ?? ""),
  ]
    .join("\n")
    .slice(0, 800)
    .toLowerCase();

  if (/步骤|流程|首先|然后|最后|执行/.test(joined)) return "procedure" as const;
  if (/标准|阈值|条件|通过|异常|指标/.test(joined)) return "criteria" as const;
  if (/表单|模板|工具|记录表|截图/.test(joined)) return "tooling" as const;
  if (/证据|截图|页面|数据|标签|地址/.test(joined)) return "evidence" as const;
  if (/总览|概述|说明|背景|目标/.test(joined)) return "overview" as const;
  return "other" as const;
}

export function buildDocumentUnderstanding(input: {
  ir: DocumentIR;
  sourceView: SourceViewModel;
  retrievalIndex: RetrievalIndexEntry[];
}): NotebookDocumentUnderstanding {
  const section_roles = input.sourceView.sections.map((section) => ({
    section_id: section.section_id,
    title: section.title,
    role: sectionRole(section.title, section.block_ids, input.retrievalIndex),
  }));

  const evidence_dense_block_ids = [...input.retrievalIndex]
    .map((entry) => ({
      block_id: entry.block_id,
      score: Object.values(entry.keyword_scores).reduce((sum, item) => sum + item, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => entry.block_id);

  const weak_signal_block_ids = input.ir.blocks
    .filter((block) => block.text_content.length < 24)
    .slice(0, 6)
    .map((block) => block.block_id);

  const process_spine = input.ir.blocks
    .filter((block) => /步骤|流程|首先|然后|最后|执行/.test(block.text_content))
    .slice(0, 6)
    .map((block) => block.text_content.slice(0, 90));

  const summaryParts = [
    section_roles.length > 0
      ? `文档包含 ${section_roles.length} 个主要章节：${section_roles
          .slice(0, 4)
          .map((item) => item.title)
          .join("、")}。`
      : "文档章节结构较弱。",
    process_spine.length > 0
      ? `主流程线索包括：${process_spine.slice(0, 3).join("；")}。`
      : "未识别出明确的主流程线索。",
    evidence_dense_block_ids.length > 0
      ? `证据密集区主要集中在 ${evidence_dense_block_ids.join("、")}。`
      : "尚未识别到证据密集区。",
  ];

  return {
    summary: summaryParts.join(" "),
    section_roles,
    process_spine,
    evidence_dense_block_ids,
    weak_signal_block_ids,
  };
}

function itemText(item: GroundTruthFieldItem) {
  if (typeof item.content === "string") return item.content;
  if (item.content && typeof item.content === "object" && "text" in item.content) {
    const text = (item.content as { text?: unknown }).text;
    return typeof text === "string" ? text : JSON.stringify(item.content);
  }
  return JSON.stringify(item.content);
}

function relatedDraftItems(
  draft: GroundTruthDraft,
  fieldKey: StructuredFieldKey | null | undefined,
  blockIds: string[],
) {
  if (blockIds.length === 0) return [];
  const blockIdSet = new Set(blockIds);
  const keys = fieldKey ? [fieldKey] : STRUCTURED_FIELD_KEYS;
  const related: Array<{ field_key: StructuredFieldKey; content: unknown; status?: string }> = [];
  for (const key of keys) {
    const raw = draft[key];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const item of items) {
      const refs = item.source_refs ?? [];
      if (refs.some((ref) => ref.block_id && blockIdSet.has(ref.block_id))) {
        related.push({
          field_key: key,
          content: item.content,
          status: item.status,
        });
      }
    }
  }
  return related.slice(0, 3);
}

function nodeMap(sourceView: SourceViewModel) {
  return new Map(sourceView.nodes.map((node) => [node.block_id, node] as const));
}

function blockForNode(node: MultimodalSourceNode): NotebookEvidencePackBlock {
  return {
    block_id: node.block_id,
    block_type: node.block_type,
    text_excerpt: node.text_excerpt,
    source_file: node.source_ref.source_file,
    source_span: node.source_ref.source_span,
    media_uri: node.media_uri,
    origin: "manual",
    score: 100,
  };
}

function blockFromRetrieval(
  entry: RetrievalIndexEntry,
  sourceView: SourceViewModel,
): NotebookEvidencePackBlock {
  const node = sourceView.nodes.find((item) => item.block_id === entry.block_id);
  return {
    block_id: entry.block_id,
    block_type: entry.block_type,
    text_excerpt: node?.text_excerpt ?? entry.text.slice(0, 240),
    source_file: entry.source_file,
    source_span: entry.source_span,
    media_uri: node?.media_uri,
    origin: "retrieval",
    score: Math.max(...Object.values(entry.keyword_scores), 0),
  };
}

export function buildEvidencePack(input: {
  docId: string;
  versionId: string;
  ir: DocumentIR;
  draft: GroundTruthDraft | null;
  fieldKey?: StructuredFieldKey | null;
  manualBlockIds: string[];
  retrievalHits: RetrievalIndexEntry[];
  sourceView: SourceViewModel;
  documentUnderstanding: NotebookDocumentUnderstanding;
  parseMode: string;
  retrievalMode: string;
  fallbackReason?: string | null;
}): NotebookEvidencePack {
  const manualLimit = 2;
  const retrievalLimit = input.fieldKey ? 6 : 4;
  const nodes = nodeMap(input.sourceView);
  const selectedBlocks: NotebookEvidencePackBlock[] = [];
  const seen = new Set<string>();

  for (const blockId of input.manualBlockIds.slice(0, manualLimit)) {
    const node = nodes.get(blockId);
    if (!node || seen.has(blockId)) continue;
    seen.add(blockId);
    selectedBlocks.push(blockForNode(node));
  }

  for (const hit of input.retrievalHits) {
    if (selectedBlocks.filter((item) => item.origin === "retrieval").length >= retrievalLimit) break;
    if (seen.has(hit.block_id)) continue;
    seen.add(hit.block_id);
    selectedBlocks.push(blockFromRetrieval(hit, input.sourceView));
  }

  const completion_criteria = input.fieldKey
    ? `${FIELD_DEFINITIONS_ZH[input.fieldKey].label}：${fieldCompletionCriteria(input.fieldKey)}`
    : "至少形成一条可供专家追问、回答并候选写回的任务路径。";
  const draftValue = input.draft ?? emptyGroundTruthDraft(input.docId, input.versionId);
  const related_structured_items = relatedDraftItems(
    draftValue,
    input.fieldKey,
    selectedBlocks.map((item) => item.block_id),
  );

  return {
    doc_id: input.docId,
    version_id: input.versionId,
    field_key: input.fieldKey ?? null,
    blocks: selectedBlocks,
    manual_block_ids: selectedBlocks
      .filter((item) => item.origin === "manual")
      .map((item) => item.block_id),
    retrieval_block_ids: selectedBlocks
      .filter((item) => item.origin === "retrieval")
      .map((item) => item.block_id),
    summary: input.documentUnderstanding.summary,
    related_structured_items,
    completion_criteria,
    parse_mode: input.parseMode,
    retrieval_mode: input.retrievalMode,
    fallback_reason: input.fallbackReason ?? null,
    context_budget: {
      manual_limit: manualLimit,
      retrieval_limit: retrievalLimit,
      summary_slots: 1,
      draft_slots: 1,
    },
    stats: {
      total_blocks: selectedBlocks.length,
      manual_blocks: selectedBlocks.filter((item) => item.origin === "manual").length,
      retrieval_blocks: selectedBlocks.filter((item) => item.origin === "retrieval").length,
    },
  };
}

export function buildScopedStructuringIr(input: {
  docId: string;
  versionId: string;
  fieldKey: StructuredFieldKey;
  originalIr: DocumentIR;
  evidencePack: NotebookEvidencePack;
}): DocumentIR {
  const blocks = input.evidencePack.blocks
    .map((item) => {
      const original = input.originalIr.blocks.find((block) => block.block_id === item.block_id);
      return original ?? null;
    })
    .filter((item): item is DocumentIR["blocks"][number] => item !== null)
    .slice(0, 8);

  const syntheticBlocks: DocumentIR["blocks"] = [
    {
      block_id: "understanding-summary",
      block_type: "paragraph",
      text_content: `字段：${FIELD_DEFINITIONS_ZH[input.fieldKey].label}\n全文理解：${input.evidencePack.summary}\n完成标准：${input.evidencePack.completion_criteria}`,
      heading_level: 0,
      source_file: "synthetic:document_understanding",
      source_span: "summary",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    },
  ];

  for (const related of input.evidencePack.related_structured_items.slice(0, 1)) {
    syntheticBlocks.push({
      block_id: `draft-${related.field_key}`,
      block_type: "paragraph",
      text_content: `相关结构化字段 ${related.field_key}：${
        typeof related.content === "string" ? related.content : JSON.stringify(related.content)
      }`,
      heading_level: 0,
      source_file: "synthetic:draft_slice",
      source_span: related.field_key,
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    });
  }

  return {
    doc_id: input.docId,
    version_id: input.versionId,
    blocks: [...syntheticBlocks, ...blocks],
  };
}
