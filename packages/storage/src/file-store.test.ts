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
});
