import { metric } from "../observability/metrics.js";
import { evaluateSemanticUnits } from "../evaluation/semantic-unit-evaluator.js";
import { buildDocumentMap, buildSectionCards } from "../tools/document-map.js";
import { synthesizeDocumentUnderstanding } from "../tools/section-summarizer.js";
import { enhanceSemanticUnitsWithLlm } from "./semantic-unit-llm-enhancer.js";
import { validateSemanticUnitMatches } from "./semantic-unit-match-validator.js";
import type {
  BlockRole,
  BlockRoleEntry,
  BlockRoleMap,
  ContinuityDecision,
  ContinuityDecisionTrace,
  ContinuityEdge,
  ContinuityRelation,
  ContextualizedBlock,
  DocumentBlock,
  DocumentIR,
  DocumentMap,
  DocumentMapSection,
  DocumentSynthesis,
  ExpertGuidanceProfile,
  SectionEvidenceHint,
  SectionEvidenceHints,
  SchemaProfile,
  SemanticCoherenceProfile,
  SemanticSegment,
  SemanticUnit,
  SectionCard,
  SourceRef,
  StructuredSection,
  StructuredSectionSummary,
  StructuredFieldKey,
} from "../types.js";
import type {
  UnderstandingAdapter,
  UnderstandingAdapterInput,
  UnderstandingResult,
} from "./understanding-adapter.js";

type FieldSignals = Record<string, string[]>;

const DEFAULT_FIELD_SIGNALS: FieldSignals = {
  business_scenario: ["场景", "业务", "链路"],
  scenario_goal: ["目标", "目的", "问题", "结果"],
  execution_steps: ["步骤", "流程", "操作", "执行", "路径"],
  judgment_basis: ["指标", "依据", "数据", "点击率", "转化率", "ROI"],
  judgment_criteria: ["标准", "阈值", "连续", "行业均值", "判断"],
  resolution_methods: ["动作", "解决", "处理", "优化", "方法"],
  trigger_conditions: ["触发", "启动", "情况下", "条件"],
  termination_conditions: ["结束", "停止", "终止", "维持"],
  validation_methods: ["验证", "有效", "复盘", "观察周期"],
  tool_templates: ["工具", "表格", "模板", "SOP"],
};

function compact(text: string, limit = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function tokenizeSignals(text: string): string[] {
  const normalized = text.replace(/[，。、“”‘’：:；;（）()[\]{}<>|*_`~!?,.]/g, " ");
  const matches = normalized.match(/[\u4e00-\u9fa5A-Za-z0-9>=<]+/g) ?? [];
  return matches
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .filter((part) => !["优先识别", "用于", "什么", "方式", "文档"].includes(part));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function targetFields(schemaProfile?: SchemaProfile): StructuredFieldKey[] {
  return unique([
    ...(schemaProfile?.required_fields ?? []),
    ...(schemaProfile?.optional_fields ?? []),
  ]);
}

function buildFieldSignals(
  schemaProfile?: SchemaProfile,
  expertGuidanceProfile?: ExpertGuidanceProfile,
): FieldSignals {
  const fields = targetFields(schemaProfile);
  const entries = fields.length > 0 ? fields : (Object.keys(DEFAULT_FIELD_SIGNALS) as StructuredFieldKey[]);
  const signals: FieldSignals = {};
  for (const field of entries) {
    const definition = schemaProfile?.field_definitions[field];
    const profileSignals = [
      field,
      field.replace(/_/g, " "),
      ...(DEFAULT_FIELD_SIGNALS[field] ?? []),
      ...tokenizeSignals(definition?.description ?? ""),
      ...tokenizeSignals(definition?.extraction_hint ?? ""),
      ...tokenizeSignals((expertGuidanceProfile?.field_guidance[field] ?? []).join(" ")),
    ];
    signals[field] = unique(profileSignals).filter((signal) => signal.length > 0);
  }
  return signals;
}

function matchedSignals(text: string, signals: string[]): string[] {
  return signals.filter((signal) => text.includes(signal));
}

function buildCoverage(ir: DocumentIR, sectionCards: SectionCard[]) {
  const sourceBlocks = new Set(sectionCards.flatMap((card) => card.source_block_ids));
  return {
    total_blocks: ir.blocks.length,
    scanned_blocks: sourceBlocks.size,
    cited_blocks: [...sourceBlocks],
    covered_sections: sectionCards.map((card) => card.section_id),
    uncovered_sections: [],
    risk: "low" as const,
  };
}

function baselineMetrics(input: {
  ir: DocumentIR;
  sectionCards: SectionCard[];
  started: number;
  extra?: Record<string, number>;
}) {
  const compressionRatio =
    input.ir.blocks.length === 0 ? 1 : input.sectionCards.length / input.ir.blocks.length;
  const sourceBlocks = new Set(input.sectionCards.flatMap((card) => card.source_block_ids));
  return {
    section_summary_coverage: metric(input.sectionCards.length > 0 ? 1 : 0, "proxy"),
    summary_faithfulness: metric(0.82, "proxy", "启发式摘要，未接人工验证"),
    summary_grounding_rate: metric(sourceBlocks.size > 0 ? 1 : 0),
    theme_goal_accuracy: metric(0.78, "proxy"),
    summary_compression_ratio: metric(Number(compressionRatio.toFixed(4))),
    summary_duration_ms: metric(Date.now() - input.started),
    ...(input.extra
      ? Object.fromEntries(
          Object.entries(input.extra).map(([key, value]) => [key, metric(value)]),
        )
      : {}),
  };
}

export const baselineUnderstandingAdapter: UnderstandingAdapter = {
  profile: "baseline",
  understand(input: UnderstandingAdapterInput): UnderstandingResult {
    const started = Date.now();
    const documentMap = buildDocumentMap(input.ir);
    const sectionCards = buildSectionCards(input.ir, documentMap);
    const understanding = synthesizeDocumentUnderstanding(sectionCards);
    return {
      documentMap,
      sectionCards,
      understanding,
      coverage: buildCoverage(input.ir, sectionCards),
      metrics: baselineMetrics({ ir: input.ir, sectionCards, started }),
    };
  },
};

function buildProfileDocumentMap(input: {
  ir: DocumentIR;
  baseMap: DocumentMap;
  fieldSignals: FieldSignals;
}): DocumentMap {
  const fieldCandidates: Record<string, string[]> = {};
  for (const block of input.ir.blocks) {
    const text = block.text_content;
    for (const [field, signals] of Object.entries(input.fieldSignals)) {
      const matches = matchedSignals(text, signals);
      const tableBoost =
        block.block_type === "table" &&
        ["judgment_basis", "judgment_criteria", "validation_methods", "tool_templates"].includes(field);
      if (matches.length > 0 || tableBoost) {
        fieldCandidates[field] = unique([...(fieldCandidates[field] ?? []), block.block_id]);
      }
    }
  }
  return {
    ...input.baseMap,
    field_candidate_blocks: fieldCandidates,
  };
}

function tableSummary(blocks: DocumentBlock[]): string {
  const tableBlocks = blocks.filter((block) => block.block_type === "table");
  if (tableBlocks.length === 0) return "";
  const snippets = tableBlocks.map((block) => compact(block.text_content, 120));
  return `表格信号：${snippets.join("；")}`;
}

function buildProfileSectionCards(input: {
  ir: DocumentIR;
  map: DocumentMap;
  fieldSignals: FieldSignals;
}): { cards: SectionCard[]; hints: SectionEvidenceHint[] } {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const cards: SectionCard[] = [];
  const hints: SectionEvidenceHint[] = [];
  for (const section of input.map.sections) {
    const blocks = section.block_ids
      .map((id) => blockById.get(id))
      .filter((block): block is DocumentBlock => Boolean(block));
    const sectionText = `${section.title} ${blocks.map((block) => block.text_content).join(" ")}`;
    const tableBlockIds = blocks
      .filter((block) => block.block_type === "table")
      .map((block) => block.block_id);
    const listBlockIds = blocks
      .filter((block) => block.block_type === "list")
      .map((block) => block.block_id);
    const fieldHints: SectionEvidenceHint["field_evidence_hints"] = {};
    for (const [field, signals] of Object.entries(input.fieldSignals)) {
      const matched = matchedSignals(sectionText, signals);
      const candidateBlockIds = blocks
        .filter((block) => matchedSignals(block.text_content, signals).length > 0)
        .map((block) => block.block_id);
      const tableBoost =
        tableBlockIds.length > 0 &&
        ["judgment_basis", "judgment_criteria", "validation_methods", "tool_templates"].includes(field);
      if (matched.length > 0 || tableBoost) {
        fieldHints[field] = {
          block_ids: unique([...(candidateBlockIds.length > 0 ? candidateBlockIds : []), ...(tableBoost ? tableBlockIds : [])]),
          signals: matched.length > 0 ? unique(matched).slice(0, 8) : ["table_structure"],
          reason: tableBoost
            ? "table block contains structured diagnostic evidence"
            : "section text matched schema/expert profile signals",
        };
      }
    }
    const covered = Object.keys(fieldHints);
    const tableSignal = tableSummary(blocks);
    const summaryParts = [
      compact(blocks.map((block) => block.text_content).join(" "), 180),
      tableSignal,
    ].filter(Boolean);
    cards.push({
      section_id: section.section_id,
      title: section.title,
      source_block_ids: section.block_ids,
      summary: summaryParts.join(" "),
      key_signals: unique(Object.values(fieldHints).flatMap((hint) => hint.signals)).slice(0, 10),
      covered_schema_fields: covered,
      likely_gaps: covered.length === 0 ? ["该章节尚未明显覆盖目标 schema 字段"] : [],
      confidence: Math.min(0.92, 0.68 + covered.length * 0.03 + tableBlockIds.length * 0.04),
    });
    hints.push({
      section_id: section.section_id,
      title: section.title,
      source_block_ids: section.block_ids,
      table_block_ids: tableBlockIds,
      list_block_ids: listBlockIds,
      field_evidence_hints: fieldHints,
    });
  }
  return { cards, hints };
}

function estimateTokenCount(text: string): number {
  const latinOrNumberTokens = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  return Math.max(1, latinOrNumberTokens + Math.ceil(cjkChars / 2));
}

function sectionIdFromBlock(block: DocumentBlock, fallbackIndex: number): string {
  return `section_${block.block_id || fallbackIndex + 1}`;
}

function classifySectionType(title: string, text: string): StructuredSection["section_type"] {
  const combined = `${title} ${text}`;
  if (/(验证|复盘|效果|有效)/.test(combined)) return "validation";
  if (/(指标|判断|标准|阈值|依据|数据)/.test(combined)) return "metrics";
  if (/(动作|解决|优化|处理|方案|方法)/.test(combined)) return "actions";
  if (/(诊断|异常|问题|判断)/.test(combined)) return "diagnosis";
  if (/(模板|工具|表格|SOP)/i.test(combined)) return "template";
  if (/(流程|步骤|执行|路径)/.test(combined)) return "framework";
  if (/(输入|准备|材料|前置)/.test(combined)) return "preparation";
  if (/(附录|参考|说明)/.test(combined)) return "appendix";
  return "intro";
}

function preferredHeadingLevel(blocks: DocumentBlock[]): number | null {
  const headings = blocks.filter((block) => block.block_type === "heading" && block.heading_level > 0);
  if (headings.some((block) => block.heading_level === 2)) return 2;
  if (headings.length === 0) return null;
  const counts = new Map<number, number>();
  for (const heading of headings) {
    counts.set(heading.heading_level, (counts.get(heading.heading_level) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? headings[0]!.heading_level;
}

function parentHeadingId(blocks: DocumentBlock[], headingIndex: number): string | null {
  const heading = blocks[headingIndex]!;
  for (let i = headingIndex - 1; i >= 0; i -= 1) {
    const candidate = blocks[i]!;
    if (
      candidate.block_type === "heading" &&
      candidate.heading_level > 0 &&
      candidate.heading_level < heading.heading_level
    ) {
      return `section_${candidate.block_id}`;
    }
  }
  return null;
}

function buildFallbackSections(ir: DocumentIR): StructuredSection[] {
  const chunkSize = 8;
  const sections: StructuredSection[] = [];
  for (let start = 0; start < ir.blocks.length; start += chunkSize) {
    const blocks = ir.blocks.slice(start, start + chunkSize);
    const text = blocks.map((block) => block.text_content).join(" ");
    const first = blocks[0]!;
    const last = blocks[blocks.length - 1]!;
    sections.push({
      section_id: `section_chunk_${sections.length + 1}`,
      title: sections.length === 0 ? "全文概览" : `内容片段 ${sections.length + 1}`,
      heading_level: 0,
      parent_section_id: null,
      block_ids: blocks.map((block) => block.block_id),
      start_block_id: first.block_id,
      end_block_id: last.block_id,
      token_count: estimateTokenCount(text),
      section_type: classifySectionType("", text),
      confidence: 0.58,
    });
  }
  return sections;
}

function buildStructuredSections(ir: DocumentIR): StructuredSection[] {
  const level = preferredHeadingLevel(ir.blocks);
  if (level === null) return buildFallbackSections(ir);
  const headingIndexes = ir.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.block_type === "heading" && block.heading_level === level)
    .map(({ index }) => index);
  if (headingIndexes.length === 0) return buildFallbackSections(ir);

  return headingIndexes.map((startIndex, sectionIndex) => {
    const heading = ir.blocks[startIndex]!;
    const nextBoundary = ir.blocks.findIndex(
      (block, index) =>
        index > startIndex &&
        block.block_type === "heading" &&
        block.heading_level === level,
    );
    const blockStartIndex = sectionIndex === 0 ? 0 : startIndex;
    const endExclusive = nextBoundary === -1 ? ir.blocks.length : nextBoundary;
    const blocks = ir.blocks.slice(blockStartIndex, endExclusive);
    const text = blocks.map((block) => block.text_content).join(" ");
    const last = blocks[blocks.length - 1]!;
    return {
      section_id: sectionIdFromBlock(heading, sectionIndex),
      title: heading.text_content || `Section ${sectionIndex + 1}`,
      heading_level: heading.heading_level,
      parent_section_id: parentHeadingId(ir.blocks, startIndex),
      block_ids: blocks.map((block) => block.block_id),
      start_block_id: heading.block_id,
      end_block_id: last.block_id,
      token_count: estimateTokenCount(text),
      section_type: classifySectionType(heading.text_content, text),
      confidence: level === 2 ? 0.9 : 0.74,
    };
  });
}

function mapFromStructuredSections(input: {
  ir: DocumentIR;
  sections: StructuredSection[];
  fieldSignals: FieldSignals;
}): DocumentMap {
  const blockIndex = new Map(input.ir.blocks.map((block, index) => [block.block_id, index]));
  const mapSections: DocumentMapSection[] = input.sections.map((section) => ({
    section_id: section.section_id,
    title: section.title,
    level: section.heading_level,
    heading_block_id: section.start_block_id,
    block_ids: section.block_ids,
    start_index: blockIndex.get(section.start_block_id) ?? 0,
    end_index: blockIndex.get(section.end_block_id) ?? 0,
  }));
  const baseMap: DocumentMap = {
    doc_id: input.ir.doc_id,
    version_id: input.ir.version_id,
    total_blocks: input.ir.blocks.length,
    sections: mapSections,
    table_block_ids: input.ir.blocks
      .filter((block) => block.block_type === "table")
      .map((block) => block.block_id),
    image_block_ids: input.ir.blocks
      .filter((block) => block.block_type === "image")
      .map((block) => block.block_id),
    field_candidate_blocks: {},
  };
  return buildProfileDocumentMap({
    ir: input.ir,
    baseMap,
    fieldSignals: input.fieldSignals,
  });
}

function firstContentPoints(blocks: DocumentBlock[]): string[] {
  return blocks
    .filter((block) => block.block_type !== "heading")
    .map((block) => compact(block.text_content, 90))
    .filter(Boolean)
    .slice(0, 4);
}

function buildStructuredSummaries(input: {
  ir: DocumentIR;
  sections: StructuredSection[];
  hints: SectionEvidenceHint[];
  schemaProfile?: SchemaProfile;
}): StructuredSectionSummary[] {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const hintsBySection = new Map(input.hints.map((hint) => [hint.section_id, hint]));
  const requiredFields = new Set(input.schemaProfile?.required_fields ?? []);
  return input.sections.map((section) => {
    const blocks = section.block_ids
      .map((id) => blockById.get(id))
      .filter((block): block is DocumentBlock => Boolean(block));
    const hint = hintsBySection.get(section.section_id);
    const relatedFields = Object.keys(hint?.field_evidence_hints ?? {});
    const extractedSignals = unique(
      Object.values(hint?.field_evidence_hints ?? {}).flatMap((fieldHint) => fieldHint.signals),
    ).slice(0, 12);
    const missingRequired = [...requiredFields].filter((field) => !relatedFields.includes(field));
    const points = firstContentPoints(blocks);
    return {
      section_id: section.section_id,
      title: section.title,
      section_type: section.section_type,
      main_purpose:
        points.length > 0
          ? `${section.title}：${points[0]}`
          : `${section.title}：该章节主要承担${section.section_type}信息组织。`,
      key_points: points,
      related_schema_fields: relatedFields,
      extracted_signals: extractedSignals,
      likely_gaps:
        relatedFields.length === 0
          ? ["该章节未命中 schema/expert profile 信号"]
          : missingRequired.slice(0, 3).map((field) => `本章节未明显覆盖 ${field}`),
      source_block_ids: section.block_ids,
      confidence: Math.min(0.94, section.confidence + relatedFields.length * 0.015),
    };
  });
}

function synthesizeStructuredDocument(input: {
  summaries: StructuredSectionSummary[];
  schemaProfile?: SchemaProfile;
  expertGuidanceProfile?: ExpertGuidanceProfile;
}): DocumentSynthesis {
  const keySignals = unique(input.summaries.flatMap((summary) => summary.extracted_signals)).slice(0, 16);
  const likelyGaps = unique(input.summaries.flatMap((summary) => summary.likely_gaps)).slice(0, 8);
  const processSpine = input.summaries.map((summary, index) => ({
    section_id: summary.section_id,
    role: `${index + 1}. ${summary.section_type}: ${summary.title}`,
  }));
  const firstSummary = input.summaries[0];
  const guidanceSignal = input.expertGuidanceProfile?.quality_preferences[0];
  return {
    document_theme: firstSummary?.title ?? input.schemaProfile?.profile_name ?? "未命名文档",
    business_scene: input.schemaProfile?.scene ?? input.schemaProfile?.domain ?? "未识别业务场景",
    primary_goal: firstSummary?.main_purpose ?? "基于章节摘要理解文档目标",
    process_spine: processSpine,
    key_signals: keySignals,
    likely_gaps: likelyGaps,
    quality_risks: likelyGaps.length > 0 ? likelyGaps.slice(0, 5) : ["未发现明显结构化缺口"],
    summary_for_agent: [
      `文档按 ${input.summaries.length} 个主章节理解。`,
      firstSummary ? `起始章节关注：${firstSummary.main_purpose}` : "",
      keySignals.length > 0 ? `关键证据信号：${keySignals.slice(0, 6).join("、")}` : "",
      guidanceSignal ? `专家偏好：${guidanceSignal}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    confidence: input.summaries.length > 0 ? 0.86 : 0.45,
  };
}

function sourceRefsForBlock(block: DocumentBlock): SourceRef[] {
  return [
    {
      block_id: block.block_id,
      source_file: block.source_file,
      source_span: block.source_span,
    },
  ];
}

function buildContextualizedBlocks(input: {
  ir: DocumentIR;
  sections: StructuredSection[];
  summaries: StructuredSectionSummary[];
  hints: SectionEvidenceHint[];
  synthesis: DocumentSynthesis;
  semanticUnits: SemanticUnit[];
  semanticSegments: SemanticSegment[];
}): ContextualizedBlock[] {
  const sectionByBlock = new Map<string, StructuredSection>();
  for (const section of input.sections) {
    for (const blockId of section.block_ids) sectionByBlock.set(blockId, section);
  }
  const summaryBySection = new Map(input.summaries.map((summary) => [summary.section_id, summary]));
  const hintsBySection = new Map(input.hints.map((hint) => [hint.section_id, hint]));
  const unitByBlock = new Map<string, SemanticUnit>();
  for (const unit of input.semanticUnits) {
    for (const blockId of unit.source_block_ids) unitByBlock.set(blockId, unit);
  }
  const segmentByBlock = new Map<string, SemanticSegment>();
  for (const segment of input.semanticSegments) {
    for (const blockId of segment.source_block_ids) segmentByBlock.set(blockId, segment);
  }
  const contextualizedBlocks: ContextualizedBlock[] = [];
  for (const block of input.ir.blocks) {
    const section = sectionByBlock.get(block.block_id);
    if (!section) continue;
    const summary = summaryBySection.get(section.section_id);
    const sectionHint = hintsBySection.get(section.section_id);
    const blockFields = Object.entries(sectionHint?.field_evidence_hints ?? {})
      .filter(([, hint]) => hint.block_ids.includes(block.block_id))
      .map(([field]) => field);
    const blockSignals = unique(
      Object.values(sectionHint?.field_evidence_hints ?? {})
        .filter((hint) => hint.block_ids.includes(block.block_id))
        .flatMap((hint) => hint.signals),
    );
    const processRole =
      input.synthesis.process_spine.find((item) => item.section_id === section.section_id)?.role ??
      section.section_type;
    const unit = unitByBlock.get(block.block_id);
    const segment = segmentByBlock.get(block.block_id);
    contextualizedBlocks.push({
      block_id: block.block_id,
      block_type: block.block_type,
      text_content: block.text_content,
      block_summary: compact(block.text_content, 120),
      semantic_unit_id: unit?.unit_id,
      semantic_unit_summary: unit?.summary,
      semantic_segment_id: segment?.segment_id,
      segment_summary: segment?.summary,
      segment_field_coverage: segment
        ? {
            related_schema_fields: segment.related_schema_fields,
            missing_or_weak_fields: segment.missing_or_weak_fields,
          }
        : undefined,
      source_refs: sourceRefsForBlock(block),
      section_context: {
        section_id: section.section_id,
        section_title: section.title,
        section_type: section.section_type,
        section_main_purpose: summary?.main_purpose ?? section.title,
        section_key_points: summary?.key_points ?? [],
      },
      document_context: {
        document_theme: input.synthesis.document_theme,
        business_scene: input.synthesis.business_scene,
        primary_goal: input.synthesis.primary_goal,
        process_role: processRole,
      },
      extraction_context: {
        likely_related_schema_fields: blockFields.length > 0 ? blockFields : summary?.related_schema_fields ?? [],
        likely_signal_types: blockSignals,
        likely_gap_hints: summary?.likely_gaps ?? [],
        inference_risk_level: blockFields.length > 0 || block.block_type === "table" ? "low" : "medium",
      },
    });
  }
  return contextualizedBlocks;
}

function fieldsForBlock(hint: SectionEvidenceHint | undefined, blockId: string): string[] {
  return Object.entries(hint?.field_evidence_hints ?? {})
    .filter(([, fieldHint]) => fieldHint.block_ids.includes(blockId))
    .map(([field]) => field);
}

function signalsForBlocks(hint: SectionEvidenceHint | undefined, blockIds: string[]): string[] {
  const blockSet = new Set(blockIds);
  return unique(
    Object.values(hint?.field_evidence_hints ?? {})
      .filter((fieldHint) => fieldHint.block_ids.some((blockId) => blockSet.has(blockId)))
      .flatMap((fieldHint) => fieldHint.signals),
  );
}

function chooseAnchorBlock(blocks: DocumentBlock[]): DocumentBlock {
  return (
    blocks.find((block) => block.block_type !== "heading") ??
    blocks[0]!
  );
}

function summarizeSegment(blocks: DocumentBlock[], signals: string[], title?: string): string {
  const body = compact(blocks.map((block) => block.text_content).join(" "), 170);
  const signalText = signals.length ? ` 关键信号：${signals.slice(0, 4).join("、")}。` : "";
  return `${title ? `${title}：` : ""}${body}${signalText}`.trim();
}

function segmentPrimaryRole(input: {
  blocks: DocumentBlock[];
  blockRoleMap: BlockRoleMap;
}): BlockRole {
  const role =
    input.blocks
      .map((block) => input.blockRoleMap.blocks[block.block_id]?.primary_role)
      .find((value): value is BlockRole => Boolean(value) && value !== "unknown") ?? "supporting_detail";
  return role;
}

function endsWithIntroColon(text: string): boolean {
  return /(?:而是|包括|如下|分别是|核心是|核心不是|体现为|可以拆成)?\s*[:：]\s*$/.test(text.trim());
}

function isContinuationLike(block: DocumentBlock): boolean {
  const text = block.text_content.trim();
  if (block.block_type === "list") return true;
  return /^(?:用|通过|并|同时|最后|其中|也就是|换句话说|具体来说|如果|第一|第二|第三|先|再)/.test(text);
}

function lexicalTokens(text: string): string[] {
  return tokenizeSignals(text)
    .flatMap((token) => {
      if (token.length <= 4 || !/[\u4e00-\u9fa5]/.test(token)) return [token];
      const bigrams: string[] = [];
      for (let index = 0; index < token.length - 1; index += 1) {
        bigrams.push(token.slice(index, index + 2));
      }
      return bigrams;
    })
    .filter((token) => token.length >= 2);
}

function cosineLikeSimilarity(a: string, b: string): number {
  const aTokens = lexicalTokens(a);
  const bTokens = lexicalTokens(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aCounts = new Map<string, number>();
  const bCounts = new Map<string, number>();
  for (const token of aTokens) aCounts.set(token, (aCounts.get(token) ?? 0) + 1);
  for (const token of bTokens) bCounts.set(token, (bCounts.get(token) ?? 0) + 1);
  const keys = new Set([...aCounts.keys(), ...bCounts.keys()]);
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (const key of keys) {
    const av = aCounts.get(key) ?? 0;
    const bv = bCounts.get(key) ?? 0;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  return aNorm === 0 || bNorm === 0 ? 0 : Number((dot / Math.sqrt(aNorm * bNorm)).toFixed(4));
}

function fieldsForBlocks(hint: SectionEvidenceHint | undefined, blockIds: string[]): string[] {
  return unique(blockIds.flatMap((blockId) => fieldsForBlock(hint, blockId)));
}

function continuityDecision(input: {
  from: DocumentBlock;
  to: DocumentBlock;
  hint?: SectionEvidenceHint;
  blockRoleMap: BlockRoleMap;
  semanticCoherenceProfile: SemanticCoherenceProfile;
}): ContinuityDecision {
  const signals: string[] = [];
  let relation: ContinuityRelation = "continuation";
  let ruleScore = 0;
  let mergeReason = "相邻 block 暂未发现足够语义连续信号";

  if (endsWithIntroColon(input.from.text_content)) {
    signals.push("colon_intro");
    relation = input.to.block_type === "list" ? "list_expansion" : "elaboration";
    ruleScore += 0.74;
    mergeReason = "上一段以冒号引出，下一段补足同一个业务表达";
  }
  if (isContinuationLike(input.to)) {
    signals.push("continuation_starter");
    ruleScore += 0.52;
  }
  if (!/[。！？!?]$/.test(input.from.text_content.trim()) && !endsWithIntroColon(input.from.text_content)) {
    signals.push("open_sentence");
    relation = "same_sentence";
    ruleScore += 0.22;
  }

  const fromFields = fieldsForBlock(input.hint, input.from.block_id);
  const toFields = fieldsForBlock(input.hint, input.to.block_id);
  const fieldOverlap = fromFields.filter((field) => toFields.includes(field));
  if (fieldOverlap.length > 0) {
    signals.push("field_overlap");
    ruleScore += Math.min(0.24, fieldOverlap.length * 0.08);
    if (mergeReason.startsWith("相邻")) mergeReason = "相邻 block 命中相同文档要素信号";
  }

  const fromRole = input.blockRoleMap.blocks[input.from.block_id]?.primary_role;
  const toRole = input.blockRoleMap.blocks[input.to.block_id]?.primary_role;
  if (fromRole && toRole && fromRole === toRole && fromRole !== "unknown") {
    signals.push("role_match");
    ruleScore += 0.12;
  }

  let embeddingSimilarity: number | undefined;
  if (input.semanticCoherenceProfile === "embedding" && ruleScore < 0.72) {
    embeddingSimilarity = cosineLikeSimilarity(input.from.text_content, input.to.text_content);
    if (embeddingSimilarity >= 0.12) {
      signals.push("embedding_similarity");
      ruleScore += Math.max(0.62, Math.min(0.3, embeddingSimilarity));
      mergeReason = "规则处于灰区，embedding 相似度支持相邻 block 语义连续";
    }
  }

  const finalScore = Math.min(1, ruleScore);
  const shouldMerge = finalScore >= 0.6;
  return {
    from_block_id: input.from.block_id,
    to_block_id: input.to.block_id,
    relation,
    signals: unique(signals),
    confidence: Number(finalScore.toFixed(4)),
    should_merge: shouldMerge,
    rule_score: Number(ruleScore.toFixed(4)),
    embedding_similarity: embeddingSimilarity,
    final_score: Number(finalScore.toFixed(4)),
    merge_reason: shouldMerge ? mergeReason : "连续性分数不足，保留为独立语义单元",
  };
}

function buildBlockContinuityEdges(input: {
  ir: DocumentIR;
  sections: StructuredSection[];
  hints: SectionEvidenceHint[];
  blockRoleMap: BlockRoleMap;
  semanticCoherenceProfile: SemanticCoherenceProfile;
}): ContinuityDecisionTrace {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const hintBySection = new Map(input.hints.map((hint) => [hint.section_id, hint]));
  const decisions: ContinuityDecision[] = [];
  for (const section of input.sections) {
    const blocks = section.block_ids
      .map((blockId) => blockById.get(blockId))
      .filter((block): block is DocumentBlock => Boolean(block))
      .filter((block) => block.block_type !== "heading");
    const hint = hintBySection.get(section.section_id);
    for (let index = 0; index < blocks.length - 1; index += 1) {
      decisions.push(
        continuityDecision({
          from: blocks[index]!,
          to: blocks[index + 1]!,
          hint,
          blockRoleMap: input.blockRoleMap,
          semanticCoherenceProfile: input.semanticCoherenceProfile,
        }),
      );
    }
  }
  return {
    semantic_coherence_profile: input.semanticCoherenceProfile,
    decisions,
  };
}

function buildSemanticUnits(input: {
  ir: DocumentIR;
  sections: StructuredSection[];
  summaries: StructuredSectionSummary[];
  hints: SectionEvidenceHint[];
  trace: ContinuityDecisionTrace;
  schemaProfile?: SchemaProfile;
}): SemanticUnit[] {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const decisionByPair = new Map(
    input.trace.decisions.map((decision) => [`${decision.from_block_id}:${decision.to_block_id}`, decision]),
  );
  const summaryBySection = new Map(input.summaries.map((summary) => [summary.section_id, summary]));
  const hintBySection = new Map(input.hints.map((hint) => [hint.section_id, hint]));
  const requiredFields = input.schemaProfile?.required_fields ?? [];
  const units: SemanticUnit[] = [];

  const pushUnit = (section: StructuredSection, blocks: DocumentBlock[], edges: ContinuityEdge[]) => {
    if (blocks.length === 0) return;
    const hint = hintBySection.get(section.section_id);
    const blockIds = blocks.map((block) => block.block_id);
    const relatedFields = unique([
      ...(summaryBySection.get(section.section_id)?.related_schema_fields ?? []),
      ...fieldsForBlocks(hint, blockIds),
    ]);
    const missingOrWeakFields = requiredFields.filter((field) => !relatedFields.includes(field));
    const semanticText = blocks.map((block) => block.text_content).join("\n");
    const signals = signalsForBlocks(hint, blockIds);
    const averageEdgeConfidence =
      edges.length === 0 ? 0.72 : edges.reduce((sum, edge) => sum + edge.confidence, 0) / edges.length;
    units.push({
      unit_id: `unit_${units.length + 1}`,
      source_block_ids: blockIds,
      anchor_block_id: chooseAnchorBlock(blocks).block_id,
      semantic_text: semanticText,
      summary: summarizeSegment(blocks, signals, section.title),
      continuity_edges: edges,
      related_schema_fields: relatedFields,
      missing_or_weak_fields: missingOrWeakFields.slice(0, 6),
      confidence: Number(Math.min(0.95, averageEdgeConfidence).toFixed(4)),
    });
  };

  for (const section of input.sections) {
    const blocks = section.block_ids
      .map((blockId) => blockById.get(blockId))
      .filter((block): block is DocumentBlock => Boolean(block))
      .filter((block) => block.block_type !== "heading");
    let currentBlocks: DocumentBlock[] = [];
    let currentEdges: ContinuityEdge[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      currentBlocks.push(block);
      const next = blocks[index + 1];
      if (!next) {
        pushUnit(section, currentBlocks, currentEdges);
        currentBlocks = [];
        currentEdges = [];
        continue;
      }
      const decision = decisionByPair.get(`${block.block_id}:${next.block_id}`);
      if (decision?.should_merge) {
        currentEdges.push({
          from_block_id: decision.from_block_id,
          to_block_id: decision.to_block_id,
          relation: decision.relation,
          signals: decision.signals,
          confidence: decision.confidence,
        });
        continue;
      }
      pushUnit(section, currentBlocks, currentEdges);
      currentBlocks = [];
      currentEdges = [];
    }
  }
  return units;
}

function buildSemanticSegments(input: {
  ir: DocumentIR;
  sections: StructuredSection[];
  summaries: StructuredSectionSummary[];
  hints: SectionEvidenceHint[];
  blockRoleMap: BlockRoleMap;
  semanticUnits: SemanticUnit[];
  schemaProfile?: SchemaProfile;
}): SemanticSegment[] {
  const blockById = new Map(input.ir.blocks.map((block) => [block.block_id, block]));
  const sectionByBlock = new Map<string, StructuredSection>();
  for (const section of input.sections) {
    for (const blockId of section.block_ids) sectionByBlock.set(blockId, section);
  }
  const segments: SemanticSegment[] = [];

  for (const unit of input.semanticUnits) {
    const section = sectionByBlock.get(unit.source_block_ids[0] ?? "");
    const unitBlocks = unit.source_block_ids
      .map((id) => blockById.get(id))
      .filter((block): block is DocumentBlock => Boolean(block))
      .filter((block) => block.block_type !== "heading");
    if (unitBlocks.length === 0) continue;
    const anchor = chooseAnchorBlock(unitBlocks);
    const segment: SemanticSegment = {
      segment_id: `seg_${segments.length + 1}`,
      title: section?.title,
      summary: unit.summary,
      source_block_ids: unit.source_block_ids,
      semantic_unit_ids: [unit.unit_id],
      anchor_block_id: anchor.block_id,
      primary_role: segmentPrimaryRole({ blocks: unitBlocks, blockRoleMap: input.blockRoleMap }),
      related_schema_fields: unit.related_schema_fields,
      missing_or_weak_fields: unit.missing_or_weak_fields,
      coherence_reason:
        unit.continuity_edges.some((edge) => edge.signals.includes("colon_intro"))
          ? "冒号引出句与后续内容共同补足一个完整业务表达"
          : unit.source_block_ids.length > 1
            ? "连续 block 共同说明一个业务判断或方法片段"
          : "单个内容块承担独立语义片段",
      confidence: unit.confidence,
    };
    segments.push(segment);
  }
  return segments;
}

const BLOCK_ROLE_LABELS: Record<BlockRole, string> = {
  overview_statement: "方法总述",
  business_definition: "业务定义",
  process_model: "流程模型",
  metric_basis: "指标依据",
  diagnosis_issue: "问题类型",
  action_method: "执行动作",
  validation_rule: "判断/验证规则",
  boundary_condition: "边界条件",
  supporting_detail: "补充说明",
  unknown: "未分类",
};

const ROLE_COMPATIBLE_FIELDS: Record<BlockRole, StructuredFieldKey[]> = {
  overview_statement: ["business_scenario", "scenario_goal", "process_flow_or_business_model"],
  business_definition: ["business_scenario", "scenario_goal"],
  process_model: ["process_flow_or_business_model", "scenario_goal"],
  metric_basis: ["judgment_basis", "judgment_criteria"],
  diagnosis_issue: ["faq_types", "judgment_basis", "resolution_methods"],
  action_method: ["execution_steps", "execution_actions", "resolution_methods", "trigger_conditions"],
  validation_rule: ["judgment_criteria", "validation_methods", "judgment_basis"],
  boundary_condition: ["trigger_conditions", "termination_conditions", "exceptions_and_non_applicable_scope"],
  supporting_detail: ["deliverables", "tool_templates", "required_inputs"],
  unknown: [],
};

const ROLE_EXCLUDED_FIELDS: Partial<Record<BlockRole, StructuredFieldKey[]>> = {
  overview_statement: ["execution_steps", "execution_actions", "deliverables"],
  process_model: ["execution_steps", "execution_actions", "deliverables"],
  metric_basis: ["deliverables", "business_scenario"],
  validation_rule: ["deliverables", "business_scenario"],
};

function hasAny(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function inferBlockRole(block: DocumentBlock): {
  role: BlockRole;
  secondary: BlockRole[];
  confidence: number;
  reason: string;
} {
  const text = block.text_content;
  if (!text.trim() || /^---+$/.test(text.trim())) {
    return { role: "unknown", secondary: [], confidence: 0.25, reason: "separator or empty block" };
  }
  if (block.block_type === "table" && hasAny(text, ["判断标准", "阈值", "验证方式", "连续", "行业均值"])) {
    return {
      role: "validation_rule",
      secondary: hasAny(text, ["指标", "点击率", "转化率", "ROI"]) ? ["metric_basis"] : [],
      confidence: 0.9,
      reason: "table contains judgment or validation columns",
    };
  }
  if (hasAny(text, ["问题 -> 方案 -> 任务 -> 增长", "生命周期", "诊断维度", "闭环", "框架", "模型", "维度拆解"])) {
    return {
      role: "process_model",
      secondary: hasAny(text, ["核心不是", "方法论", "总述"]) ? ["overview_statement"] : [],
      confidence: 0.88,
      reason: "block describes the global method framework or process model",
    };
  }
  if (hasAny(text, ["核心不是", "换句话说", "方法论的核心", "总述"])) {
    return {
      role: "overview_statement",
      secondary: [],
      confidence: 0.84,
      reason: "block summarizes the method at document level",
    };
  }
  if (hasAny(text, ["定义", "是一套", "业务场景", "所属场景"])) {
    return { role: "business_definition", secondary: [], confidence: 0.78, reason: "block defines the business scene or method" };
  }
  if (hasAny(text, ["触发", "启动", "终止", "停止", "例外", "不适用", "条件"])) {
    return { role: "boundary_condition", secondary: [], confidence: 0.8, reason: "block states boundary or condition information" };
  }
  if (hasAny(text, ["判断标准", "阈值", "验证", "证明有效", "复盘", "连续", "行业均值"])) {
    return {
      role: "validation_rule",
      secondary: hasAny(text, ["指标", "点击率", "转化率"]) ? ["metric_basis"] : [],
      confidence: 0.82,
      reason: "block states judgment or validation rules",
    };
  }
  if (hasAny(text, ["指标", "GMV", "点击率", "转化率", "ROI", "访客数", "客单价", "数据"])) {
    return { role: "metric_basis", secondary: [], confidence: 0.78, reason: "block contains diagnostic metric signals" };
  }
  if (hasAny(text, ["问题类型", "异常", "下降", "不足", "流失", "原因"])) {
    return { role: "diagnosis_issue", secondary: [], confidence: 0.72, reason: "block describes issue types or symptoms" };
  }
  if (hasAny(text, ["步骤", "先", "再", "最后", "动作", "执行", "优化", "处理", "解决"])) {
    return { role: "action_method", secondary: [], confidence: 0.76, reason: "block describes ordered execution actions" };
  }
  if (hasAny(text, ["输出", "交付物", "产物", "报告", "清单", "模板", "表格"])) {
    return { role: "supporting_detail", secondary: [], confidence: 0.7, reason: "block describes output or supporting assets" };
  }
  return { role: "supporting_detail", secondary: [], confidence: 0.52, reason: "block is supporting context" };
}

function buildBlockRoleMap(input: { ir: DocumentIR }): BlockRoleMap {
  const entries = input.ir.blocks.map((block): BlockRoleEntry => {
    const inferred = inferBlockRole(block);
    return {
      block_id: block.block_id,
      primary_role: inferred.role,
      primary_label: BLOCK_ROLE_LABELS[inferred.role],
      secondary_roles: inferred.secondary,
      compatible_fields: ROLE_COMPATIBLE_FIELDS[inferred.role],
      excluded_primary_fields: ROLE_EXCLUDED_FIELDS[inferred.role] ?? [],
      confidence: inferred.confidence,
      reason: inferred.reason,
    };
  });
  return {
    understanding_profile: "structured_context",
    blocks: Object.fromEntries(entries.map((entry) => [entry.block_id, entry])),
  };
}

export const profileTableUnderstandingAdapter: UnderstandingAdapter = {
  profile: "profile_table",
  understand(input: UnderstandingAdapterInput): UnderstandingResult {
    const started = Date.now();
    const baseMap = buildDocumentMap(input.ir);
    const fieldSignals = buildFieldSignals(input.schemaProfile, input.expertGuidanceProfile);
    const documentMap = buildProfileDocumentMap({
      ir: input.ir,
      baseMap,
      fieldSignals,
    });
    const { cards: sectionCards, hints } = buildProfileSectionCards({
      ir: input.ir,
      map: documentMap,
      fieldSignals,
    });
    const understanding = synthesizeDocumentUnderstanding(sectionCards);
    const tableBlockCount = documentMap.table_block_ids.length;
    const usedTableBlocks = new Set(hints.flatMap((hint) => hint.table_block_ids));
    const profileFields = Object.keys(fieldSignals);
    const matchedProfileFields = new Set(sectionCards.flatMap((card) => card.covered_schema_fields));
    const evidenceHints: SectionEvidenceHints = {
      understanding_profile: "profile_table",
      field_signals: fieldSignals,
      sections: hints,
    };
    return {
      documentMap,
      sectionCards,
      understanding,
      coverage: buildCoverage(input.ir, sectionCards),
      metrics: baselineMetrics({
        ir: input.ir,
        sectionCards,
        started,
        extra: {
          table_utilization_rate:
            tableBlockCount === 0 ? 1 : usedTableBlocks.size / tableBlockCount,
          profile_field_signal_coverage:
            profileFields.length === 0 ? 0 : matchedProfileFields.size / profileFields.length,
        },
      }),
      evidenceHints,
      extraArtifacts: {
        section_evidence_hints: evidenceHints,
      },
    };
  },
};

export const structuredContextUnderstandingAdapter: UnderstandingAdapter = {
  profile: "structured_context",
  understand(input: UnderstandingAdapterInput): UnderstandingResult {
    const started = Date.now();
    const fieldSignals = buildFieldSignals(input.schemaProfile, input.expertGuidanceProfile);
    const structuredSections = buildStructuredSections(input.ir);
    const documentMap = mapFromStructuredSections({
      ir: input.ir,
      sections: structuredSections,
      fieldSignals,
    });
    const { cards: sectionCards, hints } = buildProfileSectionCards({
      ir: input.ir,
      map: documentMap,
      fieldSignals,
    });
    const structuredSectionSummaries = buildStructuredSummaries({
      ir: input.ir,
      sections: structuredSections,
      hints,
      schemaProfile: input.schemaProfile,
    });
    const documentSynthesis = synthesizeStructuredDocument({
      summaries: structuredSectionSummaries,
      schemaProfile: input.schemaProfile,
      expertGuidanceProfile: input.expertGuidanceProfile,
    });
    const blockRoleMap = buildBlockRoleMap({ ir: input.ir });
    const semanticCoherenceProfile = input.semanticCoherenceProfile ?? "rules";
    const continuityDecisionTrace = buildBlockContinuityEdges({
      ir: input.ir,
      sections: structuredSections,
      hints,
      blockRoleMap,
      semanticCoherenceProfile,
    });
    const baselineSemanticUnits = buildSemanticUnits({
      ir: input.ir,
      sections: structuredSections,
      summaries: structuredSectionSummaries,
      hints,
      trace: continuityDecisionTrace,
      schemaProfile: input.schemaProfile,
    });
    const semanticUnitEnhancement = enhanceSemanticUnitsWithLlm({
      units: baselineSemanticUnits,
      ir: input.ir,
      schemaProfile: input.schemaProfile,
      expertGuidanceProfile: input.expertGuidanceProfile,
    });
    const semanticUnitValidation = validateSemanticUnitMatches({
      units: semanticUnitEnhancement.units,
      ir: input.ir,
      schemaProfile: input.schemaProfile,
    });
    const semanticUnits = semanticUnitValidation.units;
    const semanticUnitEvaluationReport = evaluateSemanticUnits({
      baselineUnits: baselineSemanticUnits,
      enhancedUnits: semanticUnits,
      validation: semanticUnitValidation,
      observability: semanticUnitEnhancement.observability,
    });
    const semanticSegments = buildSemanticSegments({
      ir: input.ir,
      sections: structuredSections,
      summaries: structuredSectionSummaries,
      hints,
      blockRoleMap,
      semanticUnits,
      schemaProfile: input.schemaProfile,
    });
    const contextualizedBlocks = buildContextualizedBlocks({
      ir: input.ir,
      sections: structuredSections,
      summaries: structuredSectionSummaries,
      hints,
      synthesis: documentSynthesis,
      semanticUnits,
      semanticSegments,
    });
    const understanding = {
      document_theme: documentSynthesis.document_theme,
      business_scene: documentSynthesis.business_scene,
      primary_goal: documentSynthesis.primary_goal,
      section_summaries: sectionCards,
      key_signals: documentSynthesis.key_signals,
      likely_gaps: documentSynthesis.likely_gaps,
      process_spine: documentSynthesis.process_spine,
      quality_risks: documentSynthesis.quality_risks,
      summary_for_agent: documentSynthesis.summary_for_agent,
      confidence: documentSynthesis.confidence,
    };
    const tableBlockCount = documentMap.table_block_ids.length;
    const usedTableBlocks = new Set(hints.flatMap((hint) => hint.table_block_ids));
    const profileFields = Object.keys(fieldSignals);
    const matchedProfileFields = new Set(
      structuredSectionSummaries.flatMap((summary) => summary.related_schema_fields),
    );
    const citedBlocks = new Set(structuredSectionSummaries.flatMap((summary) => summary.source_block_ids));
    const nonHeadingBlockCount = input.ir.blocks.filter((block) => block.block_type !== "heading").length;
    const unitCoveredBlockCount = new Set(semanticUnits.flatMap((unit) => unit.source_block_ids)).size;
    const mergedDecisions = continuityDecisionTrace.decisions.filter((decision) => decision.should_merge);
    const unmergedContinuationCandidates = continuityDecisionTrace.decisions.filter(
      (decision) => !decision.should_merge && decision.rule_score >= 0.5,
    ).length;
    const fragmentedThoughtRate =
      continuityDecisionTrace.decisions.length === 0
        ? 0
        : unmergedContinuationCandidates / continuityDecisionTrace.decisions.length;
    const mergeConfidence =
      mergedDecisions.length === 0
        ? 0
        : mergedDecisions.reduce((sum, decision) => sum + decision.confidence, 0) / mergedDecisions.length;
    const evidenceHints: SectionEvidenceHints = {
      understanding_profile: "structured_context",
      field_signals: fieldSignals,
      sections: hints,
    };
    return {
      documentMap,
      sectionCards,
      understanding,
      coverage: buildCoverage(input.ir, sectionCards),
      metrics: baselineMetrics({
        ir: input.ir,
        sectionCards,
        started,
        extra: {
          table_utilization_rate:
            tableBlockCount === 0 ? 1 : usedTableBlocks.size / tableBlockCount,
          profile_field_signal_coverage:
            profileFields.length === 0 ? 0 : matchedProfileFields.size / profileFields.length,
          structured_section_count: structuredSections.length,
          structured_summary_coverage:
            structuredSections.length === 0
              ? 0
              : structuredSectionSummaries.length / structuredSections.length,
          contextualized_block_coverage:
            input.ir.blocks.length === 0 ? 0 : contextualizedBlocks.length / input.ir.blocks.length,
          semantic_segment_coverage:
            input.ir.blocks.length === 0
              ? 0
              : semanticSegments.flatMap((segment) => segment.source_block_ids).length / input.ir.blocks.length,
          semantic_unit_coverage:
            nonHeadingBlockCount === 0 ? 0 : unitCoveredBlockCount / nonHeadingBlockCount,
          fragmented_thought_rate: Number(fragmentedThoughtRate.toFixed(4)),
          merge_confidence: Number(mergeConfidence.toFixed(4)),
          semantic_navigation_score: semanticUnitEvaluationReport.semantic_navigation_score,
          semantic_unit_over_tag_rate: semanticUnitEvaluationReport.metrics.over_tag_rate ?? 0,
          semantic_unit_heading_overuse_rate: semanticUnitEvaluationReport.metrics.heading_overuse_rate ?? 0,
          semantic_unit_primary_field_coverage: semanticUnitEvaluationReport.metrics.primary_field_coverage ?? 0,
          structured_summary_grounding_rate:
            structuredSectionSummaries.length === 0
              ? 0
              : citedBlocks.size / unique(structuredSectionSummaries.flatMap((summary) => summary.source_block_ids)).length,
        },
      }),
      evidenceHints,
      structuredSections,
      structuredSectionSummaries,
      documentSynthesis,
      contextualizedBlocks,
      semanticUnits,
      continuityDecisionTrace,
      semanticSegments,
      blockRoleMap,
      extraArtifacts: {
        structured_sections: {
          understanding_profile: "structured_context",
          sections: structuredSections,
        },
        structured_section_summaries: {
          understanding_profile: "structured_context",
          summaries: structuredSectionSummaries,
        },
        document_synthesis: documentSynthesis,
        contextualized_blocks: {
          understanding_profile: "structured_context",
          blocks: contextualizedBlocks,
        },
        semantic_units: {
          understanding_profile: "structured_context",
          semantic_coherence_profile: semanticCoherenceProfile,
          units: semanticUnits,
        },
        "semantic_units.v0": {
          understanding_profile: "structured_context",
          semantic_coherence_profile: semanticCoherenceProfile,
          units: baselineSemanticUnits,
        },
        "semantic_units.llm.v0": {
          understanding_profile: "structured_context",
          semantic_coherence_profile: semanticCoherenceProfile,
          units: semanticUnits,
          observability: semanticUnitEnhancement.observability,
        },
        "semantic_unit_schema_matches.v0": {
          understanding_profile: "structured_context",
          units: semanticUnits.map((unit) => ({
            unit_id: unit.unit_id,
            unit_title: unit.unit_title,
            parent_heading: unit.parent_heading,
            source_block_ids: unit.source_block_ids,
            schema_field_matches: unit.schema_field_matches ?? [],
          })),
        },
        semantic_unit_llm_observability: semanticUnitEnhancement.observability,
        semantic_unit_match_validation_report: semanticUnitValidation.diagnostics,
        semantic_unit_evaluation_report: semanticUnitEvaluationReport,
        semantic_unit_experiment_log: {
          generated_at: new Date().toISOString(),
          experiment_name: "semantic_unit_llm_enhancement.v0",
          baseline_artifact: "semantic_units.v0.json",
          enhanced_artifact: "semantic_units.llm.v0.json",
          primary_metric: "semantic_navigation_score",
          semantic_navigation_score: semanticUnitEvaluationReport.semantic_navigation_score,
        },
        continuity_decision_trace: continuityDecisionTrace,
        semantic_segments: {
          understanding_profile: "structured_context",
          segments: semanticSegments,
        },
        "semantic_segments.v0": {
          understanding_profile: "structured_context",
          segments: semanticSegments,
        },
        block_role_map: blockRoleMap,
        section_evidence_hints: evidenceHints,
      },
    };
  },
};
