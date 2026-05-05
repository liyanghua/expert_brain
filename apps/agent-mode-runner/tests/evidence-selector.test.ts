import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SectionCard } from "../src/types.js";
import { selectEvidenceForField } from "../src/tools/evidence-selector.js";

const cards: SectionCard[] = [
  {
    section_id: "s1",
    title: "业务目标",
    source_block_ids: ["b1", "b2"],
    summary: "目标是发现商品链接诊断问题。",
    key_signals: ["目标"],
    covered_schema_fields: ["scenario_goal"],
    likely_gaps: [],
    confidence: 0.8,
  },
  {
    section_id: "s2",
    title: "判断标准",
    source_block_ids: ["b3", "b4"],
    summary: "根据点击率、转化率和阈值判断异常。",
    key_signals: ["点击率", "转化率"],
    covered_schema_fields: ["judgment_basis", "judgment_criteria"],
    likely_gaps: ["缺少验证周期"],
    confidence: 0.8,
  },
];

describe("evidence selector", () => {
  it("selects field-matched evidence and records context coverage", () => {
    const result = selectEvidenceForField({
      fieldKey: "judgment_criteria",
      sectionCards: cards,
      totalBlockCount: 10,
    });

    assert.deepEqual(result.block_ids, ["b3", "b4"]);
    assert.deepEqual(result.coverage.cited_blocks, ["b3", "b4"]);
    assert.deepEqual(result.coverage.covered_sections, ["s2"]);
    assert.equal(result.coverage.risk, "medium");
  });
});
