import type {
  ExpertNote,
  GTCandidate,
  TaskThread,
  ThreadStepType,
} from "@ebs/ground-truth-schema";

export type TimelineEntry = {
  id: string;
  at: string;
  type: ThreadStepType | "gt_candidate_created";
  title: string;
  body?: string;
  candidateId?: string;
  fieldKey?: string | null;
};

export type TimelineThread = {
  threadId: string;
  title: string;
  fieldKey?: string | null;
  status: TaskThread["status"];
  startedAt: string;
  latestAt: string;
  entries: TimelineEntry[];
};

function candidateText(candidate: GTCandidate) {
  const content = candidate.content;
  if (
    content &&
    typeof content === "object" &&
    "text" in content &&
    typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text;
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

function stepTitle(type: ThreadStepType) {
  switch (type) {
    case "task_started":
      return "开始任务";
    case "question_suggested":
      return "生成问题";
    case "question_edited":
      return "编辑问题";
    case "question_sent":
      return "发送提问";
    case "agent_answered":
      return "Agent 回答";
    case "note_saved":
      return "保存笔记";
    case "gt_candidate_created":
      return "生成写回候选";
    case "writeback_confirmed":
      return "确认写回";
    case "writeback_rejected":
      return "拒绝写回";
    case "task_completed":
      return "任务完成";
  }
}

function stepBody(step: TaskThread["steps"][number]) {
  const payload = step.payload;
  if (typeof payload.question === "string") return payload.question;
  if (typeof payload.refined_question === "string") return payload.refined_question;
  if (typeof payload.answer === "string") return payload.answer;
  if (typeof payload.content === "string") return payload.content;
  return undefined;
}

export function buildTimeline(input: {
  threads: TaskThread[];
  candidates: GTCandidate[];
  notes: ExpertNote[];
}): TimelineThread[] {
  const notesByThread = new Map<string, ExpertNote[]>();
  for (const note of input.notes) {
    if (!note.thread_id) continue;
    const list = notesByThread.get(note.thread_id) ?? [];
    list.push(note);
    notesByThread.set(note.thread_id, list);
  }

  const candidatesByThread = new Map<string, GTCandidate[]>();
  for (const candidate of input.candidates) {
    if (!candidate.thread_id) continue;
    const list = candidatesByThread.get(candidate.thread_id) ?? [];
    list.push(candidate);
    candidatesByThread.set(candidate.thread_id, list);
  }

  return [...input.threads]
    .sort(
      (a, b) =>
        new Date(b.latest_step_at).getTime() - new Date(a.latest_step_at).getTime(),
    )
    .map((thread) => {
      const entries: TimelineEntry[] = thread.steps.map((step) => ({
        id: step.step_id,
        at: step.timestamp,
        type: step.type,
        title: stepTitle(step.type),
        body: stepBody(step),
      }));
      const hasNoteStep = thread.steps.some((step) => step.type === "note_saved");
      const hasCandidateStep = thread.steps.some(
        (step) => step.type === "gt_candidate_created",
      );

      if (!hasNoteStep) {
        for (const note of notesByThread.get(thread.thread_id) ?? []) {
          entries.push({
            id: note.note_id,
            at: note.created_at,
            type: "note_saved",
            title: "保存笔记",
            body: note.content,
          });
        }
      }

      if (!hasCandidateStep) {
        for (const candidate of candidatesByThread.get(thread.thread_id) ?? []) {
          entries.push({
            id: candidate.candidate_id,
            at: candidate.created_at,
            type: "gt_candidate_created",
            title: "生成写回候选",
            body: candidateText(candidate),
            candidateId: candidate.candidate_id,
            fieldKey: candidate.field_key,
          });
        }
      }

      return {
        threadId: thread.thread_id,
        title: thread.title,
        fieldKey: thread.field_key,
        status: thread.status,
        startedAt: thread.created_at,
        latestAt: thread.latest_step_at,
        entries: entries.sort(
          (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
        ),
      };
    });
}
