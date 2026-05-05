import { describe, expect, it } from "vitest";
import type { TaskThread } from "@ebs/ground-truth-schema";
import { resolveTaskThreadForFocus } from "./task-session.js";

function createThread(input: Partial<TaskThread> & Pick<TaskThread, "thread_id" | "task_id" | "doc_id" | "version_id" | "title" | "created_at" | "latest_step_at">): TaskThread {
  return {
    field_key: null,
    status: "active",
    source_block_ids: [],
    steps: [],
    ...input,
  };
}

describe("task session focus", () => {
  it("reuses an active thread for the same task id and version", () => {
    const existing = createThread({
      thread_id: "thread-1",
      task_id: "task-judgment_basis",
      doc_id: "doc-1",
      version_id: "v1",
      title: "处理 判断依据",
      created_at: "2026-05-02T00:00:00.000Z",
      latest_step_at: "2026-05-02T00:01:00.000Z",
      field_key: "judgment_basis",
    });

    const result = resolveTaskThreadForFocus({
      docId: "doc-1",
      versionId: "v1",
      taskId: "task-judgment_basis",
      fieldKey: "judgment_basis",
      title: "处理 判断依据",
      sourceBlockIds: ["b2"],
      recommendedQuestion: "请补充判断依据。",
      threads: [existing],
      nowIso: "2026-05-02T00:02:00.000Z",
    });

    expect(result.thread.thread_id).toBe("thread-1");
    expect(result.reused).toBe(true);
    expect(result.thread.source_block_ids).toContain("b2");
  });

  it("creates an exploratory thread when there is no focused task yet", () => {
    const result = resolveTaskThreadForFocus({
      docId: "doc-1",
      versionId: "v1",
      taskId: "exploratory",
      fieldKey: null,
      title: "探索当前问题",
      sourceBlockIds: ["b3"],
      recommendedQuestion: "请解释这段证据意味着什么。",
      threads: [],
      nowIso: "2026-05-02T00:02:00.000Z",
    });

    expect(result.reused).toBe(false);
    expect(result.thread.task_id).toBe("exploratory");
    expect(result.thread.source_block_ids).toEqual(["b3"]);
  });
});
