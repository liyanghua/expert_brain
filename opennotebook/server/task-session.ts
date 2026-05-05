import { randomUUID } from "node:crypto";
import { TaskThreadSchema, type StructuredFieldKey, type TaskThread } from "@ebs/ground-truth-schema";

export function resolveTaskThreadForFocus(input: {
  docId: string;
  versionId: string;
  taskId: string;
  fieldKey: StructuredFieldKey | null;
  title: string;
  sourceBlockIds: string[];
  recommendedQuestion?: string;
  threads: TaskThread[];
  nowIso: string;
}) {
  const threadId = randomUUID();
  const existing = input.threads.find(
    (thread) =>
      thread.doc_id === input.docId &&
      thread.version_id === input.versionId &&
      thread.task_id === input.taskId &&
      thread.status === "active",
  );

  if (existing) {
    const merged = TaskThreadSchema.parse({
      ...existing,
      field_key: input.fieldKey ?? existing.field_key ?? null,
      title: existing.title || input.title,
      source_block_ids: [...new Set([...existing.source_block_ids, ...input.sourceBlockIds])],
      recommended_question: input.recommendedQuestion ?? existing.recommended_question,
    });
    return { thread: merged, reused: true };
  }

  return {
    reused: false,
    thread: TaskThreadSchema.parse({
      thread_id: threadId,
      doc_id: input.docId,
      version_id: input.versionId,
      task_id: input.taskId,
      field_key: input.fieldKey,
      status: "active",
      title: input.title,
      source_block_ids: input.sourceBlockIds,
      recommended_question: input.recommendedQuestion,
      created_at: input.nowIso,
      latest_step_at: input.nowIso,
      steps: [
        {
          step_id: randomUUID(),
          thread_id: threadId,
          type: "task_started",
          timestamp: input.nowIso,
          payload: {
            field_key: input.fieldKey,
            source_block_ids: input.sourceBlockIds,
          },
        },
      ],
    }),
  };
}
