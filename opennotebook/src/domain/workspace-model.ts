import { buildDocumentIndex, createTopTasks, probePriorityFields } from "./task-planner.js";
import { buildTimeline } from "./timeline.js";
import type { DashboardModel, FocusSelection } from "../lib/types.js";
import type { AppDataState } from "../lib/types.js";
import type { NotebookFocusTask } from "../../server/focus-tasks.js";

export function isServerTask(
  task: DashboardModel["topTasks"][number] | FocusSelection["task"] | null | undefined,
): task is NotebookFocusTask {
  return Boolean(task && typeof task === "object" && "task_id" in task);
}

export function taskFieldKey(
  task: DashboardModel["topTasks"][number] | FocusSelection["task"] | null | undefined,
) {
  if (!task) return null;
  return isServerTask(task) ? task.field_key : task.fieldKey;
}

export function taskFieldLabel(
  task: DashboardModel["topTasks"][number] | FocusSelection["task"] | null | undefined,
) {
  if (!task) return null;
  return isServerTask(task) ? task.field_label : task.fieldLabel;
}

export function taskEvidenceBlockIds(
  task: DashboardModel["topTasks"][number] | FocusSelection["task"] | null | undefined,
) {
  if (!task) return [];
  return isServerTask(task) ? task.evidence_block_ids : task.evidenceBlockIds;
}

export function taskRecommendedQuestion(
  task: DashboardModel["topTasks"][number] | FocusSelection["task"] | null | undefined,
) {
  if (!task) return "";
  return isServerTask(task) ? task.recommended_question : task.recommendedQuestion;
}

export function buildWorkspaceModel(input: {
  dataState: AppDataState;
  focusTask: FocusSelection["task"];
  addedBlockIds: string[];
}): DashboardModel {
  const timeline = buildTimeline({
    threads: input.dataState.threads,
    candidates: input.dataState.candidates,
    notes: input.dataState.notes,
  });
  const focusedFieldKey = taskFieldKey(input.focusTask);

  if (!input.dataState.ir) {
    return {
      topTasks: [],
      timeline,
      sourceCards: [],
      activeThread: null,
      activeEvidencePack: null,
    };
  }

  const index = buildDocumentIndex(input.dataState.ir);
  const sourceCards = index.map((block) => ({
    ...block,
    selected: false,
    relevance: null,
  }));

  if (!input.dataState.draft) {
    const selectedBlocks = new Set(input.addedBlockIds);
    return {
      topTasks: [],
      timeline,
      sourceCards: sourceCards.map((block) => ({
        ...block,
        selected: selectedBlocks.has(block.blockId),
      })),
      activeThread: null,
      activeEvidencePack: null,
    };
  }

  const probes = probePriorityFields({
    ir: input.dataState.ir,
    draft: input.dataState.draft,
    index,
  });
  const topTasks =
    input.dataState.focusTasks.length > 0
      ? input.dataState.focusTasks
      : createTopTasks({ probes, limit: 3 });
  const taskBlockIds = new Set([
    ...taskEvidenceBlockIds(input.focusTask),
    ...input.addedBlockIds,
  ]);
  const probeByBlock = new Map<string, string>();
  for (const probe of probes) {
    for (const evidence of probe.evidence) {
      if (!probeByBlock.has(evidence.blockId)) {
        probeByBlock.set(evidence.blockId, probe.status);
      }
    }
  }

  return {
    topTasks,
    timeline,
    sourceCards: sourceCards.map((block) => ({
      ...block,
      selected: taskBlockIds.has(block.blockId),
      relevance: (probeByBlock.get(block.blockId) as
        | "covered"
        | "weak"
        | "missing"
        | "conflicting"
        | null
        | undefined) ?? null,
    })),
    activeThread:
      timeline.find((thread) => thread.fieldKey === focusedFieldKey) ?? null,
    activeEvidencePack:
      (input.dataState.taskSessions ?? []).find(
        (session) =>
          session.field_key &&
          session.field_key === focusedFieldKey,
      )?.evidence_pack ?? null,
  };
}
