import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileStore } from "./file-store.js";

describe("FileStore expert memory and versions", () => {
  it("persists expert memory and lists version records", () => {
    const root = mkdtempSync(join(tmpdir(), "ebs-store-"));
    try {
      const store = new FileStore(root);
      store.writeExpertMemory("doc-1", {
        profile: {
          expert_id: "e1",
          display_name: "运营专家",
          question_style: "先问指标，再问动作",
          focus_metrics: ["field_coverage"],
          preferred_terms: ["商品诊断"],
        },
        correction_summaries: ["偏好用业务动作表述"],
        recent_questions: ["还缺哪些判断标准？"],
        updated_at: "2026-01-01T00:00:00.000Z",
      });
      store.writeVersionRecord("doc-1", {
        version_id: "v1",
        parent_version_id: null,
        doc_snapshot_path: "ir.json",
        ground_truth_snapshot_path: "draft.json",
        change_summary: "init",
        created_by: "test",
        created_at: "2026-01-01T00:00:00.000Z",
      });

      expect(store.readExpertMemory("doc-1").profile.display_name).toBe(
        "运营专家",
      );
      expect(store.listVersionRecords("doc-1").map((v) => v.version_id)).toEqual([
        "v1",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists task threads, thread steps, gt candidates and expert notes", () => {
    const root = mkdtempSync(join(tmpdir(), "ebs-store-"));
    try {
      const store = new FileStore(root);
      store.upsertTaskThread("doc-1", {
        thread_id: "thread-1",
        doc_id: "doc-1",
        version_id: "v1",
        task_id: "task-judgment-basis",
        field_key: "judgment_basis",
        status: "active",
        title: "补充判断依据",
        source_block_ids: ["b1", "b2"],
        recommended_question: "这段内容缺少哪些判断依据？",
        created_at: "2026-01-01T00:00:00.000Z",
        latest_step_at: "2026-01-01T00:00:00.000Z",
        steps: [],
      });
      store.appendThreadStep("doc-1", "thread-1", {
        step_id: "step-1",
        thread_id: "thread-1",
        type: "question_sent",
        timestamp: "2026-01-01T00:01:00.000Z",
        payload: { question: "请说明判断依据" },
      });
      store.upsertGTCandidate("doc-1", {
        candidate_id: "candidate-1",
        thread_id: "thread-1",
        doc_id: "doc-1",
        version_id: "v1",
        field_key: "judgment_basis",
        content: { text: "基于点击率和转化率判断。" },
        source_refs: [{ block_id: "b1" }],
        status: "draft",
        recommended_mode: "append",
        created_from_step_id: "step-1",
        rationale: "来自 QA 回答",
        created_at: "2026-01-01T00:02:00.000Z",
        updated_at: "2026-01-01T00:02:00.000Z",
      });
      store.upsertExpertNote("doc-1", {
        note_id: "note-1",
        doc_id: "doc-1",
        thread_id: "thread-1",
        content: "专家补充：优先看转化率是否同步变化。",
        source_block_ids: ["b2"],
        created_at: "2026-01-01T00:03:00.000Z",
        updated_at: "2026-01-01T00:03:00.000Z",
      });

      expect(store.listTaskThreads("doc-1")[0]?.steps.map((s) => s.type)).toEqual([
        "question_sent",
      ]);
      expect(store.listGTCandidates("doc-1")[0]?.field_key).toBe(
        "judgment_basis",
      );
      expect(store.listExpertNotes("doc-1")[0]?.content).toContain("转化率");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
