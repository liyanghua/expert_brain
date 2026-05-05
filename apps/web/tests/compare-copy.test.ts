import { describe, expect, it } from "vitest";
import {
  describeEvidenceForOps,
  describeStructuredFieldForOps,
} from "../src/compare-copy";

describe("describeEvidenceForOps", () => {
  it("turns a technical source block into an operator-facing evidence card", () => {
    const copy = describeEvidenceForOps({
      blockType: "heading",
      text: "80% 诊断工作在上架前完成，上架后只做验证与优化",
      targetFieldLabel: "执行步骤",
    });

    expect(copy.typeLabel).toBe("章节");
    expect(copy.usageHint).toBe("可用于补充“执行步骤”的判断依据或执行动作。");
    expect(copy.actionLabel).toBe("用这段作为问答依据");
  });

  it("prefers the caller's existing block type label", () => {
    const copy = describeEvidenceForOps({
      blockType: "list",
      blockTypeLabel: "列表",
      text: "- 第一步：确认目标\n- 第二步：检查数据",
      targetFieldLabel: "执行动作",
    });

    expect(copy.typeLabel).toBe("列表");
  });
});

describe("describeStructuredFieldForOps", () => {
  it("summarizes what is missing and what the operator should do next", () => {
    const copy = describeStructuredFieldForOps({
      fieldLabel: "执行步骤",
      status: "missing",
      statusLabel: "缺内容",
      reason: "缺少可落地执行步骤。",
      itemCount: 0,
      sourceCount: 2,
    });

    expect(copy.headline).toBe("“执行步骤”还没有可直接采用的内容");
    expect(copy.gapSummary).toBe("缺少可落地执行步骤。");
    expect(copy.nextStep).toBe("建议先确认左侧原文依据，再让 Agent 生成可写入草稿的补充内容。");
  });
});
