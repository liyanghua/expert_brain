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

  it("persists global quality triage, quality issues and source annotation projections", () => {
    const root = mkdtempSync(join(tmpdir(), "ebs-store-"));
    try {
      const store = new FileStore(root);
      store.writeGlobalQualityTriage("doc-1", "v1", {
        summary: "文档缺少判断标准。",
        major_gaps: [],
        recommended_tasks: [
          {
            title: "补充判断标准",
            reason: "当前 block 只有动作，没有判断口径。",
            question: "这里的异常判断标准是什么？",
            target_field: "judgment_criteria",
            source_block_ids: ["b4"],
            priority: "high",
          },
        ],
        suggested_questions: [],
        source_refs: [{ block_id: "b2" }],
      });
      store.writeQualityIssueIndex("doc-1", "v1", {
        doc_id: "doc-1",
        version_id: "v1",
        generated_at: "2026-05-02T07:00:00.000Z",
        global_context_summary: "文档缺少判断标准。",
        issues: [
          {
            issue_id: "issue-criteria",
            severity: "high",
            issue_type: "missing_judgment_criteria",
            summary: "缺少判断正常或异常的标准。",
            primary_block_ids: ["b4"],
            supporting_block_ids: ["b2"],
            target_field: "judgment_criteria",
            recommended_question: "这里的异常判断标准是什么？",
            confidence: 0.82,
          },
        ],
      });
      store.upsertSourceAnnotation("doc-1", {
        annotation_id: "annotation-issue",
        doc_id: "doc-1",
        version_id: "v1",
        block_id: "b4",
        field_key: "judgment_criteria",
        content: "缺少判断正常或异常的标准。",
        annotation_type: "quality_issue",
        issue_id: "issue-criteria",
        severity: "high",
        issue_type: "missing_judgment_criteria",
        block_role: "primary",
        recommended_question: "这里的异常判断标准是什么？",
        created_at: "2026-05-02T07:00:00.000Z",
        updated_at: "2026-05-02T07:00:00.000Z",
      });

      expect(
        store.readGlobalQualityTriage("doc-1", "v1")?.recommended_tasks[0]
          ?.source_block_ids,
      ).toEqual(["b4"]);
      expect(store.readQualityIssueIndex("doc-1", "v1")?.issues[0]?.issue_id).toBe(
        "issue-criteria",
      );
      expect(store.listSourceAnnotations("doc-1", "v1")[0]?.annotation_type).toBe(
        "quality_issue",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
