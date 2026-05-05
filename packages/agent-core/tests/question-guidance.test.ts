import { describe, expect, it } from "vitest";
import {
  buildGuidedQuestionSeed,
  guidanceForField,
  guidanceForPrompt,
} from "../src/question-guidance.js";

describe("question guidance", () => {
  it("maps structured fields to expert interview guidance", () => {
    const guidance = guidanceForField("execution_steps");

    expect(guidance?.label).toBe("执行步骤");
    expect(guidance?.examples).toEqual(
      expect.arrayContaining([
        expect.stringContaining("实际操作顺序"),
        expect.stringContaining("哪些动作看起来简单"),
      ]),
    );
  });

  it("builds compact prompt guidance for a target field", () => {
    const prompt = guidanceForPrompt("judgment_basis", 2);

    expect(prompt).toContain("判断依据");
    expect(prompt).toContain("您通常通过哪些核心指标");
    expect(prompt).toContain("预警信号");
    expect(prompt).not.toContain("优秀、正常、较差");
  });

  it("builds a natural fallback question when a seed is too generic", () => {
    const question = buildGuidedQuestionSeed({
      fieldKey: "execution_steps",
      seed: "请补充执行步骤",
      gapReason: "缺少具体操作顺序",
    });

    expect(question).toContain("老师");
    expect(question).toContain("能不能请您按照实际操作顺序");
    expect(question).toContain("缺少具体操作顺序");
  });

  it("does not duplicate the salutation when guidance already includes it", () => {
    const question = buildGuidedQuestionSeed({
      fieldKey: "business_scenario",
      seed: "请补充业务场景",
    });

    expect(question).toContain("老师，您能先帮我们描述一下");
    expect(question).not.toContain("老师，老师");
  });
});
