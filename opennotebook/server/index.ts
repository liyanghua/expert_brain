import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { AgentOrchestrator } from "@ebs/agent-core";
import type { DocumentIR } from "@ebs/document-ir";
import {
  buildImprovementPlan,
  computeExtractionScorecard,
} from "@ebs/extraction-scorecard";
import {
  ExpertMemorySchema,
  ExpertNoteSchema,
  GTCandidateSchema,
  GroundTruthDraftSchema,
  STRUCTURED_FIELD_KEYS,
  TaskThreadSchema,
  ThreadStepSchema,
  assertTransition,
  type DocumentStatus,
  type ExpertMemory,
  type ExpertNote,
  type GTCandidate,
  type GroundTruthDraft,
  type GroundTruthFieldItem,
  type SourceRef,
  type StructuredFieldKey,
  type TaskThread,
  type ThreadStepType,
} from "@ebs/ground-truth-schema";
import { structuredDiff, textDiff } from "@ebs/diff-engine";
import { processParseJobs } from "@ebs/job-runner";
import { loadKeyConfigMarkdown } from "./load-key-config.js";
import { draftForQaContext } from "./qa-helpers.js";
import { buildRetrievalIndex } from "./retrieval.js";
import { NotebookStore } from "./store.js";
import {
  buildFieldAssessments,
  buildFocusTasksFromAssessments,
  buildSourceViewModel,
} from "./workbench.js";
import { runNotebookExtractPipeline } from "./extract-pipeline.js";
import { buildContentListFromIr, buildEvidencePack } from "./evidence-pack.js";
import { resolveTaskThreadForFocus } from "./task-session.js";
import type {
  CachedDocArtifacts,
  NotebookDashboardResponse,
  NotebookDocumentMeta,
  NotebookTaskSession,
} from "./types.js";
import { SharedAgentCoreAdapter } from "./hermes/adapter.js";

const opennotebookRoot = process.cwd();
const repoRoot = join(opennotebookRoot, "..");
loadKeyConfigMarkdown(repoRoot);

const app = new Hono();
const store = new NotebookStore(join(opennotebookRoot, "data", "store"));
const orchestrator = new AgentOrchestrator();
const qaAgent = new SharedAgentCoreAdapter(orchestrator);
const artifactCache = new Map<string, CachedDocArtifacts>();

function isoNow() {
  return new Date().toISOString();
}

function cacheKey(docId: string, versionId: string) {
  return `${docId}:${versionId}`;
}

function bodyString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isStructuredFieldKey(value: string): value is StructuredFieldKey {
  return (STRUCTURED_FIELD_KEYS as readonly string[]).includes(value);
}

function sourceRefsFromBody(body: Record<string, unknown>): SourceRef[] {
  const refs = body.source_refs;
  if (Array.isArray(refs)) return refs as SourceRef[];
  if (typeof body.block_id === "string") return [{ block_id: body.block_id }];
  return [];
}

function safeDraft(docId: string, versionId: string): GroundTruthDraft | null {
  try {
    return store.readDraft(docId, versionId);
  } catch {
    return null;
  }
}

function safeIR(docId: string, versionId: string): DocumentIR | null {
  try {
    return store.readIR(docId, versionId);
  } catch {
    return null;
  }
}

function irNotReadyPayload(docId: string, versionId: string) {
  return {
    error: "ir_not_ready",
    message: "文档解析尚未完成，请等待解析完成后再执行结构化抽取。",
    doc_id: docId,
    version_id: versionId,
  };
}

function mimeForFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function createTaskThread(input: {
  docId: string;
  versionId: string;
  fieldKey?: string | null;
  sourceBlockIds?: string[];
  recommendedQuestion?: string | null;
  title?: string | null;
}): TaskThread {
  const now = isoNow();
  const threadId = randomUUID();
  return TaskThreadSchema.parse({
    thread_id: threadId,
    doc_id: input.docId,
    version_id: input.versionId,
    task_id: input.fieldKey ? `task-${input.fieldKey}` : `task-${threadId.slice(0, 8)}`,
    field_key: input.fieldKey ?? null,
    status: "active",
    title: input.title ?? (input.fieldKey ? `处理 ${input.fieldKey}` : "推进当前专家任务"),
    source_block_ids: input.sourceBlockIds ?? [],
    recommended_question: input.recommendedQuestion ?? undefined,
    created_at: now,
    latest_step_at: now,
    steps: [
      {
        step_id: randomUUID(),
        thread_id: threadId,
        type: "task_started",
        timestamp: now,
        payload: {
          field_key: input.fieldKey ?? null,
          source_block_ids: input.sourceBlockIds ?? [],
        },
      },
    ],
  });
}

function ensureThread(
  docId: string,
  versionId: string,
  body: Record<string, unknown>,
  options: {
    fieldKey?: string | null;
    sourceBlockIds?: string[];
    recommendedQuestion?: string | null;
    title?: string | null;
  },
) {
  const threadId = bodyString(body, "thread_id");
  const existing = threadId
    ? store.listTaskThreads(docId).find((item) => item.thread_id === threadId)
    : null;
  if (existing) return existing;
  const thread = createTaskThread({
    docId,
    versionId,
    fieldKey: options.fieldKey,
    sourceBlockIds: options.sourceBlockIds,
    recommendedQuestion: options.recommendedQuestion,
    title: options.title,
  });
  store.upsertTaskThread(docId, thread);
  return thread;
}

function appendThreadStep(
  docId: string,
  threadId: string | null | undefined,
  type: ThreadStepType,
  payload: Record<string, unknown>,
) {
  if (!threadId) return null;
  try {
    return store.appendThreadStep(
      docId,
      threadId,
      ThreadStepSchema.parse({
        step_id: randomUUID(),
        thread_id: threadId,
        type,
        timestamp: isoNow(),
        payload,
      }),
    );
  } catch {
    return null;
  }
}

function completeThread(docId: string, threadId: string | null | undefined, payload: Record<string, unknown>) {
  const thread = appendThreadStep(docId, threadId, "task_completed", payload);
  if (!thread) return null;
  const completed = TaskThreadSchema.parse({ ...thread, status: "completed" });
  store.upsertTaskThread(docId, completed);
  return completed;
}

function readCandidateText(content: unknown) {
  if (content && typeof content === "object" && "text" in content && typeof (content as { text?: unknown }).text === "string") {
    return (content as { text: string }).text;
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

function applyFieldItem(
  draft: GroundTruthDraft,
  fieldKey: StructuredFieldKey,
  item: GroundTruthFieldItem,
  mode: "append" | "replace",
) {
  const next = structuredClone(draft) as GroundTruthDraft;
  if (
    fieldKey === "business_scenario" ||
    fieldKey === "scenario_goal" ||
    fieldKey === "process_flow_or_business_model"
  ) {
    next[fieldKey] = item;
    return GroundTruthDraftSchema.parse(next);
  }
  const current = next[fieldKey];
  const list = Array.isArray(current) ? current : [];
  (next as Record<string, unknown>)[fieldKey] = mode === "replace" ? [item] : [...list, item];
  return GroundTruthDraftSchema.parse(next);
}

function readMeta(docId: string) {
  return store.readMeta(docId) as NotebookDocumentMeta;
}

function writeMeta(meta: NotebookDocumentMeta) {
  store.writeMeta(meta);
}

function summarizeThread(thread: TaskThread | null | undefined) {
  if (!thread) return "暂无线程历史。";
  const latest = thread.steps.slice(-4).map((step) => `${step.type}:${JSON.stringify(step.payload)}`);
  return latest.join("\n");
}

function evidencePackForRequest(input: {
  docId: string;
  versionId: string;
  ir: DocumentIR;
  draft: GroundTruthDraft | null;
  fieldKey?: StructuredFieldKey | null;
  evidenceBlockIds: string[];
}) {
  const artifacts = getArtifacts(input.docId, input.versionId);
  const cachedPack =
    input.fieldKey &&
    input.fieldKey in artifacts.evidence_pack_cache
      ? artifacts.evidence_pack_cache[input.fieldKey]
      : null;
  if (
    input.fieldKey &&
    cachedPack &&
    input.evidenceBlockIds.length === 0
  ) {
    return cachedPack;
  }
  return buildEvidencePack({
    docId: input.docId,
    versionId: input.versionId,
    ir: input.ir,
    draft: input.draft,
    fieldKey: input.fieldKey ?? null,
    manualBlockIds: input.evidenceBlockIds,
    retrievalHits: artifacts.retrieval_index
      .filter((entry) =>
        input.fieldKey ? (entry.keyword_scores[input.fieldKey] ?? 0) > 0 : true,
      )
      .sort((a, b) => {
        const aScore = input.fieldKey
          ? (a.keyword_scores[input.fieldKey] ?? 0)
          : Math.max(...Object.values(a.keyword_scores), 0);
        const bScore = input.fieldKey
          ? (b.keyword_scores[input.fieldKey] ?? 0)
          : Math.max(...Object.values(b.keyword_scores), 0);
        return bScore - aScore;
      })
      .slice(0, input.fieldKey ? 6 : 4),
    sourceView: artifacts.source_view ?? buildSourceViewModel(input.ir),
    documentUnderstanding:
      artifacts.document_understanding ?? {
        summary: "暂无全文理解摘要。",
        section_roles: [],
        process_spine: [],
        evidence_dense_block_ids: [],
        weak_signal_block_ids: [],
      },
    parseMode: artifacts.diagnostics?.parse_mode ?? "content_list_fallback",
    retrievalMode: artifacts.diagnostics?.retrieval_mode ?? "local_keyword",
    fallbackReason: artifacts.diagnostics?.fallback_reason ?? null,
  });
}

function buildTaskSessions(docId: string, versionId: string, artifacts: CachedDocArtifacts): NotebookTaskSession[] {
  const threads = store.listTaskThreads(docId);
  return threads
    .filter((thread) => thread.version_id === versionId)
    .map((thread) => ({
      thread_id: thread.thread_id,
      task_id: thread.task_id,
      field_key: thread.field_key ?? null,
      title: thread.title,
      status: thread.status,
      source_block_ids: thread.source_block_ids,
      recommended_question: thread.recommended_question,
      evidence_pack:
        thread.field_key && thread.field_key in artifacts.evidence_pack_cache
          ? artifacts.evidence_pack_cache[thread.field_key]
          : null,
      source_view: artifacts.source_view,
    }));
}

function refreshArtifacts(input: {
  docId: string;
  versionId: string;
  ir: DocumentIR;
  draft: GroundTruthDraft;
}) {
  const sourceView = buildSourceViewModel(input.ir);
  const retrievalIndex = buildRetrievalIndex(input.ir);
  store.writeRetrievalIndex(input.docId, input.versionId, retrievalIndex);
  const contentList = buildContentListFromIr(input.ir);
  store.writeContentList(input.docId, input.versionId, contentList);
  store.writeMultimodalSourceGraph(input.docId, input.versionId, sourceView);
  const fieldAssessments = buildFieldAssessments({
    draft: input.draft,
    retrievalIndex,
  });
  const scorecard = computeExtractionScorecard({ draft: input.draft, ir: input.ir });
  const improvementPlan = buildImprovementPlan(scorecard, input.draft, input.ir);
  const focusTasks = buildFocusTasksFromAssessments(fieldAssessments);
  const readiness = orchestrator.runA6Publish(input.draft);
  const documentUnderstanding =
    store.readDocumentUnderstanding(input.docId, input.versionId) ?? null;
  const evidencePackCache = store.readEvidencePackCache(input.docId, input.versionId);
  const diagnostics =
    (store.readRetrievalIndex(input.docId, input.versionId) && store.readDocumentUnderstanding(input.docId, input.versionId))
      ? {
          parse_mode: "content_list_fallback",
          retrieval_mode: "local_keyword",
          fallback_reason: null,
          full_document_blocks_sent: false,
          evidence_pack_stats: Object.values(evidencePackCache).map((pack) => ({
            field_key: pack.field_key ?? "exploratory",
            total_blocks: pack.stats.total_blocks,
            manual_blocks: pack.stats.manual_blocks,
            retrieval_blocks: pack.stats.retrieval_blocks,
          })),
          structuring_requests: [],
        }
      : null;
  store.writeRetrievalManifest(input.docId, input.versionId, {
    parse_mode: diagnostics?.parse_mode ?? "content_list_fallback",
    retrieval_mode: diagnostics?.retrieval_mode ?? "local_keyword",
    fallback_reason: diagnostics?.fallback_reason ?? null,
  });
  artifactCache.set(cacheKey(input.docId, input.versionId), {
    source_view: sourceView,
    document_understanding: documentUnderstanding,
    field_assessments: fieldAssessments,
    focus_tasks: focusTasks,
    improvement_plan: improvementPlan,
    scorecard,
    readiness,
    retrieval_index: retrievalIndex,
    evidence_pack_cache: evidencePackCache,
    diagnostics,
  });
  return artifactCache.get(cacheKey(input.docId, input.versionId))!;
}

function getArtifacts(docId: string, versionId: string) {
  const cached = artifactCache.get(cacheKey(docId, versionId));
  if (cached) return cached;
  const ir = safeIR(docId, versionId);
  const draft = safeDraft(docId, versionId);
  if (!ir || !draft) {
    return {
      source_view: ir ? buildSourceViewModel(ir) : null,
      document_understanding: null,
      field_assessments: [],
      focus_tasks: [],
      improvement_plan: null,
      scorecard: null,
      readiness: null,
      retrieval_index: [],
      evidence_pack_cache: {},
      diagnostics: null,
    } satisfies CachedDocArtifacts;
  }
  return refreshArtifacts({ docId, versionId, ir, draft });
}

function buildParseDiagnostics(ir: DocumentIR) {
  const blockCounts: Record<string, number> = {};
  let totalChars = 0;
  for (const block of ir.blocks) {
    blockCounts[block.block_type] = (blockCounts[block.block_type] ?? 0) + 1;
    totalChars += block.text_content.length;
  }
  return {
    block_count: ir.blocks.length,
    block_counts: blockCounts,
    avg_block_chars: ir.blocks.length ? Math.round(totalChars / ir.blocks.length) : 0,
    source_files: [...new Set(ir.blocks.map((block) => block.source_file))],
  };
}

function buildDashboard(docId: string): NotebookDashboardResponse {
  const meta = readMeta(docId);
  const versionId = meta.current_version_id;
  const ir = safeIR(docId, versionId);
  const draft = safeDraft(docId, versionId);
  const artifacts = getArtifacts(docId, versionId);
  return {
    meta,
    ir,
    draft,
    source_view: artifacts.source_view,
    document_understanding: artifacts.document_understanding,
    field_assessments: artifacts.field_assessments,
    focus_tasks: artifacts.focus_tasks,
    improvement_plan: artifacts.improvement_plan,
    threads: store.listTaskThreads(docId),
    task_sessions: buildTaskSessions(docId, versionId, artifacts),
    notes: store.listExpertNotes(docId),
    candidates: store.listGTCandidates(docId),
    versions: store.listVersionRecords(docId),
    readiness: artifacts.readiness,
    expert_memory: store.readExpertMemory(docId),
  };
}

app.use(
  "*",
  async (c, next) => {
    c.header("Access-Control-Allow-Origin", c.req.header("origin") ?? "http://127.0.0.1:5181");
    c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  },
);

app.get("/health", (c) => c.json({ ok: true }));

app.post("/documents", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title : "OpenNotebook 文档";
  const docId = randomUUID();
  const versionId = "v1";
  const meta: NotebookDocumentMeta = {
    doc_id: docId,
    title,
    document_status: "Draft",
    current_version_id: versionId,
    sources: [],
    suggestion_ids: [],
    audit: [{ at: isoNow(), action: "document_created" }],
  };
  writeMeta(meta);
  store.writeExpertMemory(docId, ExpertMemorySchema.parse({}));
  return c.json(meta);
});

app.get("/documents/:docId", (c) => c.json(readMeta(c.req.param("docId"))));

app.post("/documents/:docId/sources", async (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const body = await c.req.parseBody({ all: true });
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "expected file field" }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  const fileId = randomUUID();
  const path = store.saveImmutableUpload(docId, fileId, file.name, buf);
  meta.sources.push({ file_id: fileId, filename: file.name, stored_path: path });
  meta.audit.push({ at: isoNow(), action: "source_uploaded", detail: file.name });
  writeMeta(meta);
  const jobId = randomUUID();
  store.enqueueJob({
    job_id: jobId,
    type: "parse",
    payload: {
      doc_id: docId,
      version_id: meta.current_version_id,
      path,
      filename: file.name,
    },
  });
  return c.json({ ...meta, job_id: jobId });
});

app.post("/documents/:docId/jobs/process-next", async (c) => {
  await processParseJobs(store);
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const ir = safeIR(docId, meta.current_version_id);
  if (ir) {
    const index = buildRetrievalIndex(ir);
    store.writeRetrievalIndex(docId, meta.current_version_id, index);
  }
  return c.json({ ok: true });
});

app.post("/documents/:docId/extract", async (c) => {
  const docId = c.req.param("docId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const meta = readMeta(docId);
  const versionId = meta.current_version_id;
  const ir = safeIR(docId, versionId);
  if (!ir) return c.json(irNotReadyPayload(docId, versionId), 409);

  const requestedMode =
    c.req.query("mode") ??
    bodyString(body, "mode") ??
    bodyString(body, "structuring_mode") ??
    "deep";
  const extractResult = await runNotebookExtractPipeline({
    docId,
    versionId,
    ir,
    existingDraft: safeDraft(docId, versionId),
    requestedMode,
    orchestrator,
  });

  store.writeDraft(docId, versionId, extractResult.draft);
  store.writeDocumentUnderstanding(docId, versionId, extractResult.document_understanding);
  store.writeEvidencePackCache(docId, versionId, extractResult.evidence_packs);
  store.writeContentList(docId, versionId, buildContentListFromIr(ir));
  store.writeMultimodalSourceGraph(docId, versionId, extractResult.source_view);
  store.writeRetrievalManifest(docId, versionId, extractResult.diagnostics);
  meta.document_status = "Extracted";
  meta.audit.push({
    at: isoNow(),
    action: "structuring_run",
    detail: JSON.stringify({
      requested_mode: requestedMode,
      parse_mode: extractResult.diagnostics.parse_mode,
      retrieval_mode: extractResult.diagnostics.retrieval_mode,
      fallback_reason: extractResult.diagnostics.fallback_reason,
    }),
  });
  writeMeta(meta);
  const artifacts = refreshArtifacts({ docId, versionId, ir, draft: extractResult.draft });

  return c.json({
    draft: extractResult.draft,
    scorecard: artifacts.scorecard,
    improvement_plan: artifacts.improvement_plan,
    document_understanding: extractResult.document_understanding,
    field_assessments: extractResult.field_assessments,
    focus_tasks: artifacts.focus_tasks,
    structuring_mode: requestedMode,
    parse_diagnostics: buildParseDiagnostics(ir),
    structuring_diagnostics: extractResult.diagnostics,
  });
});

app.get("/documents/:docId/ir", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const ir = safeIR(docId, meta.current_version_id);
  if (!ir) return c.json(irNotReadyPayload(docId, meta.current_version_id), 404);
  return c.json(ir);
});

app.get("/documents/:docId/draft", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  return c.json(safeDraft(docId, meta.current_version_id));
});

app.get("/documents/:docId/dashboard", (c) => c.json(buildDashboard(c.req.param("docId"))));

app.get("/documents/:docId/focus-tasks", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const artifacts = getArtifacts(docId, meta.current_version_id);
  return c.json({ focus_tasks: artifacts.focus_tasks });
});

app.get("/documents/:docId/field-assessments", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const artifacts = getArtifacts(docId, meta.current_version_id);
  return c.json({
    field_assessments: artifacts.field_assessments,
    document_understanding: artifacts.document_understanding,
  });
});

app.get("/documents/:docId/improvement-plan", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const artifacts = getArtifacts(docId, meta.current_version_id);
  return c.json(artifacts.improvement_plan);
});

app.get("/documents/:docId/threads", (c) => c.json({ threads: store.listTaskThreads(c.req.param("docId")) }));

app.post("/documents/:docId/threads", async (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const thread = createTaskThread({
    docId,
    versionId: meta.current_version_id,
    fieldKey: bodyString(body, "field_key"),
    sourceBlockIds: Array.isArray(body.source_block_ids)
      ? body.source_block_ids.filter((id): id is string => typeof id === "string")
      : [],
    recommendedQuestion: bodyString(body, "recommended_question"),
    title: bodyString(body, "title"),
  });
  store.upsertTaskThread(docId, thread);
  return c.json(thread);
});

app.post("/documents/:docId/tasks/:taskId/focus", async (c) => {
  const docId = c.req.param("docId");
  const taskId = c.req.param("taskId");
  const meta = readMeta(docId);
  const versionId = meta.current_version_id;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const artifacts = getArtifacts(docId, versionId);
  const fieldKey = bodyString(body, "field_key");
  const title = bodyString(body, "title") ?? "推进当前专家任务";
  const sourceBlockIds = Array.isArray(body.source_block_ids)
    ? body.source_block_ids.filter((id): id is string => typeof id === "string")
    : [];
  const result = resolveTaskThreadForFocus({
    docId,
    versionId,
    taskId,
    fieldKey: fieldKey && isStructuredFieldKey(fieldKey) ? fieldKey : null,
    title,
    sourceBlockIds,
    recommendedQuestion: bodyString(body, "recommended_question") ?? undefined,
    threads: store.listTaskThreads(docId),
    nowIso: isoNow(),
  });
  store.upsertTaskThread(docId, result.thread);
  return c.json({
    thread: result.thread,
    reused: result.reused,
    task_session: {
      thread_id: result.thread.thread_id,
      task_id: result.thread.task_id,
      field_key: result.thread.field_key ?? null,
      title: result.thread.title,
      status: result.thread.status,
      source_block_ids: result.thread.source_block_ids,
      recommended_question: result.thread.recommended_question,
      evidence_pack:
        result.thread.field_key && result.thread.field_key in artifacts.evidence_pack_cache
          ? artifacts.evidence_pack_cache[result.thread.field_key]
          : null,
      source_view: artifacts.source_view,
    },
  });
});

app.post("/documents/:docId/threads/:threadId/steps", async (c) => {
  const docId = c.req.param("docId");
  const threadId = c.req.param("threadId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = bodyString(body, "type");
  if (!type) return c.json({ error: "missing step type" }, 400);
  const step = ThreadStepSchema.safeParse({
    step_id: randomUUID(),
    thread_id: threadId,
    type,
    timestamp: isoNow(),
    payload:
      typeof body.payload === "object" && body.payload
        ? (body.payload as Record<string, unknown>)
        : {},
  });
  if (!step.success) return c.json({ error: "invalid step" }, 400);
  const thread = store.appendThreadStep(docId, threadId, step.data);
  return c.json(thread);
});

app.get("/documents/:docId/expert-memory", (c) => c.json(store.readExpertMemory(c.req.param("docId"))));

app.patch("/documents/:docId/expert-memory", async (c) => {
  const docId = c.req.param("docId");
  const current = store.readExpertMemory(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const next = ExpertMemorySchema.parse({
    ...current,
    ...body,
    profile:
      typeof body.profile === "object" && body.profile
        ? { ...current.profile, ...(body.profile as Record<string, unknown>) }
        : current.profile,
    updated_at: isoNow(),
  });
  store.writeExpertMemory(docId, next);
  return c.json(next);
});

app.get("/documents/:docId/notes", (c) => c.json({ notes: store.listExpertNotes(c.req.param("docId")) }));

app.post("/documents/:docId/notes", async (c) => {
  const docId = c.req.param("docId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const content = bodyString(body, "content");
  if (!content) return c.json({ error: "empty note" }, 400);
  const note = ExpertNoteSchema.parse({
    note_id: randomUUID(),
    doc_id: docId,
    thread_id: bodyString(body, "thread_id"),
    content,
    source_block_ids: Array.isArray(body.source_block_ids)
      ? body.source_block_ids.filter((id): id is string => typeof id === "string")
      : [],
    created_at: isoNow(),
    updated_at: isoNow(),
  });
  store.upsertExpertNote(docId, note);
  appendThreadStep(docId, note.thread_id, "note_saved", {
    note_id: note.note_id,
    content: note.content,
    source_block_ids: note.source_block_ids,
  });
  return c.json(note);
});

app.get("/documents/:docId/gt-candidates", (c) => c.json({ candidates: store.listGTCandidates(c.req.param("docId")) }));

app.post("/documents/:docId/qa/refine-question", async (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ir = safeIR(docId, meta.current_version_id);
  if (!ir) return c.json(irNotReadyPayload(docId, meta.current_version_id), 409);
  const draft = await draftForQaContext({
    docId,
    versionId: meta.current_version_id,
    readDraft: () => safeDraft(docId, meta.current_version_id),
  });
  const targetField = typeof body.target_field === "string" ? body.target_field : null;
  const evidenceBlockIds = Array.isArray(body.source_block_ids)
    ? body.source_block_ids.filter((id): id is string => typeof id === "string")
    : [];
  const thread = ensureThread(docId, meta.current_version_id, body, {
    fieldKey: targetField,
    sourceBlockIds: evidenceBlockIds,
    recommendedQuestion: bodyString(body, "question_seed"),
    title: targetField ? `处理 ${targetField}` : "生成专家问题",
  });
  const pack = evidencePackForRequest({
    docId,
    versionId: meta.current_version_id,
    ir,
    draft,
    fieldKey: targetField && isStructuredFieldKey(targetField) ? targetField : null,
    evidenceBlockIds,
  });
  const refined = await qaAgent.refineQuestion({
    ir,
    draft,
    targetField,
    evidenceBlockIds,
    blockId: evidenceBlockIds[0] ?? null,
    questionSeed: bodyString(body, "question_seed"),
    gapReason: bodyString(body, "gap_reason"),
    metric: bodyString(body, "metric"),
    expertMemory: store.readExpertMemory(docId),
    threadHistorySummary: summarizeThread(thread),
    evidencePackSummary: `${pack.summary}\n${pack.completion_criteria}`,
  });
  appendThreadStep(docId, thread.thread_id, "question_suggested", {
    refined_question: refined.refined_question,
    context_summary: refined.context_summary,
    source_block_refs: refined.source_block_refs,
  });
  return c.json({ ...refined, thread_id: thread.thread_id });
});

app.post("/documents/:docId/qa", async (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ir = safeIR(docId, meta.current_version_id);
  if (!ir) return c.json(irNotReadyPayload(docId, meta.current_version_id), 409);
  const draft = await draftForQaContext({
    docId,
    versionId: meta.current_version_id,
    readDraft: () => safeDraft(docId, meta.current_version_id),
  });
  const targetField = typeof body.target_field === "string" ? body.target_field : null;
  const evidenceBlockIds = Array.isArray(body.source_block_ids)
    ? body.source_block_ids.filter((id): id is string => typeof id === "string")
    : [];
  const thread = ensureThread(docId, meta.current_version_id, body, {
    fieldKey: targetField,
    sourceBlockIds: evidenceBlockIds,
    recommendedQuestion: bodyString(body, "question_seed"),
    title: targetField ? `处理 ${targetField}` : "专家问答线程",
  });
  const pack = evidencePackForRequest({
    docId,
    versionId: meta.current_version_id,
    ir,
    draft,
    fieldKey: targetField && isStructuredFieldKey(targetField) ? targetField : null,
    evidenceBlockIds,
  });

  const questionSeed = bodyString(body, "question_seed");
  const question = bodyString(body, "question") ?? "";
  if (questionSeed && questionSeed.trim() && questionSeed.trim() !== question.trim()) {
    appendThreadStep(docId, thread.thread_id, "question_edited", {
      question_seed: questionSeed,
      question,
    });
  }
  appendThreadStep(docId, thread.thread_id, "question_sent", {
    question,
    question_seed: questionSeed,
    source_block_ids: evidenceBlockIds,
  });

  const qa = await qaAgent.answerQuestion({
    ir,
    draft,
    targetField,
    evidenceBlockIds,
    blockId: evidenceBlockIds[0] ?? null,
    question,
    questionSeed,
    gapReason: bodyString(body, "gap_reason"),
    metric: bodyString(body, "metric"),
    expertMemory: store.readExpertMemory(docId),
    threadHistorySummary: summarizeThread(thread),
    evidencePackSummary: `${pack.summary}\n${pack.completion_criteria}`,
  });
  appendThreadStep(docId, thread.thread_id, "agent_answered", {
    answer: qa.direct_answer,
    rationale: qa.rationale,
    source_block_refs: qa.source_block_refs,
    target_field: qa.target_field,
  });

  const proposed = qaAgent.proposeWriteback({
    qa,
    requestedTargetField: targetField,
    evidenceBlockIds,
    question,
  });
  let gtCandidate: GTCandidate | null = null;
  if (isStructuredFieldKey(proposed.fieldKey)) {
    gtCandidate = GTCandidateSchema.parse({
      candidate_id: randomUUID(),
      thread_id: thread.thread_id,
      doc_id: docId,
      version_id: meta.current_version_id,
      field_key: proposed.fieldKey,
      content: proposed.content,
      source_refs: proposed.sourceBlockIds.map((blockId) => ({ block_id: blockId })),
      status: "draft",
      recommended_mode: "append",
      created_from_step_id: null,
      rationale: qa.rationale,
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    store.upsertGTCandidate(docId, gtCandidate);
    appendThreadStep(docId, thread.thread_id, "gt_candidate_created", {
      candidate_id: gtCandidate.candidate_id,
      field_key: gtCandidate.field_key,
    });
  }

  const memory = store.readExpertMemory(docId);
  store.writeExpertMemory(docId, {
    ...memory,
    recent_questions: [question, ...memory.recent_questions].filter(Boolean).slice(0, 20),
    updated_at: isoNow(),
  });

  return c.json({
    ...qa,
    thread_id: thread.thread_id,
    gt_candidate: gtCandidate,
  });
});

app.post("/documents/:docId/gt-candidates/:candidateId/confirm", async (c) => {
  const docId = c.req.param("docId");
  const candidateId = c.req.param("candidateId");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const meta = readMeta(docId);
  const candidate = store.listGTCandidates(docId).find((item) => item.candidate_id === candidateId);
  if (!candidate) return c.json({ error: "not found" }, 404);
  if (!isStructuredFieldKey(candidate.field_key)) return c.json({ error: "invalid field_key" }, 400);
  const answerText =
    bodyString(body, "edited_text") ??
    bodyString(body, "answer_text") ??
    readCandidateText(candidate.content);
  const draft = safeDraft(docId, meta.current_version_id);
  if (!draft) return c.json({ error: "no draft" }, 400);
  const item: GroundTruthFieldItem = {
    content: { text: answerText, from_gt_candidate: candidateId },
    status: "Drafted",
    confidence: 0.78,
    source_refs: candidate.source_refs,
    notes: `GT 候选确认：${candidate.rationale ?? candidateId}`,
  };
  const nextDraft = applyFieldItem(
    draft,
    candidate.field_key,
    item,
    body.mode === "replace" || candidate.recommended_mode === "replace" ? "replace" : "append",
  );
  store.writeDraft(docId, meta.current_version_id, nextDraft);
  const nextCandidate = GTCandidateSchema.parse({
    ...candidate,
    content: item.content,
    status: bodyString(body, "edited_text") ? "edited" : "confirmed",
    updated_at: isoNow(),
  });
  store.upsertGTCandidate(docId, nextCandidate);
  meta.document_status = "Revised";
  meta.audit.push({
    at: isoNow(),
    action: "gt_candidate_confirmed",
    detail: candidateId,
  });
  writeMeta(meta);
  appendThreadStep(docId, candidate.thread_id, "writeback_confirmed", {
    candidate_id: candidateId,
    field_key: candidate.field_key,
  });
  completeThread(docId, candidate.thread_id, {
    candidate_id: candidateId,
    field_key: candidate.field_key,
  });
  const ir = safeIR(docId, meta.current_version_id);
  const artifacts = ir ? refreshArtifacts({ docId, versionId: meta.current_version_id, ir, draft: nextDraft }) : null;
  return c.json({
    candidate: nextCandidate,
    draft: nextDraft,
    scorecard: artifacts?.scorecard ?? null,
    improvement_plan: artifacts?.improvement_plan ?? null,
    focus_tasks: artifacts?.focus_tasks ?? [],
    readiness: artifacts?.readiness ?? null,
  });
});

app.post("/documents/:docId/versions", async (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const prevVersionId = meta.current_version_id;
  const ir = safeIR(docId, prevVersionId);
  if (!ir) return c.json(irNotReadyPayload(docId, prevVersionId), 409);
  let draft = safeDraft(docId, prevVersionId);
  if (!draft) {
    const result = await orchestrator.runA1StructuringAsync(ir);
    draft = result.draft;
  }
  const newVersionId = `v-${randomUUID().slice(0, 8)}`;
  store.writeIR(docId, newVersionId, ir);
  store.writeDraft(docId, newVersionId, draft);
  const previousText = JSON.stringify(safeDraft(docId, prevVersionId) ?? {});
  const nextText = JSON.stringify(draft);
  const summary = orchestrator.summarizeVersionDiff(previousText, nextText);
  store.writeVersionRecord(docId, {
    version_id: newVersionId,
    parent_version_id: prevVersionId,
    doc_snapshot_path: join(store.versionDir(docId, newVersionId), "ir.json"),
    ground_truth_snapshot_path: join(store.versionDir(docId, newVersionId), "draft.json"),
    change_summary: summary.slice(0, 2000),
    created_by: "local-user",
    created_at: isoNow(),
  });
  try {
    const retrievalIndex = store.readRetrievalIndex(docId, prevVersionId);
    store.writeRetrievalIndex(docId, newVersionId, retrievalIndex);
  } catch {
    store.writeRetrievalIndex(docId, newVersionId, buildRetrievalIndex(ir));
  }
  meta.current_version_id = newVersionId;
  meta.audit.push({ at: isoNow(), action: "version_created", detail: newVersionId });
  writeMeta(meta);
  refreshArtifacts({ docId, versionId: newVersionId, ir, draft });
  return c.json(orchestrator.versionActionStub(newVersionId));
});

app.get("/documents/:docId/versions", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  return c.json({
    current_version_id: meta.current_version_id,
    versions: store.listVersionRecords(docId),
  });
});

app.get("/documents/:docId/versions/:v1/diff/:v2", (c) => {
  const docId = c.req.param("docId");
  const v1 = c.req.param("v1");
  const v2 = c.req.param("v2");
  const d1 = store.readDraft(docId, v1);
  const d2 = store.readDraft(docId, v2);
  const flat = (draft: GroundTruthDraft) =>
    Object.fromEntries(Object.entries(draft).filter(([key]) => key !== "gaps" && key !== "confidence_by_field"));
  return c.json({
    structured: structuredDiff(flat(d1) as Record<string, unknown>, flat(d2) as Record<string, unknown>),
    text_summary: textDiff(JSON.stringify(d1, null, 2), JSON.stringify(d2, null, 2)).slice(0, 8000),
  });
});

app.get("/documents/:docId/publish-readiness", (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const artifacts = getArtifacts(docId, meta.current_version_id);
  if (!artifacts.readiness) return c.json({ error: "no draft" }, 400);
  return c.json(artifacts.readiness);
});

app.get("/documents/:docId/versions/:versionId/assets/:assetKey", (c) => {
  const docId = c.req.param("docId");
  const versionId = c.req.param("versionId");
  const assetKey = decodeURIComponent(c.req.param("assetKey"));
  if (!assetKey || assetKey.includes("..") || assetKey.includes("/")) {
    return c.json({ error: "bad asset path" }, 400);
  }
  const fullPath = join(store.derivedAssetsDir(docId, versionId), assetKey);
  if (!existsSync(fullPath)) return c.notFound();
  const buf = readFileSync(fullPath);
  return c.body(buf, 200, { "Content-Type": mimeForFilename(assetKey) });
});

app.patch("/documents/:docId/status", async (c) => {
  const docId = c.req.param("docId");
  const meta = readMeta(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const next = body.document_status as DocumentStatus;
  assertTransition(meta.document_status as DocumentStatus, next);
  meta.document_status = next;
  meta.audit.push({ at: isoNow(), action: "status_changed", detail: next });
  writeMeta(meta);
  return c.json(meta);
});

setInterval(() => {
  void processParseJobs(store);
}, 1500);

const port = Number(process.env.OPENNOTEBOOK_PORT ?? 8788);
serve({ fetch: app.fetch, port });
console.log(`OpenNotebook API listening on http://127.0.0.1:${port}`);
