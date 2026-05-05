import type { DocumentIR, DocumentMap, DocumentMapSection, SectionCard } from "../types.js";

const FIELD_KEYWORDS: Record<string, string[]> = {
  business_scenario: ["场景", "业务", "链路"],
  scenario_goal: ["目标", "解决", "问题"],
  execution_steps: ["步骤", "流程", "操作", "执行"],
  execution_actions: ["动作", "处理", "执行"],
  judgment_basis: ["指标", "依据", "数据", "点击率", "转化率", "ROI"],
  judgment_criteria: ["标准", "阈值", "异常", "正常", "判断"],
  resolution_methods: ["解决", "处理", "办法", "方法"],
  trigger_conditions: ["触发", "启动", "什么情况下"],
  termination_conditions: ["结束", "停止", "终止"],
  validation_methods: ["验证", "有效", "观察周期"],
  tool_templates: ["工具", "表格", "模板", "SOP"],
};

function compact(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function fieldsForText(text: string): string[] {
  return Object.entries(FIELD_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([field]) => field);
}

function buildSectionForHeading(
  ir: DocumentIR,
  headingIndex: number,
): DocumentMapSection {
  const heading = ir.blocks[headingIndex]!;
  const level = heading.heading_level || 1;
  let endIndex = ir.blocks.length - 1;
  for (let i = headingIndex + 1; i < ir.blocks.length; i += 1) {
    const block = ir.blocks[i]!;
    if (block.block_type === "heading" && block.heading_level > 0 && block.heading_level <= level) {
      endIndex = i - 1;
      break;
    }
  }
  const blockIds = ir.blocks
    .slice(headingIndex, endIndex + 1)
    .map((block) => block.block_id);
  return {
    section_id: `section_${heading.block_id}`,
    title: heading.text_content || heading.block_id,
    level,
    heading_block_id: heading.block_id,
    block_ids: blockIds,
    start_index: headingIndex,
    end_index: endIndex,
  };
}

export function buildDocumentMap(ir: DocumentIR): DocumentMap {
  const sections = ir.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.block_type === "heading")
    .map(({ index }) => buildSectionForHeading(ir, index));

  const fallbackSections =
    sections.length > 0
      ? sections
      : [
          {
            section_id: "section_root",
            title: "Root",
            level: 1,
            heading_block_id: ir.blocks[0]?.block_id ?? "root",
            block_ids: ir.blocks.map((block) => block.block_id),
            start_index: 0,
            end_index: Math.max(0, ir.blocks.length - 1),
          },
        ];

  const fieldCandidates: Record<string, string[]> = {};
  for (const block of ir.blocks) {
    for (const field of fieldsForText(block.text_content)) {
      fieldCandidates[field] = [...(fieldCandidates[field] ?? []), block.block_id];
    }
  }

  return {
    doc_id: ir.doc_id,
    version_id: ir.version_id,
    total_blocks: ir.blocks.length,
    sections: fallbackSections,
    table_block_ids: ir.blocks
      .filter((block) => block.block_type === "table")
      .map((block) => block.block_id),
    image_block_ids: ir.blocks
      .filter((block) => block.block_type === "image")
      .map((block) => block.block_id),
    field_candidate_blocks: fieldCandidates,
  };
}

export function buildSectionCards(ir: DocumentIR, map: DocumentMap): SectionCard[] {
  const blockById = new Map(ir.blocks.map((block) => [block.block_id, block]));
  return map.sections.map((section) => {
    const blocks = section.block_ids
      .map((id) => blockById.get(id))
      .filter((block): block is NonNullable<typeof block> => Boolean(block));
    const text = blocks.map((block) => block.text_content).join(" ");
    const covered = [...new Set(fieldsForText(`${section.title} ${text}`))];
    const keySignals = [
      ...new Set(
        Object.values(FIELD_KEYWORDS)
          .flat()
          .filter((keyword) => text.includes(keyword) || section.title.includes(keyword)),
      ),
    ].slice(0, 6);
    return {
      section_id: section.section_id,
      title: section.title,
      source_block_ids: section.block_ids,
      summary: compact(text || section.title),
      key_signals: keySignals,
      covered_schema_fields: covered,
      likely_gaps:
        covered.length === 0 ? ["该章节尚未明显覆盖目标 schema 字段"] : [],
      confidence: covered.length > 0 ? 0.82 : 0.62,
    };
  });
}
