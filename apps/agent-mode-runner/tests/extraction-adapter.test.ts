import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  baselineExtractionAdapter,
  hintedExtractionAdapter,
  schemaGuidedExtractionAdapter,
} from "../src/extraction/extraction-adapters.js";
import type {
  BlockRoleMap,
  ContextualizedBlock,
  DocumentIR,
  DocumentSynthesis,
  EvaluationProfile,
  DocumentUnderstanding,
  ExpertGuidanceProfile,
  SchemaProfile,
  SectionCard,
  SectionEvidenceHints,
} from "../src/types.js";

const ir: DocumentIR = {
  doc_id: "doc-extraction-test",
  version_id: "v0",
  blocks: [
    {
      block_id: "h1",
      block_type: "heading",
      text_content: "判断标准",
      heading_level: 1,
      source_file: "sample.md",
      source_span: "L1",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: ["t1"],
    },
    {
      block_id: "t1",
      block_type: "table",
      text_content: "| 指标 | 判断标准 | 验证方式 |\n| --- | --- | --- |\n| 点击率 | 连续3天低于行业均值 | 复盘点击率和转化率 |",
      heading_level: 0,
      source_file: "sample.md",
      source_span: "L2-L4",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: "h1",
      children_block_ids: [],
    },
  ],
};

const sectionCards: SectionCard[] = [
  {
    section_id: "section_h1",
    title: "判断标准",
    source_block_ids: ["h1", "t1"],
    summary: "表格包含指标、判断标准和验证方式。",
    key_signals: ["指标", "判断标准", "验证方式"],
    covered_schema_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
    likely_gaps: [],
    confidence: 0.9,
  },
];

const understanding: DocumentUnderstanding = {
  document_theme: "商品诊断",
  business_scene: "商品链接诊断",
  primary_goal: "提升商品链接诊断质量",
  section_summaries: sectionCards,
  key_signals: ["指标", "判断标准", "验证方式"],
  likely_gaps: [],
  confidence: 0.9,
};

const schemaProfile: SchemaProfile = {
  profile_id: "schema.test",
  version: "v1",
  required_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
  optional_fields: [],
  inferred_candidate_fields: [],
  field_definitions: {
    judgment_basis: { extraction_hint: "优先识别指标名、变量名、监控项、数据依据。" },
    judgment_criteria: { extraction_hint: "优先识别阈值、判断标准、连续N天、行业均值基准。" },
    validation_methods: { extraction_hint: "优先识别验证方式、如何证明有效、复盘指标。" },
  },
  normalization_rules: [],
  output_requirements: [],
};

const evaluationProfile: EvaluationProfile = {
  profile_id: "eval.test",
  version: "v1",
  metrics: [],
  metric_thresholds: {},
  field_weights: {},
  critical_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
  list_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
  single_fields: ["business_scenario", "scenario_goal", "process_flow_or_business_model"],
  hard_gates: [],
  gap_priority_rules: [],
};

const expertGuidanceProfile: ExpertGuidanceProfile = {
  profile_id: "guidance.test",
  version: "v1",
  field_guidance: {},
  extraction_guidance: [],
  gap_detection_guidance: [],
  planning_guidance: [],
  inference_boundaries: [],
  quality_preferences: [],
};

const sectionEvidenceHints: SectionEvidenceHints = {
  understanding_profile: "profile_table",
  field_signals: {
    judgment_basis: ["指标", "点击率"],
    judgment_criteria: ["判断标准", "行业均值"],
    validation_methods: ["验证方式", "复盘"],
  },
  sections: [
    {
      section_id: "section_h1",
      title: "判断标准",
      source_block_ids: ["h1", "t1"],
      table_block_ids: ["t1"],
      list_block_ids: [],
      field_evidence_hints: {
        judgment_basis: {
          block_ids: ["t1"],
          signals: ["指标", "点击率"],
          reason: "table block contains structured diagnostic evidence",
        },
        judgment_criteria: {
          block_ids: ["t1"],
          signals: ["判断标准", "行业均值"],
          reason: "table block contains structured diagnostic evidence",
        },
        validation_methods: {
          block_ids: ["t1"],
          signals: ["验证方式", "复盘"],
          reason: "table block contains structured diagnostic evidence",
        },
      },
    },
  ],
};

const documentSynthesis: DocumentSynthesis = {
  document_theme: "商品诊断",
  business_scene: "商品链接诊断",
  primary_goal: "提升商品链接诊断质量",
  process_spine: [{ section_id: "section_h1", role: "metrics: 判断标准" }],
  key_signals: ["指标", "判断标准", "验证方式"],
  likely_gaps: [],
  quality_risks: [],
  summary_for_agent: "表格给出了指标、判断标准和验证方式。",
  confidence: 0.9,
};

const contextualizedBlocks: ContextualizedBlock[] = [
  {
    block_id: "t1",
    block_type: "table",
    text_content: ir.blocks[1]!.text_content,
    source_refs: [{ block_id: "t1", source_file: "sample.md", source_span: "L2-L4" }],
    section_context: {
      section_id: "section_h1",
      section_title: "判断标准",
      section_type: "metrics",
      section_main_purpose: "说明诊断指标、判断标准和验证方式",
      section_key_points: ["点击率低于行业均值需要复盘"],
    },
    document_context: {
      document_theme: "商品诊断",
      business_scene: "商品链接诊断",
      primary_goal: "提升商品链接诊断质量",
      process_role: "metrics: 判断标准",
    },
    extraction_context: {
      likely_related_schema_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
      likely_signal_types: ["指标", "判断标准", "验证方式"],
      likely_gap_hints: [],
      inference_risk_level: "low",
    },
  },
];

const blockRoleMap: BlockRoleMap = {
  understanding_profile: "structured_context",
  blocks: {
    t1: {
      block_id: "t1",
      primary_role: "validation_rule",
      primary_label: "判断/验证规则",
      secondary_roles: ["metric_basis"],
      compatible_fields: ["judgment_basis", "judgment_criteria", "validation_methods"],
      excluded_primary_fields: [],
      confidence: 0.9,
      reason: "table block contains metric, criterion and validation columns",
    },
  },
};

describe("extraction adapters", () => {
  it("keeps baseline extraction adapter compatible with current heuristic extractor", () => {
    const result = baselineExtractionAdapter.extract({
      ir,
      understanding,
      sectionCards,
      schemaProfile,
      expertGuidanceProfile,
    });

    assert.equal(result.draft.doc_id, ir.doc_id);
    assert.equal(result.adapterProfile, "baseline");
    assert.equal(result.extraArtifacts?.extraction_evidence_trace, undefined);
  });

  it("uses Step 2 hints to prefer table-backed evidence for diagnostic fields", () => {
    const result = hintedExtractionAdapter.extract({
      ir,
      understanding,
      sectionCards,
      schemaProfile,
      expertGuidanceProfile,
      sectionEvidenceHints,
    });
    const trace = result.extraArtifacts?.extraction_evidence_trace as {
      fields: Record<string, { block_ids: string[]; table_backed: boolean; extraction_method: string }>;
    };

    assert.equal(result.adapterProfile, "hinted");
    assert.equal(result.draft.source_refs.judgment_criteria?.[0]?.block_id, "t1");
    assert.equal(trace.fields.judgment_criteria?.table_backed, true);
    assert.equal(trace.fields.judgment_criteria?.extraction_method, "hinted_table_evidence");
    assert.ok(String(result.draft.judgment_criteria[0]?.content).includes("连续3天低于行业均值"));
  });

  it("extracts schema-guided fields with grounded evidence and typed validation", () => {
    const result = schemaGuidedExtractionAdapter.extract({
      ir,
      understanding,
      sectionCards,
      schemaProfile,
      expertGuidanceProfile,
      evaluationProfile,
      sectionEvidenceHints,
      documentSynthesis,
      contextualizedBlocks,
      blockRoleMap,
    });
    const evidenceMap = result.extraArtifacts?.schema_guided_evidence_map as {
      fields: Record<string, { selected_block_ids: string[]; source_grounded: boolean }>;
    };
    const trace = result.extraArtifacts?.schema_guided_extraction_trace as {
      fields: Record<string, { extraction_method: string; validation_status: string }>;
    };
    const validation = result.extraArtifacts?.schema_guided_validation_report as {
      typed_validation_pass_rate: number;
      fields: Record<string, { status: string }>;
    };

    assert.equal(result.adapterProfile, "schema_guided");
    assert.equal(evidenceMap.fields.judgment_criteria?.source_grounded, true);
    assert.deepEqual(evidenceMap.fields.judgment_criteria?.selected_block_ids, ["t1"]);
    assert.equal(trace.fields.judgment_criteria?.extraction_method, "schema_guided_table_row");
    assert.equal(trace.fields.judgment_criteria?.validation_status, "pass");
    assert.equal(validation.fields.judgment_criteria?.status, "pass");
    assert.ok(validation.typed_validation_pass_rate > 0.9);
    assert.ok(String(result.draft.judgment_criteria[0]?.content).includes("连续3天低于行业均值"));
    assert.equal(result.draft.source_refs.judgment_criteria?.[0]?.block_id, "t1");
  });

  it("records semantic segment evidence and avoids heading-only anchors", () => {
    const segmentIr: DocumentIR = {
      doc_id: "doc-segment-evidence-test",
      version_id: "v0",
      blocks: [
        {
          block_id: "h1",
          block_type: "heading",
          text_content: "判断标准",
          heading_level: 1,
          source_file: "sample.md",
          source_span: "L1",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: ["p1", "p2"],
        },
        {
          block_id: "p1",
          block_type: "paragraph",
          text_content: "点击率连续三天低于同类商品均值时，需要判断入口吸引力下降。",
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
          text_content: "验证方式是对比优化前后的点击率和转化率。",
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
    const segmentCards: SectionCard[] = [
      {
        section_id: "section_h1",
        title: "判断标准",
        source_block_ids: ["h1", "p1", "p2"],
        summary: "说明点击率下降的判断标准和验证方式。",
        key_signals: ["点击率", "连续三天", "均值", "验证方式"],
        covered_schema_fields: ["judgment_criteria", "validation_methods"],
        likely_gaps: [],
        confidence: 0.9,
      },
    ];
    const segmentUnderstanding: DocumentUnderstanding = {
      ...understanding,
      section_summaries: segmentCards,
      key_signals: ["点击率", "连续三天", "验证方式"],
    };
    const segmentHints: SectionEvidenceHints = {
      understanding_profile: "structured_context",
      field_signals: {
        judgment_criteria: ["判断标准", "点击率", "连续三天", "均值"],
        validation_methods: ["验证方式", "对比"],
      },
      sections: [
        {
          section_id: "section_h1",
          title: "判断标准",
          source_block_ids: ["h1", "p1", "p2"],
          table_block_ids: [],
          list_block_ids: [],
          field_evidence_hints: {
            judgment_criteria: {
              block_ids: ["h1", "p1"],
              signals: ["判断标准", "点击率", "连续三天", "均值"],
              reason: "heading names the field but paragraph contains the usable criterion",
            },
            validation_methods: {
              block_ids: ["p2"],
              signals: ["验证方式", "对比"],
              reason: "paragraph contains validation method",
            },
          },
        },
      ],
    };
    const segmentContextualized: ContextualizedBlock[] = segmentIr.blocks.map((block) => ({
      block_id: block.block_id,
      block_type: block.block_type,
      text_content: block.text_content,
      source_refs: [{ block_id: block.block_id, source_file: block.source_file, source_span: block.source_span }],
      semantic_unit_id: block.block_id === "h1" ? undefined : "unit_judgment",
      semantic_unit_summary: "这一组正文共同说明点击率下降时的判断阈值和验证方式。",
      semantic_segment_id: block.block_id === "h1" ? undefined : "seg_judgment",
      block_summary: block.text_content,
      segment_summary: "这一组段落说明点击率下降时的判断阈值和验证方式。",
      section_context: {
        section_id: "section_h1",
        section_title: "判断标准",
        section_type: "metrics",
        section_main_purpose: "说明判断标准和验证方式",
        section_key_points: ["点击率连续三天低于均值"],
      },
      document_context: {
        document_theme: "商品诊断",
        business_scene: "商品链接诊断",
        primary_goal: "提升商品链接诊断质量",
        process_role: "metrics: 判断标准",
      },
      extraction_context: {
        likely_related_schema_fields: ["judgment_criteria", "validation_methods"],
        likely_signal_types: ["点击率", "连续三天", "验证方式"],
        likely_gap_hints: [],
        inference_risk_level: block.block_type === "heading" ? "medium" : "low",
      },
    }));
    const segmentBlockRoleMap: BlockRoleMap = {
      understanding_profile: "structured_context",
      blocks: {
        h1: {
          block_id: "h1",
          primary_role: "overview_statement",
          primary_label: "标题/主题",
          secondary_roles: [],
          compatible_fields: [],
          excluded_primary_fields: ["judgment_criteria", "validation_methods"],
          confidence: 0.7,
          reason: "heading only names the topic",
        },
        p1: {
          block_id: "p1",
          primary_role: "validation_rule",
          primary_label: "判断/验证规则",
          secondary_roles: ["metric_basis"],
          compatible_fields: ["judgment_criteria", "judgment_basis"],
          excluded_primary_fields: [],
          confidence: 0.9,
          reason: "paragraph contains concrete criterion",
        },
        p2: {
          block_id: "p2",
          primary_role: "validation_rule",
          primary_label: "判断/验证规则",
          secondary_roles: [],
          compatible_fields: ["validation_methods"],
          excluded_primary_fields: [],
          confidence: 0.86,
          reason: "paragraph contains validation method",
        },
      },
    };

    const result = schemaGuidedExtractionAdapter.extract({
      ir: segmentIr,
      understanding: segmentUnderstanding,
      sectionCards: segmentCards,
      schemaProfile,
      expertGuidanceProfile,
      evaluationProfile,
      sectionEvidenceHints: segmentHints,
      documentSynthesis,
      contextualizedBlocks: segmentContextualized,
      blockRoleMap: segmentBlockRoleMap,
      semanticSegments: [
        {
          segment_id: "seg_judgment",
          title: "判断标准",
          summary: "这一组段落说明点击率下降时的判断阈值和验证方式。",
          source_block_ids: ["p1", "p2"],
          anchor_block_id: "p1",
          primary_role: "validation_rule",
          related_schema_fields: ["judgment_criteria", "validation_methods"],
          missing_or_weak_fields: [],
          coherence_reason: "连续段落共同说明一个判断标准",
          confidence: 0.9,
        },
      ],
    });
    const evidenceMap = result.extraArtifacts?.schema_guided_evidence_map as {
      fields: Record<
        string,
        {
          selected_block_ids: string[];
          selected_semantic_segment_id?: string;
          semantic_segment_ids?: string[];
          selected_semantic_unit_id?: string;
          semantic_unit_ids?: string[];
        }
      >;
    };

    assert.equal(evidenceMap.fields.judgment_criteria?.selected_block_ids.includes("h1"), false);
    assert.equal(evidenceMap.fields.judgment_criteria?.selected_semantic_segment_id, "seg_judgment");
    assert.deepEqual(evidenceMap.fields.judgment_criteria?.semantic_segment_ids, ["seg_judgment"]);
    assert.equal(evidenceMap.fields.judgment_criteria?.selected_semantic_unit_id, "unit_judgment");
    assert.deepEqual(evidenceMap.fields.judgment_criteria?.semantic_unit_ids, ["unit_judgment"]);
  });

  it("uses block roles and field boundaries to avoid overclaiming overview blocks", () => {
    const overviewIr: DocumentIR = {
      doc_id: "doc-overview-test",
      version_id: "v0",
      blocks: [
        {
          block_id: "overview",
          block_type: "list",
          text_content:
            "1. 商品诊断不是看数据，而是“问题 -> 方案 -> 任务 -> 增长”，并且要按生命周期、诊断维度、指标对标、问题排查、方案执行、数据验证形成闭环。\n2. 链接诊断拆成新品期、成长期、成熟期、爆款期、衰退期，并给出各阶段的核心目标、关键指标和诊断动作。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L1-L2",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
        {
          block_id: "steps",
          block_type: "list",
          text_content: "1. 先确认生命周期阶段。\n2. 再检查核心指标。\n3. 最后生成增长任务。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L3-L5",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
        {
          block_id: "deliverable",
          block_type: "paragraph",
          text_content: "最终输出商品链接诊断结论、增长任务清单和优化方案报告。",
          heading_level: 0,
          source_file: "sample.md",
          source_span: "L6",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
      ],
    };
    const overviewSectionCards: SectionCard[] = [
      {
        section_id: "overview",
        title: "总述",
        source_block_ids: ["overview", "steps", "deliverable"],
        summary: "包含方法总述、执行步骤和交付物。",
        key_signals: ["问题", "方案", "任务", "增长", "步骤", "输出"],
        covered_schema_fields: ["process_flow_or_business_model", "execution_steps", "deliverables"],
        likely_gaps: [],
        confidence: 0.85,
      },
    ];
    const overviewUnderstanding: DocumentUnderstanding = {
      document_theme: "商品诊断",
      business_scene: "商品链接诊断",
      primary_goal: "形成增长任务",
      section_summaries: overviewSectionCards,
      key_signals: ["问题", "方案", "任务", "增长"],
      likely_gaps: [],
      confidence: 0.86,
    };
    const overviewSynthesis: DocumentSynthesis = {
      document_theme: "商品诊断",
      business_scene: "商品链接诊断",
      primary_goal: "形成增长任务",
      process_spine: [{ section_id: "overview", role: "framework: 总述" }],
      key_signals: ["问题", "方案", "任务", "增长"],
      likely_gaps: [],
      quality_risks: [],
      summary_for_agent: "文档先给出方法总述，再给出步骤和交付物。",
      confidence: 0.86,
    };
    const boundarySchema: SchemaProfile = {
      profile_id: "schema.boundary.test",
      version: "v1",
      required_fields: ["process_flow_or_business_model", "execution_steps"],
      optional_fields: ["deliverables"],
      inferred_candidate_fields: ["deliverables"],
      field_definitions: {
        process_flow_or_business_model: { type: "single_text_or_outline", extraction_hint: "优先识别框架、闭环、维度拆解。" },
        execution_steps: { type: "list_step", extraction_hint: "必须有顺序动作、步骤结构或操作路径。" },
        deliverables: { type: "list_text", extraction_hint: "必须出现输出、交付物、产物、报告、清单等交付语义。" },
      },
      field_boundary_rules: {
        execution_steps: {
          allowed_primary_roles: ["action_method"],
          disallowed_primary_roles: ["overview_statement", "process_model"],
          required_any_signals: ["步骤", "先", "再", "最后"],
        },
        deliverables: {
          allowed_primary_roles: ["action_method", "supporting_detail"],
          disallowed_primary_roles: ["overview_statement", "process_model"],
          required_any_signals: ["输出", "交付物", "产物", "报告", "清单"],
          negative_signals: ["问题 -> 方案 -> 任务 -> 增长"],
        },
      },
      normalization_rules: [],
      output_requirements: [],
    };
    const overviewContextualizedBlocks: ContextualizedBlock[] = overviewIr.blocks.map((block) => ({
      block_id: block.block_id,
      block_type: block.block_type,
      text_content: block.text_content,
      source_refs: [{ block_id: block.block_id, source_file: block.source_file, source_span: block.source_span }],
      section_context: {
        section_id: "overview",
        section_title: "总述",
        section_type: block.block_id === "overview" ? "framework" : "actions",
        section_main_purpose: "总述方法框架和执行输出",
        section_key_points: ["问题", "方案", "任务", "增长"],
      },
      document_context: {
        document_theme: "商品诊断",
        business_scene: "商品链接诊断",
        primary_goal: "形成增长任务",
        process_role: "framework: 总述",
      },
      extraction_context: {
        likely_related_schema_fields: ["process_flow_or_business_model", "execution_steps", "deliverables"],
        likely_signal_types: ["问题", "方案", "任务", "增长"],
        likely_gap_hints: [],
        inference_risk_level: block.block_id === "overview" ? "medium" : "low",
      },
    }));
    const overviewBlockRoleMap: BlockRoleMap = {
      understanding_profile: "structured_context",
      blocks: {
        overview: {
          block_id: "overview",
          primary_role: "process_model",
          primary_label: "流程模型",
          secondary_roles: ["overview_statement"],
          compatible_fields: ["process_flow_or_business_model"],
          excluded_primary_fields: ["execution_steps", "deliverables"],
          confidence: 0.9,
          reason: "overview describes the method framework, not concrete steps or deliverables",
        },
        steps: {
          block_id: "steps",
          primary_role: "action_method",
          primary_label: "执行动作",
          secondary_roles: [],
          compatible_fields: ["execution_steps"],
          excluded_primary_fields: [],
          confidence: 0.85,
          reason: "ordered action list",
        },
        deliverable: {
          block_id: "deliverable",
          primary_role: "supporting_detail",
          primary_label: "交付说明",
          secondary_roles: [],
          compatible_fields: ["deliverables"],
          excluded_primary_fields: [],
          confidence: 0.82,
          reason: "explicit output statement",
        },
      },
    };

    const result = schemaGuidedExtractionAdapter.extract({
      ir: overviewIr,
      understanding: overviewUnderstanding,
      sectionCards: overviewSectionCards,
      schemaProfile: boundarySchema,
      expertGuidanceProfile,
      evaluationProfile: {
        ...evaluationProfile,
        critical_fields: ["process_flow_or_business_model", "execution_steps"],
        list_fields: ["execution_steps", "deliverables"],
        single_fields: ["process_flow_or_business_model"],
      },
      documentSynthesis: overviewSynthesis,
      contextualizedBlocks: overviewContextualizedBlocks,
      blockRoleMap: overviewBlockRoleMap,
    });
    const evidenceMap = result.extraArtifacts?.schema_guided_evidence_map as {
      fields: Record<string, { selected_block_ids: string[]; scored_candidates?: { block_id: string; rejected?: boolean }[] }>;
    };

    assert.deepEqual(evidenceMap.fields.process_flow_or_business_model?.selected_block_ids, ["overview"]);
    assert.deepEqual(evidenceMap.fields.execution_steps?.selected_block_ids, ["steps"]);
    assert.deepEqual(evidenceMap.fields.deliverables?.selected_block_ids, ["deliverable"]);
    assert.ok(
      evidenceMap.fields.deliverables?.scored_candidates?.some(
        (candidate) => candidate.block_id === "overview" && candidate.rejected,
      ),
    );
  });
});
