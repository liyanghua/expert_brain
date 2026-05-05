import { useMemo, useState } from "react";
import { FIELD_DEFINITIONS_ZH, type StructuredFieldKey } from "@ebs/ground-truth-schema";
import {
  askQa,
  confirmCandidate,
  createDocument,
  createVersion,
  focusTaskSession,
  getDashboard,
  processNextJob,
  refineQuestion,
  runExtract,
  saveNote,
  uploadSource,
  type DocumentMeta,
} from "./lib/api.js";
import type { AppDataState, DashboardModel, FocusSelection } from "./lib/types.js";
import {
  buildWorkspaceModel,
  isServerTask,
  taskEvidenceBlockIds,
  taskFieldKey,
  taskFieldLabel,
  taskRecommendedQuestion,
} from "./domain/workspace-model.js";

const emptyDataState: AppDataState = {
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
};

const emptyFocus: FocusSelection = {
  task: null,
  activeThreadId: null,
  activeTaskSession: null,
  addedBlockIds: [],
  questionSeed: "",
  refinedQuestion: "",
  lastAnswer: "",
};

function fieldLabel(fieldKey?: string | null) {
  if (!fieldKey) return "未指定字段";
  return FIELD_DEFINITIONS_ZH[fieldKey as StructuredFieldKey]?.label ?? fieldKey;
}

function compareViewModeLabel(status: string) {
  switch (status) {
    case "missing":
      return "缺失";
    case "weak":
      return "偏弱";
    case "conflicting":
      return "冲突";
    case "covered":
      return "已覆盖";
    default:
      return status;
  }
}

function readCandidateText(content: unknown) {
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

function busyLabel(busy: string) {
  switch (busy) {
    case "creating":
      return "正在创建文档...";
    case "uploading":
      return "正在上传并解析来源...";
    case "extracting":
      return "结构化进行中...";
    case "focus-task":
      return "正在创建任务线程...";
    case "refining":
      return "正在整理问题...";
    case "asking":
      return "Agent 正在回答...";
    case "saving-note":
      return "正在保存笔记...";
    case "confirming":
      return "正在写回草稿...";
    case "versioning":
      return "正在创建版本...";
    default:
      return "";
  }
}

export function App() {
  const [docTitle, setDocTitle] = useState("专家大脑样例文档");
  const [dataState, setDataState] = useState<AppDataState>(emptyDataState);
  const [focus, setFocus] = useState<FocusSelection>(emptyFocus);
  const [questionInput, setQuestionInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [candidateEdits, setCandidateEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("idle");
  const [statusMessage, setStatusMessage] = useState("创建文档后即可上传来源并体验任务驱动问答。");

  const dashboard = useMemo<DashboardModel>(() => {
    return buildWorkspaceModel({
      dataState,
      focusTask: focus.task,
      addedBlockIds: focus.addedBlockIds,
    });
  }, [dataState, focus.addedBlockIds, focus.task]);

  async function reloadDoc(docId: string, meta?: DocumentMeta) {
    const dashboard = await getDashboard(docId);
    setDataState({
      meta: meta ?? dashboard.meta,
      ir: dashboard.ir,
      draft: dashboard.draft,
      sourceView: dashboard.source_view,
      documentUnderstanding: dashboard.document_understanding,
      fieldAssessments: dashboard.field_assessments,
      improvementPlan: dashboard.improvement_plan as AppDataState["improvementPlan"],
      threads: dashboard.threads,
      taskSessions: dashboard.task_sessions,
      notes: dashboard.notes,
      candidates: dashboard.candidates,
      versions: dashboard.versions,
      readiness: dashboard.readiness,
      expertMemory: dashboard.expert_memory,
      focusTasks: dashboard.focus_tasks,
    });
  }

  async function handleCreateDocument() {
    try {
      setBusy("creating");
      const meta = await createDocument(docTitle.trim() || "专家大脑样例文档");
      setStatusMessage("文档已创建，可以上传来源文件。");
      await reloadDoc(meta.doc_id, meta);
    } catch (error) {
      setStatusMessage(`创建失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleUploadFile(file: File | null) {
    if (!file || !dataState.meta) return;
    try {
      setBusy("uploading");
      await uploadSource(dataState.meta.doc_id, file);
      await processNextJob(dataState.meta.doc_id);
      setStatusMessage("来源已上传并完成解析，左侧已展示原文 block，现在可以开始结构化。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`上传失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleExtract() {
    if (!dataState.meta) return;
    try {
      setBusy("extracting");
      setStatusMessage("正在进行结构化抽取与任务诊断，可能需要几十秒，请稍候。");
      await runExtract(dataState.meta.doc_id);
      setStatusMessage("结构化完成，已生成新的关键任务。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`结构化失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function focusTask(task: DashboardModel["topTasks"][number]) {
    if (!dataState.meta) return;
    try {
      setBusy("focus-task");
      const result = await focusTaskSession({
        docId: dataState.meta.doc_id,
        taskId: isServerTask(task) ? task.task_id : task.taskId,
        title: `处理 ${taskFieldLabel(task) ?? "当前任务"}`,
        fieldKey: taskFieldKey(task),
        sourceBlockIds: taskEvidenceBlockIds(task),
        recommendedQuestion: taskRecommendedQuestion(task),
      });
      setFocus({
        task: task as FocusSelection["task"],
        activeThreadId: result.thread.thread_id,
        activeTaskSession: result.task_session,
        addedBlockIds: result.task_session.source_block_ids,
        questionSeed: taskRecommendedQuestion(task),
        refinedQuestion: "",
        lastAnswer: "",
      });
      setQuestionInput(taskRecommendedQuestion(task));
      setStatusMessage(`已聚焦任务：${taskFieldLabel(task) ?? "当前任务"}`);
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`聚焦任务失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  function toggleBlock(blockId: string) {
    setFocus((current) => {
      const exists = current.addedBlockIds.includes(blockId);
      const addedBlockIds = exists
        ? current.addedBlockIds.filter((id) => id !== blockId)
        : [...current.addedBlockIds, blockId];
      return {
        ...current,
        addedBlockIds,
        activeTaskSession: current.activeTaskSession
          ? {
              ...current.activeTaskSession,
              source_block_ids: addedBlockIds,
            }
          : current.activeTaskSession,
      };
    });
  }

  async function handleRefineQuestion() {
    if (!dataState.meta) return;
    try {
      setBusy("refining");
      const result = await refineQuestion({
        docId: dataState.meta.doc_id,
        threadId: focus.activeThreadId,
        targetField: taskFieldKey(focus.task),
        evidenceBlockIds: focus.addedBlockIds,
        questionSeed: questionInput,
        gapReason: focus.task?.reason,
      });
      setFocus((current) => ({
        ...current,
        activeThreadId: result.thread_id,
        refinedQuestion: result.refined_question,
      }));
      setQuestionInput(result.refined_question);
      setStatusMessage("问题已整理，可以直接发送给 Agent。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`问题整理失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleAskQa() {
    if (!dataState.meta || !questionInput.trim()) return;
    try {
      setBusy("asking");
      const result = await askQa({
        docId: dataState.meta.doc_id,
        threadId: focus.activeThreadId,
        targetField: taskFieldKey(focus.task),
        evidenceBlockIds: focus.addedBlockIds,
        questionSeed: focus.questionSeed || questionInput,
        question: questionInput,
        gapReason: focus.task?.reason,
      });
      setFocus((current) => ({
        ...current,
        activeThreadId: result.thread_id,
        lastAnswer: result.direct_answer,
      }));
      setStatusMessage("Agent 已回答，可保存笔记或确认写回候选。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`问答失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleSaveNote() {
    if (!dataState.meta || !noteInput.trim()) return;
    try {
      setBusy("saving-note");
      await saveNote({
        docId: dataState.meta.doc_id,
        threadId: focus.activeThreadId,
        content: noteInput.trim(),
        sourceBlockIds: focus.addedBlockIds,
      });
      setNoteInput("");
      setStatusMessage("笔记已保存到当前任务时间线。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`保存笔记失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleConfirmCandidate(candidateId: string) {
    if (!dataState.meta) return;
    try {
      setBusy("confirming");
      await confirmCandidate({
        docId: dataState.meta.doc_id,
        candidateId,
        editedText: candidateEdits[candidateId],
      });
      setStatusMessage("候选已写回 Ground Truth 草稿。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`写回失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  async function handleCreateVersion() {
    if (!dataState.meta) return;
    try {
      setBusy("versioning");
      await createVersion(dataState.meta.doc_id);
      setStatusMessage("已创建新版本快照。");
      await reloadDoc(dataState.meta.doc_id);
    } catch (error) {
      setStatusMessage(`创建版本失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  }

  const attachedBlocks = new Set(focus.addedBlockIds);
  const activeThread =
    dataState.threads.find((thread) => thread.thread_id === focus.activeThreadId) ?? null;
  const activeTimeline =
    dashboard.timeline.find((thread) => thread.threadId === focus.activeThreadId) ?? null;
  const candidateMap = new Map(
    dataState.candidates.map((candidate) => [candidate.candidate_id, candidate] as const),
  );

  return (
    <div className="onb-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">OpenNotebook Expert Brain</div>
          <h1>{dataState.meta?.title ?? "专家大脑子产品"}</h1>
          <p>{statusMessage}</p>
        </div>
        <div className="topbar-actions">
          {busy !== "idle" ? <span className="busy-badge">{busyLabel(busy)}</span> : null}
          <input
            value={docTitle}
            onChange={(event) => setDocTitle(event.target.value)}
            placeholder="输入文档标题"
          />
          <button onClick={handleCreateDocument} disabled={busy !== "idle"}>
            创建文档
          </button>
          <label className="file-trigger">
            添加来源
            <input
              type="file"
              onChange={(event) => handleUploadFile(event.target.files?.[0] ?? null)}
              disabled={!dataState.meta || busy !== "idle"}
            />
          </label>
          <button onClick={handleExtract} disabled={!dataState.meta || busy !== "idle"}>
            运行结构化
          </button>
          <button onClick={handleCreateVersion} disabled={!dataState.meta || busy !== "idle"}>
            新建版本
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="pane pane-sources">
          <div className="pane-header">
            <h2>来源文档</h2>
            <span>{dataState.ir?.blocks.length ?? 0} 个 block</span>
          </div>
          <div className="source-list">
            {!dataState.sourceView || dataState.sourceView.sections.length === 0 ? (
              <div className="empty-state">上传来源并完成解析后，这里会以友好的 block 形式展示原文。</div>
            ) : (
              dataState.sourceView.sections.map((section) => (
                <section key={section.section_id} className="source-section">
                  <div className="source-section-title">{section.title}</div>
                  {section.block_ids
                    .map((blockId) => {
                      const block = dashboard.sourceCards.find((item) => item.blockId === blockId);
                      const node = dataState.sourceView?.nodes.find((item) => item.block_id === blockId);
                      if (!block || !node) return null;
                      return (
                        <article
                          key={block.blockId}
                          className={`source-card ${block.selected ? "is-selected" : ""}`}
                        >
                          <div className="source-card-meta">
                            <span>{node.node_type}</span>
                            <span>{block.sourceSpan ?? block.sourceFile}</span>
                            {block.relevance ? (
                              <span className={`tag tag-${block.relevance}`}>
                                {compareViewModeLabel(block.relevance)}
                              </span>
                            ) : null}
                          </div>
                          <p>{block.text}</p>
                          {node.media_uri ? (
                            <div className="source-asset-hint">包含可视化附件：{node.media_uri}</div>
                          ) : null}
                          <button
                            className="ghost-button"
                            onClick={() => toggleBlock(block.blockId)}
                            disabled={busy !== "idle"}
                          >
                            {attachedBlocks.has(block.blockId) ? "移出对话" : "Add to Chat"}
                          </button>
                        </article>
                      );
                    })
                    .filter(Boolean)}
                </section>
              ))
            )}
          </div>
        </section>

        <section className="pane pane-conversation">
          <div className="pane-header">
            <h2>任务手术台</h2>
            <span>
              {focus.task
                ? `当前任务：${taskFieldLabel(focus.task) ?? "当前任务"}`
                : "先从右侧选择任务"}
            </span>
          </div>
          <div className="context-strip">
            <div>
              <strong>Task Brief</strong>
              <span>
                {focus.task
                  ? taskFieldLabel(focus.task)
                  : "未选择任务"}
              </span>
            </div>
            <div>
              <strong>Evidence Tray</strong>
              <span>{focus.addedBlockIds.length} 个 block</span>
            </div>
            <div>
              <strong>任务状态</strong>
              <span>
                {activeThread?.status ?? (focus.task ? compareViewModeLabel(focus.task.status) : "空闲")}
              </span>
            </div>
          </div>

          <div className="task-stage">
            <section className="stage-card">
              <h3>Task Brief</h3>
              <p>{focus.task?.reason ?? "从右侧选择一个任务，或从左侧选择原文证据开始。"}</p>
              {dataState.documentUnderstanding ? (
                <div className="stage-meta">
                  <strong>全文理解</strong>
                  <p>{dataState.documentUnderstanding.summary}</p>
                </div>
              ) : null}
            </section>

            <section className="stage-card">
              <h3>Evidence Tray</h3>
              {focus.activeTaskSession?.evidence_pack?.blocks?.length ? (
                <div className="evidence-list">
                  {focus.activeTaskSession.evidence_pack.blocks.map((block) => (
                    <article key={block.block_id} className="evidence-card">
                      <div className="source-card-meta">
                        <span>{block.block_type}</span>
                        <span>{block.source_span ?? block.source_file}</span>
                        <span className={`tag tag-${block.origin === "manual" ? "covered" : "weak"}`}>
                          {block.origin === "manual" ? "手动附件" : "检索证据"}
                        </span>
                      </div>
                      <p>{block.text_excerpt}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">还没有聚焦到当前任务的证据包。</div>
              )}
            </section>
          </div>

          <div className="timeline-list">
            {!activeTimeline ? (
              <div className="empty-state">聚焦一个任务后，这里会只展示当前任务的一条清晰时间线。</div>
            ) : (
              <div
                className={`timeline-thread ${
                  focus.activeThreadId === activeTimeline.threadId ? "is-active" : ""
                }`}
              >
                <div className="timeline-head">
                  <button className="thread-button">{activeTimeline.title}</button>
                  <span>{fieldLabel(activeTimeline.fieldKey)}</span>
                </div>
                <ol>
                  {activeTimeline.entries.map((entry) => (
                    <li key={entry.id}>
                      <div className="timeline-entry-title">{entry.title}</div>
                      {entry.body ? <div className="timeline-entry-body">{entry.body}</div> : null}
                      {entry.candidateId && candidateMap.get(entry.candidateId) ? (
                        <div className="timeline-candidate-card">
                          <div className="candidate-card-meta">
                            <strong>
                              {fieldLabel(candidateMap.get(entry.candidateId)?.field_key ?? entry.fieldKey)}
                            </strong>
                            <span>{candidateMap.get(entry.candidateId)?.status}</span>
                          </div>
                          <textarea
                            value={
                              candidateEdits[entry.candidateId] ??
                              readCandidateText(candidateMap.get(entry.candidateId)?.content)
                            }
                            onChange={(event) =>
                              setCandidateEdits((current) => ({
                                ...current,
                                [entry.candidateId!]: event.target.value,
                              }))
                            }
                          />
                          <button
                            onClick={() => handleConfirmCandidate(entry.candidateId!)}
                            disabled={!dataState.meta || busy !== "idle"}
                          >
                            确认写回
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="composer">
            <div className="attachment-row">
              {focus.addedBlockIds.length === 0 ? (
                <span className="muted">还没有加入上下文的 block。</span>
              ) : (
                focus.addedBlockIds.map((blockId) => (
                  <button key={blockId} className="attachment-chip" onClick={() => toggleBlock(blockId)}>
                    {blockId}
                  </button>
                ))
              )}
            </div>
            <textarea
              value={questionInput}
              onChange={(event) => setQuestionInput(event.target.value)}
              placeholder="系统会在这里预填推荐问题，你也可以继续编辑，并把它发送到当前任务时间线。"
            />
            <div className="composer-actions">
              <button onClick={handleRefineQuestion} disabled={!dataState.meta || busy !== "idle"}>
                整理问题
              </button>
              <button onClick={handleAskQa} disabled={!dataState.meta || busy !== "idle"}>
                发送问答
              </button>
            </div>
            {focus.lastAnswer ? (
              <div className="answer-panel">
                <strong>最近回答</strong>
                <p>{focus.lastAnswer}</p>
              </div>
            ) : null}
            <div className="note-panel">
              <textarea
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                placeholder="把这轮问答沉淀成专家笔记。"
              />
              <button onClick={handleSaveNote} disabled={!dataState.meta || busy !== "idle"}>
                保存笔记
              </button>
            </div>
          </div>
        </section>

        <section className="pane pane-tools">
          <div className="pane-header">
            <h2>关键任务</h2>
            <span>仅展示 3 个</span>
          </div>

          <div className="task-list">
            {dashboard.topTasks.length === 0 ? (
              <div className="empty-state">结构化完成后，这里会自动生成 Top 3 关键任务。</div>
            ) : (
              dashboard.topTasks.map((task) => (
                <article
                  key={isServerTask(task) ? task.task_id : task.taskId}
                  className={`task-card ${
                    (focus.task &&
                      ((isServerTask(focus.task) && isServerTask(task) && focus.task.task_id === task.task_id) ||
                        (!isServerTask(focus.task) &&
                          !isServerTask(task) &&
                          focus.task.taskId === task.taskId)))
                      ? "is-active"
                      : ""
                  }`}
                >
                  <div className="task-card-meta">
                    <strong>{taskFieldLabel(task)}</strong>
                    <span className={`tag tag-${task.status}`}>
                      {compareViewModeLabel(task.status)}
                    </span>
                  </div>
                  <p>{task.reason}</p>
                  <small>{taskRecommendedQuestion(task)}</small>
                  <button onClick={() => focusTask(task)} disabled={!dataState.meta || busy !== "idle"}>
                    聚焦任务
                  </button>
                </article>
              ))
            )}
          </div>

          <div className="tool-card">
            <h3>结构化诊断摘要</h3>
            <p>
              候选问题：
              {dataState.improvementPlan?.candidate_questions.length ?? 0}
              个
            </p>
            <ul>
              {(dataState.improvementPlan?.candidate_questions ?? []).slice(0, 3).map((item, index) => (
                <li key={`${item.metric}-${index}`}>{item.question}</li>
              ))}
            </ul>
          </div>

          <div className="tool-card">
            <h3>Readiness</h3>
            <p>{dataState.readiness?.review_summary ?? "完成结构化后显示 readiness 摘要。"}</p>
          </div>

          <div className="tool-card">
            <h3>写回候选摘要</h3>
            <div className="candidate-list">
              {dataState.candidates.length === 0 ? (
                <div className="muted">问答后会自动生成可确认写回卡。</div>
              ) : (
                dataState.candidates.slice(0, 6).map((candidate) => (
                  <article key={candidate.candidate_id} className="candidate-card">
                    <div className="candidate-card-meta">
                      <strong>{fieldLabel(candidate.field_key)}</strong>
                      <span>{candidate.status}</span>
                    </div>
                    <p>{readCandidateText(candidate.content)}</p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="tool-card">
            <h3>发布状态</h3>
            <p>{dataState.readiness?.readiness_status ?? "未生成"}</p>
            <ul>
              {(dataState.readiness?.blocking_issues ?? []).map((issue, index) => (
                <li key={`${issue}-${index}`}>{issue}</li>
              ))}
            </ul>
            <h4>版本</h4>
            <ul>
              {dataState.versions.slice(0, 5).map((version) => (
                <li key={version.version_id}>{version.version_id}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
