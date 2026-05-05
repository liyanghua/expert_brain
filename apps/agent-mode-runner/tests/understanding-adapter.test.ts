import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  baselineUnderstandingAdapter,
  profileTableUnderstandingAdapter,
  structuredContextUnderstandingAdapter,
} from "../src/understanding/understanding-adapters.js";
import { buildDocumentMap, buildSectionCards } from "../src/tools/document-map.js";
import { synthesizeDocumentUnderstanding } from "../src/tools/section-summarizer.js";
import type {
  DocumentIR,
  ExpertGuidanceProfile,
  SchemaProfile,
} from "../src/types.js";

const ir: DocumentIR = {
  doc_id: "doc-understanding-test",
  version_id: "v0",
  blocks: [
    {
      block_id: "h1",
      block_type: "heading",
      text_content: "商品诊断 SOP",
      heading_level: 1,
      source_file: "sample.md",
      source_span: "L1",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: ["p1", "t1"],
    },
    {
      block_id: "p1",
      block_type: "paragraph",
      text_content: "目标是判断商品链接流量是否异常。",
      heading_level: 0,
      source_file: "sample.md",
      source_span: "L2",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: "h1",
      children_block_ids: [],
    },
    {
      block_id: "t1",
      block_type: "table",
      text_content: "| 指标 | 判断标准 | 验证方式 |\n| --- | --- | --- |\n| 点击率 | 连续3天低于行业均值 | 复盘点击率和转化率 |",
      heading_level: 0,
      source_file: "sample.md",
      source_span: "L3-L5",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: "h1",
      children_block_ids: [],
    },
  ],
};

const schemaProfile: SchemaProfile = {
  profile_id: "schema.test",
  version: "v1",
  required_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
  optional_fields: [],
  inferred_candidate_fields: [],
  field_definitions: {
    judgment_basis: {
      description: "用于诊断问题和验证效果的核心指标或信号",
      extraction_hint: "优先识别指标名、变量名、监控项、数据依据。",
    },
    judgment_criteria: {
      description: "指标的阈值、等级、频次、时间窗口和好坏标准",
      extraction_hint: "优先识别阈值、判断标准、连续N天、行业均值基准。",
    },
    validation_methods: {
      description: "用什么数据或方式证明优化动作有效",
      extraction_hint: "优先识别验证方式、如何证明有效、复盘指标。",
    },
  },
  normalization_rules: [],
  output_requirements: [],
};

const expertGuidanceProfile: ExpertGuidanceProfile = {
  profile_id: "guidance.test",
  version: "v1",
  field_guidance: {
    judgment_basis: ["指标、数据依据、点击率、转化率"],
    judgment_criteria: ["判断标准、阈值、行业均值"],
    validation_methods: ["验证方式、复盘指标"],
  },
  extraction_guidance: [],
  gap_detection_guidance: [],
  planning_guidance: [],
  inference_boundaries: [],
  quality_preferences: [],
};

describe("understanding adapters", () => {
  it("keeps baseline adapter output aligned with the existing Step 2 implementation", () => {
    const result = baselineUnderstandingAdapter.understand({ ir });
    const expectedMap = buildDocumentMap(ir);
    const expectedCards = buildSectionCards(ir, expectedMap);

    assert.deepEqual(result.documentMap, expectedMap);
    assert.deepEqual(result.sectionCards, expectedCards);
    assert.deepEqual(result.understanding, synthesizeDocumentUnderstanding(expectedCards));
  });

  it("uses profile hints and table blocks to create field evidence hints", () => {
    const result = profileTableUnderstandingAdapter.understand({
      ir,
      schemaProfile,
      expertGuidanceProfile,
    });
    const card = result.sectionCards[0];
    const hints = result.extraArtifacts?.section_evidence_hints as {
      sections: {
        table_block_ids: string[];
        field_evidence_hints: Record<string, { block_ids: string[]; signals: string[] }>;
      }[];
    };

    assert.ok(card?.covered_schema_fields.includes("judgment_basis"));
    assert.ok(card?.covered_schema_fields.includes("judgment_criteria"));
    assert.ok(card?.covered_schema_fields.includes("validation_methods"));
    assert.ok(result.documentMap.field_candidate_blocks.judgment_criteria?.includes("t1"));
    assert.equal(hints.sections[0]?.table_block_ids[0], "t1");
    assert.ok(hints.sections[0]?.field_evidence_hints.judgment_criteria?.signals.length);
  });

  it("builds structured context with H2 sections, summaries and contextualized blocks", () => {
    const richIr: DocumentIR = {
      ...ir,
      blocks: [
        {
          ...ir.blocks[0]!,
          block_id: "h1",
          text_content: "商品链接诊断",
          heading_level: 1,
          children_block_ids: ["h2a", "h2b"],
        },
        {
          block_id: "h2a",
          block_type: "heading",
          text_content: "流量结构诊断",
          heading_level: 2,
          source_file: "sample.md",
          source_span: "L2",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: ["p1", "t1"],
        },
        { ...ir.blocks[1]!, parent_block_id: "h2a" },
        { ...ir.blocks[2]!, parent_block_id: "h2a" },
        {
          block_id: "h2b",
          block_type: "heading",
          text_content: "验证方式",
          heading_level: 2,
          source_file: "sample.md",
          source_span: "L6",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: ["p2"],
        },
        {
          block_id: "p2",
          block_type: "paragraph",
          text_content: "复盘优化前后的点击率和转化率，验证动作是否有效。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L7",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h2b",
          children_block_ids: [],
        },
      ],
    };

    const result = structuredContextUnderstandingAdapter.understand({
      ir: richIr,
      schemaProfile,
      expertGuidanceProfile,
    });
    const structuredSections = result.extraArtifacts?.structured_sections as {
      sections: { section_id: string; heading_level: number; section_type: string }[];
    };
    const summaries = result.extraArtifacts?.structured_section_summaries as {
      summaries: { main_purpose: string; related_schema_fields: string[]; source_block_ids: string[] }[];
    };
    const contextualized = result.extraArtifacts?.contextualized_blocks as {
      blocks: { block_id: string; section_context: { section_id: string }; extraction_context: { likely_related_schema_fields: string[] } }[];
    };
    const blockRoleMap = result.extraArtifacts?.block_role_map as {
      blocks: Record<string, { primary_role: string; compatible_fields: string[]; excluded_primary_fields: string[] }>;
    };
    const synthesis = result.extraArtifacts?.document_synthesis as {
      process_spine: { section_id: string; role: string }[];
      summary_for_agent: string;
    };

    assert.deepEqual(
      structuredSections.sections.map((section) => section.section_id),
      ["section_h2a", "section_h2b"],
    );
    assert.ok(structuredSections.sections.every((section) => section.heading_level === 2));
    assert.ok(summaries.summaries[0]?.main_purpose);
    assert.ok(summaries.summaries[0]?.related_schema_fields.includes("judgment_criteria"));
    assert.equal(contextualized.blocks.find((block) => block.block_id === "t1")?.section_context.section_id, "section_h2a");
    assert.ok(
      contextualized.blocks
        .find((block) => block.block_id === "t1")
        ?.extraction_context.likely_related_schema_fields.includes("judgment_basis"),
    );
    assert.ok(synthesis.process_spine.length >= 2);
    assert.ok(synthesis.summary_for_agent.length > 0);
    assert.equal(blockRoleMap.blocks.t1?.primary_role, "validation_rule");
    assert.ok(blockRoleMap.blocks.t1?.compatible_fields.includes("judgment_criteria"));
  });

  it("classifies overview and process blocks for global review labeling", () => {
    const overviewIr: DocumentIR = {
      doc_id: "doc-role-test",
      version_id: "v0",
      blocks: [
        {
          block_id: "h1",
          block_type: "heading",
          text_content: "商品链接增长诊断方法论",
          heading_level: 1,
          source_file: "sample.md",
          source_span: "L1",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: ["b2", "b8"],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "这套方法论的核心不是“商品链接诊断”，而是：",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L2",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
        {
          block_id: "b8",
          block_type: "list",
          text_content:
            "1. 商品诊断不是看数据，而是“问题 -> 方案 -> 任务 -> 增长”，并且要按生命周期、诊断维度、指标对标、问题排查、方案执行、数据验证形成闭环。\n2. 链接诊断拆成新品期、成长期、成熟期、爆款期、衰退期，并给出各阶段的核心目标、关键指标和诊断动作。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L3-L4",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
      ],
    };

    const result = structuredContextUnderstandingAdapter.understand({
      ir: overviewIr,
      schemaProfile,
      expertGuidanceProfile,
    });
    const blockRoleMap = result.extraArtifacts?.block_role_map as {
      blocks: Record<string, { primary_role: string; compatible_fields: string[]; excluded_primary_fields: string[] }>;
    };

    assert.equal(blockRoleMap.blocks.b2?.primary_role, "overview_statement");
    assert.equal(blockRoleMap.blocks.b8?.primary_role, "process_model");
    assert.ok(blockRoleMap.blocks.b8?.compatible_fields.includes("process_flow_or_business_model"));
    assert.ok(blockRoleMap.blocks.b8?.excluded_primary_fields.includes("deliverables"));
    assert.ok(blockRoleMap.blocks.b8?.excluded_primary_fields.includes("execution_steps"));
  });

  it("groups consecutive blocks with one meaning into semantic segments", () => {
    const segmentIr: DocumentIR = {
      doc_id: "doc-segment-test",
      version_id: "v0",
      blocks: [
        {
          block_id: "h1",
          block_type: "heading",
          text_content: "点击率下降判断",
          heading_level: 1,
          source_file: "sample.md",
          source_span: "L1",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: ["p1", "p2", "p3"],
        },
        {
          block_id: "p1",
          block_type: "paragraph",
          text_content: "当点击率连续下降时，先看入口吸引力是否变弱。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L2",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
        {
          block_id: "p2",
          block_type: "paragraph",
          text_content: "同时对比同类商品均值，判断流量质量是否发生变化。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L3",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
        {
          block_id: "p3",
          block_type: "paragraph",
          text_content: "如果下降超过三天，需要记录阈值、样本范围和验证方式。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L4",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
      ],
    };

    const result = structuredContextUnderstandingAdapter.understand({
      ir: segmentIr,
      schemaProfile,
      expertGuidanceProfile,
    });
    const semanticSegments = result.extraArtifacts?.semantic_segments as {
      segments: {
        segment_id: string;
        summary: string;
        source_block_ids: string[];
        anchor_block_id: string;
        related_schema_fields: string[];
        missing_or_weak_fields: string[];
      }[];
    };
    const contextualized = result.extraArtifacts?.contextualized_blocks as {
      blocks: { block_id: string; semantic_segment_id?: string; block_summary?: string; segment_summary?: string }[];
    };

    assert.equal(semanticSegments.segments.length, 1);
    assert.deepEqual(semanticSegments.segments[0]?.source_block_ids, ["p1", "p2", "p3"]);
    assert.equal(semanticSegments.segments[0]?.anchor_block_id, "p1");
    assert.match(semanticSegments.segments[0]?.summary ?? "", /点击率|流量质量|阈值/);
    assert.ok(semanticSegments.segments[0]?.related_schema_fields.includes("judgment_criteria"));
    assert.ok(contextualized.blocks.find((block) => block.block_id === "p2")?.semantic_segment_id);
    assert.match(contextualized.blocks.find((block) => block.block_id === "p2")?.segment_summary ?? "", /点击率/);
  });

  it("keeps markdown blocks separate but merges colon-introduced continuations into one semantic unit", () => {
    const continuityIr: DocumentIR = {
      doc_id: "doc-continuity-test",
      version_id: "v0",
      blocks: [
        {
          block_id: "h1",
          block_type: "heading",
          text_content: "方法论核心",
          heading_level: 1,
          source_file: "sample.md",
          source_span: "L1",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: ["b2", "b3"],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "这套方法论的核心不是“商品链接诊断”，而是：",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L2",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
        {
          block_id: "b3",
          block_type: "paragraph",
          text_content:
            "用 GMV 拆解确定增长问题，用生命周期判断商品阶段，用人群与流量匹配定位根因，用转化与利润验证商品价值，最后把诊断结论转成增长任务。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L3",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
      ],
    };

    const result = structuredContextUnderstandingAdapter.understand({
      ir: continuityIr,
      schemaProfile,
      expertGuidanceProfile,
    });
    const semanticUnits = result.extraArtifacts?.semantic_units as {
      units: {
        unit_id: string;
        source_block_ids: string[];
        semantic_text: string;
        continuity_edges: { from_block_id: string; to_block_id: string; relation: string; signals: string[] }[];
      }[];
    };
    const semanticSegments = result.extraArtifacts?.semantic_segments as {
      segments: { source_block_ids: string[]; semantic_unit_ids?: string[]; coherence_reason: string }[];
    };
    const continuityTrace = result.extraArtifacts?.continuity_decision_trace as {
      decisions: { from_block_id: string; to_block_id: string; should_merge: boolean; merge_reason: string }[];
    };

    assert.deepEqual(continuityIr.blocks.map((block) => block.block_id), ["h1", "b2", "b3"]);
    assert.equal(semanticUnits.units.length, 1);
    assert.deepEqual(semanticUnits.units[0]?.source_block_ids, ["b2", "b3"]);
    assert.match(semanticUnits.units[0]?.semantic_text ?? "", /GMV 拆解确定增长问题/);
    assert.equal(semanticUnits.units[0]?.continuity_edges[0]?.relation, "elaboration");
    assert.ok(semanticUnits.units[0]?.continuity_edges[0]?.signals.includes("colon_intro"));
    assert.deepEqual(semanticSegments.segments[0]?.source_block_ids, ["b2", "b3"]);
    assert.ok(semanticSegments.segments[0]?.semantic_unit_ids?.includes(semanticUnits.units[0]!.unit_id));
    assert.match(semanticSegments.segments[0]?.coherence_reason ?? "", /冒号引出|补足/);
    assert.equal(continuityTrace.decisions[0]?.should_merge, true);
    assert.match(continuityTrace.decisions[0]?.merge_reason ?? "", /冒号/);
    assert.equal(result.metrics.fragmented_thought_rate?.value, 0);
    assert.equal(result.metrics.semantic_unit_coverage?.value, 1);
  });

  it("can use the optional embedding coherence profile for gray-zone adjacent blocks", () => {
    const grayZoneIr: DocumentIR = {
      doc_id: "doc-embedding-coherence-test",
      version_id: "v0",
      blocks: [
        {
          block_id: "h1",
          block_type: "heading",
          text_content: "流量匹配",
          heading_level: 1,
          source_file: "sample.md",
          source_span: "L1",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: ["b1", "b2"],
        },
        {
          block_id: "b1",
          block_type: "paragraph",
          text_content: "先判断人群与流量是否匹配，重点观察搜索和推荐入口。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L2",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
        {
          block_id: "b2",
          block_type: "paragraph",
          text_content: "人群匹配不稳定时，流量质量会下降，并影响点击率和转化率。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L3",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: "h1",
          children_block_ids: [],
        },
      ],
    };

    const result = structuredContextUnderstandingAdapter.understand({
      ir: grayZoneIr,
      schemaProfile,
      expertGuidanceProfile,
      semanticCoherenceProfile: "embedding",
    });
    const trace = result.extraArtifacts?.continuity_decision_trace as {
      decisions: { from_block_id: string; to_block_id: string; embedding_similarity?: number; should_merge: boolean }[];
    };
    const semanticUnits = result.extraArtifacts?.semantic_units as {
      units: { source_block_ids: string[] }[];
    };

    assert.equal(trace.decisions[0]?.should_merge, true);
    assert.ok((trace.decisions[0]?.embedding_similarity ?? 0) > 0);
    assert.deepEqual(semanticUnits.units[0]?.source_block_ids, ["b1", "b2"]);
  });
});
