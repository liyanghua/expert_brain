import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import {
  emptyGroundTruthDraft,
  type GroundTruthDraft,
} from "@ebs/ground-truth-schema";
import {
  METRIC_DEFINITIONS_ZH,
  buildCandidateQuestionsFromScorecard,
  buildImprovementPlan,
  computeExtractionScorecard,
} from "./index.js";

const ir: DocumentIR = {
  doc_id: "doc-1",
  version_id: "v1",
  blocks: [
    {
      block_id: "b1",
      block_type: "paragraph",
      text_content: "商品诊断需要补充判断标准与输出成果。",
      heading_level: 0,
      source_file: "doc.md",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    },
  ],
};

function sparseDraft(): GroundTruthDraft {
  const draft = emptyGroundTruthDraft("doc-1", "v1");
  draft.business_scenario = {
    content: { text: "商品诊断" },
    status: "Drafted",
    source_refs: [],
  };
  return draft;
}

describe("localized scorecard", () => {
  it("returns Chinese definitions for every computed metric", () => {
    const scorecard = computeExtractionScorecard({
      draft: sparseDraft(),
      ir,
    });

    expect(METRIC_DEFINITIONS_ZH.field_coverage.label).toBe("字段完整度");
    expect(scorecard.metric_definitions.field_coverage!.calculation).toContain(
      "已填字段数",
    );
    expect(scorecard.metric_definitions.source_grounding_rate!.thresholds).toContain(
      "目标",
    );
  });

  it("builds candidate questions from low score metrics", () => {
    const draft = sparseDraft();
    const scorecard = computeExtractionScorecard({ draft, ir });
    const questions = buildCandidateQuestionsFromScorecard(scorecard, draft, ir);
    const plan = buildImprovementPlan(scorecard, draft, ir);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.metric === "field_coverage")).toBe(true);
    expect(questions[0]?.question).toContain("缺");
    expect(plan.candidate_questions.length).toBeGreaterThan(0);
  });
});
