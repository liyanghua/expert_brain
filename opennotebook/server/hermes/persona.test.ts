import { describe, expect, it } from "vitest";
import { compileExpertPersona } from "./persona.js";

describe("compileExpertPersona", () => {
  it("builds a hermes-style persona profile from expert memory", () => {
    const persona = compileExpertPersona({
      profile: {
        expert_name: "Alice",
        domain: "电商风控",
        tone: "严谨、像审单老师",
        question_habits: ["先问依据", "再问例外情况"],
        evidence_preference: "优先页面证据和规则描述",
        writeback_style: "短段落+判断条件",
      },
      correction_summaries: ["不要写成口语，要写成 SOP 规则。"],
      recent_questions: [],
      updated_at: "2026-05-02T00:00:00.000Z",
    });

    expect(persona.expert_name).toBe("Alice");
    expect(persona.domain).toBe("电商风控");
    expect(persona.question_habits).toEqual(["先问依据", "再问例外情况"]);
    expect(persona.recent_corrections).toEqual(["不要写成口语，要写成 SOP 规则。"]);
  });

  it("falls back to sensible defaults when memory is sparse", () => {
    const persona = compileExpertPersona({});

    expect(persona.expert_name).toBe("行业专家");
    expect(persona.question_habits.length).toBeGreaterThan(0);
    expect(persona.writeback_style).toContain("Ground Truth");
  });
});
