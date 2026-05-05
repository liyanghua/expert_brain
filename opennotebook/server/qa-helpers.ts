import {
  STRUCTURED_FIELD_KEYS,
  emptyGroundTruthDraft,
  type GroundTruthDraft,
  type QAResponse,
  type StructuredFieldKey,
} from "@ebs/ground-truth-schema";

function isStructuredFieldKey(value: string | null | undefined): value is StructuredFieldKey {
  return Boolean(value && (STRUCTURED_FIELD_KEYS as readonly string[]).includes(value));
}

export async function draftForQaContext(input: {
  docId: string;
  versionId: string;
  readDraft: () => GroundTruthDraft | null | Promise<GroundTruthDraft | null>;
}): Promise<GroundTruthDraft> {
  const draft = await input.readDraft();
  return draft ?? emptyGroundTruthDraft(input.docId, input.versionId);
}

function fallbackCandidateField(text: string): StructuredFieldKey {
  if (/判断|依据|为什么|理由|原因/.test(text)) return "judgment_basis";
  if (/标准|阈值|区间|数量|质量|时限|频率/.test(text)) return "judgment_criteria";
  if (/方法|怎么做|解决|排查|修复|优化/.test(text)) return "resolution_methods";
  if (/步骤|动作|执行|操作|任务/.test(text)) return "execution_actions";
  return "key_node_rationales";
}

export function candidateInputForQa(input: {
  requestedTargetField?: string | null;
  qa: QAResponse;
  evidenceBlockIds: string[];
  question: string;
}) {
  const modelField = input.qa.suggested_writeback?.field_key ?? input.qa.target_field ?? null;
  const fieldKey =
    (isStructuredFieldKey(input.requestedTargetField) ? input.requestedTargetField : null) ??
    (isStructuredFieldKey(modelField) ? modelField : null) ??
    fallbackCandidateField(
      [
        input.requestedTargetField,
        modelField,
        input.question,
        input.qa.direct_answer,
        input.qa.rationale,
      ]
        .filter(Boolean)
        .join("\n"),
    );

  return {
    fieldKey,
    content: input.qa.suggested_writeback?.content ?? { text: input.qa.direct_answer },
    sourceBlockIds: input.qa.source_block_refs.length ? input.qa.source_block_refs : input.evidenceBlockIds,
  };
}
