import { describe, expect, it } from "vitest";
import type { ExpertNote, GTCandidate, TaskThread } from "@ebs/ground-truth-schema";
import { buildTimeline } from "./timeline.js";

describe("timeline builder", () => {
  it("builds a stable ordered task timeline from thread steps", () => {
    const threads: TaskThread[] = [
      {
        thread_id: "thread-1",
        doc_id: "doc-1",
        version_id: "v1",
        task_id: "task-judgment_criteria",
        field_key: "judgment_criteria",
        status: "completed",
        title: "补充判断标准",
        source_block_ids: ["b1"],
        recommended_question: "请补充判断标准",
        created_at: "2026-05-02T00:00:00.000Z",
        latest_step_at: "2026-05-02T00:04:00.000Z",
        steps: [
          {
            step_id: "s4",
            thread_id: "thread-1",
            type: "writeback_confirmed",
            timestamp: "2026-05-02T00:03:00.000Z",
            payload: { field_key: "judgment_criteria" },
          },
          {
            step_id: "s1",
            thread_id: "thread-1",
            type: "task_started",
            timestamp: "2026-05-02T00:00:00.000Z",
            payload: {},
          },
          {
            step_id: "s3",
            thread_id: "thread-1",
            type: "agent_answered",
            timestamp: "2026-05-02T00:02:00.000Z",
            payload: { answer: "高风险订单需升级处理" },
          },
          {
            step_id: "s2",
            thread_id: "thread-1",
            type: "question_sent",
            timestamp: "2026-05-02T00:01:00.000Z",
            payload: { question: "请补充标准" },
          },
        ],
      },
    ];
    const candidates: GTCandidate[] = [
      {
        candidate_id: "c1",
        thread_id: "thread-1",
        doc_id: "doc-1",
        version_id: "v1",
        field_key: "judgment_criteria",
        content: { text: "高风险订单需升级处理" },
        source_refs: [{ block_id: "b1" }],
        status: "confirmed",
        recommended_mode: "append",
        created_from_step_id: null,
        rationale: "来自专家问答",
        created_at: "2026-05-02T00:02:30.000Z",
        updated_at: "2026-05-02T00:03:00.000Z",
      },
    ];
    const notes: ExpertNote[] = [
      {
        note_id: "n1",
        doc_id: "doc-1",
        thread_id: "thread-1",
        content: "需要后续补充更多例外情况",
        source_block_ids: ["b1"],
        created_at: "2026-05-02T00:02:40.000Z",
        updated_at: "2026-05-02T00:02:40.000Z",
      },
    ];

    const timeline = buildTimeline({ threads, candidates, notes });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.entries.map((entry) => entry.type)).toEqual([
      "task_started",
      "question_sent",
      "agent_answered",
      "gt_candidate_created",
      "note_saved",
      "writeback_confirmed",
    ]);
  });
});
