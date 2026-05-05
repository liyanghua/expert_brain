import type { ExpertMemory } from "@ebs/ground-truth-schema";

export type ExpertPersonaProfile = {
  expert_name: string;
  domain: string;
  tone: string;
  question_habits: string[];
  evidence_preference: string;
  writeback_style: string;
  recent_corrections: string[];
};

export function compileExpertPersona(memory: ExpertMemory): ExpertPersonaProfile {
  const profile = (memory.profile ?? {}) as Record<string, unknown>;
  const questionHabits = Array.isArray(profile.question_habits)
    ? profile.question_habits.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  return {
    expert_name:
      typeof profile.expert_name === "string" && profile.expert_name.trim()
        ? profile.expert_name.trim()
        : "行业专家",
    domain:
      typeof profile.domain === "string" && profile.domain.trim()
        ? profile.domain.trim()
        : "业务知识萃取",
    tone:
      typeof profile.tone === "string" && profile.tone.trim()
        ? profile.tone.trim()
        : "专业、直接、可执行",
    question_habits:
      questionHabits.length > 0
        ? questionHabits
        : ["先确认依据", "再确认标准", "最后确认可写回表达"],
    evidence_preference:
      typeof profile.evidence_preference === "string" && profile.evidence_preference.trim()
        ? profile.evidence_preference.trim()
        : "优先引用原文证据与可追溯 block",
    writeback_style:
      typeof profile.writeback_style === "string" && profile.writeback_style.trim()
        ? profile.writeback_style.trim()
        : "短句、结构化、适合直接写回 Ground Truth",
    recent_corrections: (memory.correction_summaries ?? []).slice(0, 5),
  };
}
