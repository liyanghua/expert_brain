import { describe, expect, it } from "vitest";
import { describeQualityIssueForOps } from "../src/quality-copy";

describe("describeQualityIssueForOps", () => {
  it("turns English model diagnostics into business-friendly Chinese copy", () => {
    const copy = describeQualityIssueForOps({
      summary: "Build AI-augmented diagnostic template",
      reason:
        "Document states 'AI handles efficiency', yet provides no tool templates — critical for scaling diagnosis.",
      fieldLabel: "工具与模板",
      issueType: "missing_or_weak_tool_templates",
      severity: "high",
    });

    expect(copy.headline).toBe("补充可复用的工具模板");
    expect(copy.description).toContain("表格、模板、SOP");
    expect(copy.priorityLabel).toBe("高优先级");
  });

  it("keeps already friendly Chinese issue copy", () => {
    const copy = describeQualityIssueForOps({
      summary: "缺少判断标准",
      reason: "需要补充正常、异常和例外场景的判断口径。",
      fieldLabel: "判断标准",
      severity: "medium",
    });

    expect(copy.headline).toBe("缺少判断标准");
    expect(copy.description).toBe("需要补充正常、异常和例外场景的判断口径。");
  });
});
