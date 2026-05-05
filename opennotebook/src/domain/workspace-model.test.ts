import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import type { NotebookFocusTask } from "../../server/focus-tasks.js";
import type { AppDataState } from "../lib/types.js";
import { buildWorkspaceModel, taskFieldKey } from "./workspace-model.js";

function createIr(texts: Array<{ id: string; type?: string; text: string }>): DocumentIR {
  return {
    doc_id: "doc-1",
    version_id: "v1",
    blocks: texts.map((item, index) => ({
      block_id: item.id,
      block_type: item.type ?? "paragraph",
      text_content: item.text,
      heading_level: 0,
      source_file: "doc.md",
      source_span: `L${index + 1}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    })),
  };
}

function createDataState(overrides: Partial<AppDataState> = {}): AppDataState {
  return {
    meta: null,
    ir: null,
    draft: null,
    sourceView: null,
    documentUnderstanding: null,
    fieldAssessments: [],
    improvementPlan: null,
    threads: [],
    taskSessions: [],
    notes: [],
    candidates: [],
    versions: [],
    readiness: null,
    expertMemory: null,
    focusTasks: [],
    ...overrides,
  };
}

describe("workspace model", () => {
  it("shows source cards as soon as IR is available even before structuring draft exists", () => {
    const ir = createIr([
      { id: "b1", text: "第一步：打开系统。" },
      { id: "b2", text: "第二步：填写记录表。" },
    ]);

    const model = buildWorkspaceModel({
      dataState: createDataState({ ir, draft: null }),
      focusTask: null,
      addedBlockIds: [],
    });

    expect(model.sourceCards.map((item) => item.blockId)).toEqual(["b1", "b2"]);
    expect(model.topTasks).toEqual([]);
  });

  it("reads target field from server tasks that use snake_case keys", () => {
    const task: NotebookFocusTask = {
      task_id: "task-judgment_basis",
      field_key: "judgment_basis",
      field_label: "判断依据",
      priority_score: 0.96,
      status: "missing",
      reason: "缺少支撑证据",
      recommended_question: "请补充判断依据。",
      evidence_block_ids: ["b2"],
      evidence: [],
    };

    expect(taskFieldKey(task)).toBe("judgment_basis");
  });

  it("keeps server-generated focus tasks when draft already exists", () => {
    const ir = createIr([{ id: "b1", text: "系统没有给出判断标准。" }]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");
    const task: NotebookFocusTask = {
      task_id: "task-judgment_criteria",
      field_key: "judgment_criteria",
      field_label: "判断标准",
      priority_score: 0.95,
      status: "missing",
      reason: "缺少标准",
      recommended_question: "请补充判断标准。",
      evidence_block_ids: [],
      evidence: [],
    };

    const model = buildWorkspaceModel({
      dataState: createDataState({ ir, draft, focusTasks: [task] }),
      focusTask: task,
      addedBlockIds: [],
    });

    expect(model.topTasks).toHaveLength(1);
    expect("task_id" in model.topTasks[0]).toBe(true);
  });
});
