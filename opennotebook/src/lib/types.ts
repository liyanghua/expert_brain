import type { DocumentIR } from "@ebs/document-ir";
import type {
  ExpertMemory,
  ExpertNote,
  GTCandidate,
  GroundTruthDraft,
  PublishReadinessResponse,
  TaskThread,
  VersionRecord,
} from "@ebs/ground-truth-schema";
import type { FocusTask, IndexedBlock, ProbeStatus } from "../domain/task-planner.js";
import type { TimelineThread } from "../domain/timeline.js";
import type { DocumentMeta, ImprovementPlan } from "./api.js";
import type { NotebookFocusTask } from "../../server/focus-tasks.js";
import type {
  FieldAssessment,
  SourceViewModel,
} from "../../server/workbench.js";
import type {
  NotebookDocumentUnderstanding,
  NotebookEvidencePack,
} from "../../server/evidence-pack.js";
import type { NotebookTaskSession } from "../../server/types.js";

export type AppDataState = {
  meta: DocumentMeta | null;
  ir: DocumentIR | null;
  draft: GroundTruthDraft | null;
  sourceView: SourceViewModel | null;
  documentUnderstanding: NotebookDocumentUnderstanding | null;
  fieldAssessments: FieldAssessment[];
  improvementPlan: ImprovementPlan | null;
  threads: TaskThread[];
  taskSessions: NotebookTaskSession[];
  notes: ExpertNote[];
  candidates: GTCandidate[];
  versions: VersionRecord[];
  readiness: PublishReadinessResponse | null;
  expertMemory: ExpertMemory | null;
  focusTasks: NotebookFocusTask[];
};

export type FocusSelection = {
  task: FocusTask | null;
  activeThreadId: string | null;
  activeTaskSession: NotebookTaskSession | null;
  addedBlockIds: string[];
  questionSeed: string;
  refinedQuestion: string;
  lastAnswer: string;
};

export type SourceCard = IndexedBlock & {
  selected: boolean;
  relevance?: ProbeStatus | null;
};

export type DashboardModel = {
  topTasks: Array<FocusTask | NotebookFocusTask>;
  timeline: TimelineThread[];
  sourceCards: SourceCard[];
  activeThread: TimelineThread | null;
  activeEvidencePack: NotebookEvidencePack | null;
};
