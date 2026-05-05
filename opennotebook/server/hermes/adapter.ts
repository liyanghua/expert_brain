import { AgentOrchestrator } from "@ebs/agent-core";
import type { ExpertMemory } from "@ebs/ground-truth-schema";
import { compileExpertPersona } from "./persona.js";
import { candidateInputForQa } from "../qa-helpers.js";
import type { NotebookQaAgent, QaAgentAnswerInput, QaAgentRefineInput } from "../types.js";

function mergeMemoryWithPersona(memory: ExpertMemory): ExpertMemory {
  const persona = compileExpertPersona(memory);
  return {
    ...memory,
    profile: {
      ...memory.profile,
      expert_id: memory.profile?.expert_id ?? persona.expert_name,
      display_name: persona.expert_name,
      question_style: `${persona.tone}; ${persona.question_habits.join("；")}`,
      focus_metrics: [
        persona.domain,
        persona.evidence_preference,
      ],
      preferred_terms: [
        persona.writeback_style,
        ...persona.question_habits,
      ],
    },
    correction_summaries: persona.recent_corrections,
  };
}

export class SharedAgentCoreAdapter implements NotebookQaAgent {
  constructor(private readonly orchestrator = new AgentOrchestrator()) {}

  async refineQuestion(input: QaAgentRefineInput) {
    const memory = mergeMemoryWithPersona(input.expertMemory);
    return this.orchestrator.runA2QuestionRefinementAsync({
      ir: input.ir,
      draft: input.draft,
      blockId: input.blockId,
      evidenceBlockIds: input.evidenceBlockIds,
      questionSeed: input.questionSeed ?? null,
      gapReason:
        input.gapReason != null
          ? `${input.gapReason}\n证据摘要：${input.evidencePackSummary ?? "无"}\n线程历史：${input.threadHistorySummary}`
          : `证据摘要：${input.evidencePackSummary ?? "无"}\n线程历史：${input.threadHistorySummary}`,
      targetField: input.targetField ?? null,
      metric: input.metric ?? null,
      expertMemory: memory,
    });
  }

  async answerQuestion(input: QaAgentAnswerInput) {
    const memory = mergeMemoryWithPersona(input.expertMemory);
    return this.orchestrator.runA2QAAsync({
      ir: input.ir,
      draft: input.draft,
      blockId: input.blockId,
      evidenceBlockIds: input.evidenceBlockIds,
      question: input.question,
      qaMode: input.questionSeed?.trim() ? "task_refine_then_qa" : "direct_qa",
      questionSeed: input.questionSeed ?? null,
      gapReason:
        input.gapReason != null
          ? `${input.gapReason}\n证据摘要：${input.evidencePackSummary ?? "无"}\n线程历史：${input.threadHistorySummary}`
          : `证据摘要：${input.evidencePackSummary ?? "无"}\n线程历史：${input.threadHistorySummary}`,
      targetField: input.targetField ?? null,
      metric: input.metric ?? null,
      expertMemory: memory,
    });
  }

  proposeWriteback(input: {
    qa: Awaited<ReturnType<NotebookQaAgent["answerQuestion"]>>;
    requestedTargetField?: string | null;
    evidenceBlockIds: string[];
    question: string;
  }) {
    return candidateInputForQa({
      requestedTargetField: input.requestedTargetField,
      qa: input.qa,
      evidenceBlockIds: input.evidenceBlockIds,
      question: input.question,
    });
  }
}
