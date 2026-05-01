import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AgentOrchestrator } from "@ebs/agent-core";
import type { DocumentIR } from "@ebs/document-ir";
import {
  buildCandidateQuestionsFromScorecard,
  buildImprovementPlan,
  computeExtractionScorecard,
} from "@ebs/extraction-scorecard";
import {
  GroundTruthDraftSchema,
  STRUCTURED_FIELD_KEYS,
  assertTransition,
} from "@ebs/ground-truth-schema";
import type {
  DocumentStatus,
  GroundTruthDraft,
  GroundTruthFieldItem,
  SourceRef,
  StructuredFieldKey,
} from "@ebs/ground-truth-schema";
import { structuredDiff, textDiff } from "@ebs/diff-engine";
import { processParseJobs } from "@ebs/job-runner";
import { FileStore } from "@ebs/storage";

import { loadKeyConfigMarkdown } from "./load-key-config.js";

const repoRoot = join(process.cwd(), "../..");
loadKeyConfigMarkdown(repoRoot);
const store = new FileStore(join(repoRoot, "data/store"));
const orchestrator = new AgentOrchestrator();

const app = new Hono();

function buildParseDiagnostics(ir: DocumentIR) {
  const block_counts: Record<string, number> = {};
  let totalChars = 0;
  for (const block of ir.blocks) {
    block_counts[block.block_type] = (block_counts[block.block_type] ?? 0) + 1;
    totalChars += block.text_content.length;
  }
  const likely_issues: string[] = [];
  const headingCount = block_counts.heading ?? 0;
  const tableBlocks = ir.blocks.filter((b) => b.block_type === "table");
  const tableLineCounts = tableBlocks.map((b) => b.text_content.split("\n").length);
  const hasSectionHierarchy = ir.blocks.some((b) => b.parent_block_id != null);
  if (headingCount === 0) {
    likely_issues.push("no heading blocks detected");
  }
  if (
    tableBlocks.length > 5 &&
    tableLineCounts.every((n) => n <= 1)
  ) {
    likely_issues.push("tables appear split into one-row blocks");
  }
  if (!hasSectionHierarchy) {
    likely_issues.push("no section hierarchy detected");
  }
  return {
    block_count: ir.blocks.length,
    block_counts,
    avg_block_chars:
      ir.blocks.length === 0 ? 0 : Math.round(totalChars / ir.blocks.length),
    has_section_hierarchy: hasSectionHierarchy,
    table_line_counts: tableLineCounts,
    source_files: [...new Set(ir.blocks.map((b) => b.source_file))],
    likely_issues,
  };
}

function tryReadIR(docId: string, versionId: string): DocumentIR | null {
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

function isStructuredFieldKey(value: string): value is StructuredFieldKey {
  return (STRUCTURED_FIELD_KEYS as readonly string[]).includes(value);
}

function sourceRefsFromBody(body: Record<string, unknown>): SourceRef[] {
  const refs = body.source_refs;
  if (Array.isArray(refs)) return refs as SourceRef[];
  if (typeof body.block_id === "string") {
    return [{ block_id: body.block_id }];
  }
  return [];
}

function applyFieldItem(
  draft: GroundTruthDraft,
  fieldKey: StructuredFieldKey,
  item: GroundTruthFieldItem,
  mode: "append" | "replace",
): GroundTruthDraft {
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
  (next as Record<string, unknown>)[fieldKey] =
    mode === "replace" ? [item] : [...list, item];
  return GroundTruthDraftSchema.parse(next);
}

function compareScorecards(
  a: ReturnType<typeof computeExtractionScorecard>,
  b: ReturnType<typeof computeExtractionScorecard>,
) {
  const delta_scores: Record<string, number | null> = {};
  for (const key of Object.keys(b.scores)) {
    const before = a.scores[key as keyof typeof a.scores];
    const after = b.scores[key as keyof typeof b.scores];
    delta_scores[key] =
      typeof before === "number" && typeof after === "number"
        ? Number((after - before).toFixed(4))
        : null;
  }
  const improved = Object.entries(delta_scores)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k]) => a.metric_definitions[k]?.label ?? k);
  return {
    before: a,
    after: b,
    delta_scores,
    summary_zh:
      improved.length > 0
        ? `质量提升项：${improved.join("、")}。`
        : "暂未看到明确提升项，请继续补充字段、出处或专家确认。",
  };
}

function mimeForFilename(filename: string): string {
  const e = extname(filename).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".gif") return "image/gif";
  if (e === ".webp") return "image/webp";
  if (e === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.post("/documents", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "Untitled";
  const docId = randomUUID();
  const versionId = "v1";
  const meta = {
    doc_id: docId,
    title,
    document_status: "Draft" as DocumentStatus,
    current_version_id: versionId,
    sources: [] as { file_id: string; filename: string; stored_path: string }[],
    suggestion_ids: [] as string[],
    audit: [{ at: new Date().toISOString(), action: "document_created" }],
  };
  store.writeMeta(meta);
  return c.json(meta);
});

app.post("/documents/:docId/sources", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const body = await c.req.parseBody({ all: true });
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: "expected file field" }, 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const fileId = randomUUID();
  const path = store.saveImmutableUpload(docId, fileId, file.name, buf);
  meta.sources.push({ file_id: fileId, filename: file.name, stored_path: path });
  meta.audit.push({
    at: new Date().toISOString(),
    action: "source_uploaded",
    detail: file.name,
  });
  store.writeMeta(meta);

  const jobId = randomUUID();
  store.enqueueJob({
    job_id: jobId,
    type: "parse",
    payload: { doc_id: docId, version_id: meta.current_version_id, path, filename: file.name },
  });
  return c.json({ ...meta, job_id: jobId });
});

app.post("/documents/:docId/jobs/process-next", async (c) => {
  await processParseJobs(store);
  return c.json({ ok: true });
});

app.post("/documents/:docId/extract", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const versionId = meta.current_version_id;
  const ir = tryReadIR(docId, versionId);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, versionId), 409);
  }
  const { draft, structuring_mode, diagnostics } =
    await orchestrator.runA1StructuringAsync(ir);
  store.writeDraft(docId, versionId, draft);
  meta.document_status = "Extracted";
  meta.audit.push({
    at: new Date().toISOString(),
    action: "structuring_run",
    detail: JSON.stringify({
      structuring_mode,
      llm_failure_reason: diagnostics.llm_failure_reason,
      quality_issues: diagnostics.quality_issues,
    }),
  });
  store.writeMeta(meta);
  const scorecard = computeExtractionScorecard({ draft, ir });
  const improvement_plan = buildImprovementPlan(scorecard, draft, ir);
  return c.json({
    draft,
    scorecard,
    improvement_plan,
    structuring_mode,
    parse_diagnostics: buildParseDiagnostics(ir),
    structuring_diagnostics: diagnostics,
  });
});

app.get("/documents/:docId/diagnostics", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const ir = tryReadIR(docId, meta.current_version_id);
  return c.json({
    parse_diagnostics: ir
      ? buildParseDiagnostics(ir)
      : {
          ready: false,
          ...irNotReadyPayload(docId, meta.current_version_id),
        },
    latest_structuring_audit: [...meta.audit]
      .reverse()
      .find((a) => a.action === "structuring_run"),
  });
});

app.get("/documents/:docId", async (c) => {
  const meta = store.readMeta(c.req.param("docId"));
  return c.json(meta);
});

app.get("/documents/:docId/ir", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const ir = tryReadIR(docId, meta.current_version_id);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, meta.current_version_id), 404);
  }
  return c.json(ir);
});

app.get("/documents/:docId/draft", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  try {
    const draft = store.readDraft(docId, meta.current_version_id);
    return c.json(draft);
  } catch {
    return c.json(null);
  }
});

app.get("/documents/:docId/versions/:versionId/assets/:assetKey", async (c) => {
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

app.get("/documents/:docId/scorecard", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const versionId = meta.current_version_id;
  const ir = tryReadIR(docId, versionId);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, versionId), 409);
  }
  const draft = await safeDraft(docId, versionId);
  if (!draft) return c.json({ error: "no draft" }, 400);
  return c.json(computeExtractionScorecard({ draft, ir }));
});

app.get("/documents/:docId/scorecard/compare/:v1/:v2", async (c) => {
  const docId = c.req.param("docId");
  const v1 = c.req.param("v1");
  const v2 = c.req.param("v2");
  const ir1 = tryReadIR(docId, v1);
  const ir2 = tryReadIR(docId, v2);
  if (!ir1) return c.json(irNotReadyPayload(docId, v1), 409);
  if (!ir2) return c.json(irNotReadyPayload(docId, v2), 409);
  const d1 = store.readDraft(docId, v1);
  const d2 = store.readDraft(docId, v2);
  return c.json(
    compareScorecards(
      computeExtractionScorecard({ draft: d1, ir: ir1 }),
      computeExtractionScorecard({ draft: d2, ir: ir2 }),
    ),
  );
});

app.get("/documents/:docId/improvement-plan", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const versionId = meta.current_version_id;
  const ir = tryReadIR(docId, versionId);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, versionId), 409);
  }
  const draft = await safeDraft(docId, versionId);
  if (!draft) return c.json({ error: "no draft" }, 400);
  const scorecard = computeExtractionScorecard({ draft, ir });
  return c.json(buildImprovementPlan(scorecard, draft, ir));
});

app.get("/documents/:docId/expert-memory", async (c) => {
  return c.json(store.readExpertMemory(c.req.param("docId")));
});

app.patch("/documents/:docId/expert-memory", async (c) => {
  const docId = c.req.param("docId");
  const current = store.readExpertMemory(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const next = {
    ...current,
    ...body,
    profile:
      typeof body.profile === "object" && body.profile
        ? { ...current.profile, ...(body.profile as Record<string, unknown>) }
        : current.profile,
    updated_at: new Date().toISOString(),
  };
  store.writeExpertMemory(docId, next);
  return c.json(store.readExpertMemory(docId));
});

app.post("/documents/:docId/qa", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const body = await c.req.json();
  const ir = tryReadIR(docId, meta.current_version_id);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, meta.current_version_id), 409);
  }
  let draft = await safeDraft(docId, meta.current_version_id);
  if (!draft) {
    const r = await orchestrator.runA1StructuringAsync(ir);
    draft = r.draft;
    store.writeDraft(docId, meta.current_version_id, draft);
  }
  const targetField =
    typeof body.target_field === "string" ? body.target_field : null;
  const qa = await orchestrator.runA2QAAsync({
    ir,
    draft,
    blockId: typeof body.block_id === "string" ? body.block_id : null,
    question: typeof body.question === "string" ? body.question : "",
    targetField,
    metric: typeof body.metric === "string" ? body.metric : null,
    expertMemory: store.readExpertMemory(docId),
  });
  const memory = store.readExpertMemory(docId);
  store.writeExpertMemory(docId, {
    ...memory,
    recent_questions: [
      typeof body.question === "string" ? body.question : "",
      ...memory.recent_questions,
    ].filter(Boolean).slice(0, 20),
  });
  return c.json(qa);
});

app.post("/documents/:docId/qa/apply", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const fieldKey = String(body.field_key ?? body.target_field ?? "");
  if (!isStructuredFieldKey(fieldKey)) {
    return c.json({ error: "invalid field_key" }, 400);
  }
  const answerText =
    typeof body.edited_text === "string"
      ? body.edited_text
      : typeof body.answer_text === "string"
        ? body.answer_text
        : "";
  if (!answerText.trim()) return c.json({ error: "empty answer" }, 400);
  const draft = store.readDraft(docId, meta.current_version_id);
  const item: GroundTruthFieldItem = {
    content: { text: answerText.trim(), from_qa: true },
    status: "Drafted",
    confidence: 0.75,
    source_refs: sourceRefsFromBody(body),
    notes:
      typeof body.question === "string"
        ? `专家问答回写：${body.question}`
        : "专家问答回写",
  };
  const next = applyFieldItem(
    draft,
    fieldKey,
    item,
    body.mode === "replace" ? "replace" : "append",
  );
  store.writeDraft(docId, meta.current_version_id, next);
  meta.document_status = "Revised";
  meta.audit.push({
    at: new Date().toISOString(),
    action: "qa_answer_applied",
    detail: JSON.stringify({
      field_key: fieldKey,
      question: body.question,
      edited: typeof body.edited_text === "string",
    }),
  });
  store.writeMeta(meta);
  const memory = store.readExpertMemory(docId);
  store.writeExpertMemory(docId, {
    ...memory,
    correction_summaries: [
      `将 QA 回答回写到 ${fieldKey}: ${answerText.slice(0, 120)}`,
      ...memory.correction_summaries,
    ].slice(0, 20),
  });
  return c.json({ draft: next, field_key: fieldKey });
});

app.patch("/documents/:docId/draft", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const fieldKey = String(body.field_key ?? "");
  if (!isStructuredFieldKey(fieldKey)) {
    return c.json({ error: "invalid field_key" }, 400);
  }
  const draft = store.readDraft(docId, meta.current_version_id);
  const item: GroundTruthFieldItem = {
    content: body.content ?? { text: String(body.text ?? "") },
    status: "Drafted",
    confidence:
      typeof body.confidence === "number" ? body.confidence : 0.75,
    source_refs: sourceRefsFromBody(body),
    notes: typeof body.notes === "string" ? body.notes : undefined,
  };
  const next = applyFieldItem(
    draft,
    fieldKey,
    item,
    body.mode === "replace" ? "replace" : "append",
  );
  store.writeDraft(docId, meta.current_version_id, next);
  meta.document_status = "Revised";
  meta.audit.push({
    at: new Date().toISOString(),
    action: "draft_patched",
    detail: fieldKey,
  });
  store.writeMeta(meta);
  return c.json(next);
});

app.post("/documents/:docId/suggestions", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const body = await c.req.json();
  const blockId = body.block_id as string;
  const ir = tryReadIR(docId, meta.current_version_id);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, meta.current_version_id), 409);
  }
  const list = orchestrator.runA3Suggestions(ir, blockId);
  for (const s of list) store.appendSuggestion(docId, s);
  return c.json({ suggestions: list });
});

app.post("/documents/:docId/suggestions/:sid/apply", async (c) => {
  const docId = c.req.param("docId");
  const sid = c.req.param("sid");
  const meta = store.readMeta(docId);
  const body = await c.req.json().catch(() => ({}));
  const edited = typeof body.edited_text === "string" ? body.edited_text : undefined;
  const suggestions = store.readSuggestions(docId);
  const s = suggestions.find((x) => x.suggestion_id === sid);
  if (!s) return c.json({ error: "not found" }, 404);
  let draft = store.readDraft(docId, meta.current_version_id);
  const { draft: next, summary } = orchestrator.applySuggestionToDraft(
    draft,
    s,
    edited,
  );
  store.writeDraft(docId, meta.current_version_id, next);
  const applied = { ...s, status: edited ? "edited" : "accepted" } as typeof s;
  store.appendSuggestion(docId, applied);
  meta.audit.push({
    at: new Date().toISOString(),
    action: "suggestion_applied",
    detail: sid,
  });
  meta.document_status = "Revised";
  store.writeMeta(meta);
  return c.json({ draft: next, summary });
});

app.post("/documents/:docId/versions", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const prevVid = meta.current_version_id;
  const newVid = `v-${randomUUID().slice(0, 8)}`;
  const ir = tryReadIR(docId, prevVid);
  if (!ir) {
    return c.json(irNotReadyPayload(docId, prevVid), 409);
  }
  let draft = await safeDraft(docId, prevVid);
  if (!draft) {
    const r = await orchestrator.runA1StructuringAsync(ir);
    draft = r.draft;
  }
  let prevDraftText = "{}";
  try {
    prevDraftText = JSON.stringify(store.readDraft(docId, prevVid));
  } catch {
    prevDraftText = "{}";
  }
  store.writeIR(docId, newVid, ir);
  store.writeDraft(docId, newVid, draft);
  const nextDraftText = JSON.stringify(draft);
  const summary = orchestrator.summarizeVersionDiff(prevDraftText, nextDraftText);
  const record = {
    version_id: newVid,
    parent_version_id: prevVid,
    doc_snapshot_path: join(store.versionDir(docId, newVid), "ir.json"),
    ground_truth_snapshot_path: join(store.versionDir(docId, newVid), "draft.json"),
    change_summary: summary.slice(0, 2000),
    created_by: "local-user",
    created_at: new Date().toISOString(),
  };
  store.writeVersionRecord(docId, record);
  meta.current_version_id = newVid;
  meta.audit.push({
    at: new Date().toISOString(),
    action: "version_created",
    detail: newVid,
  });
  store.writeMeta(meta);
  return c.json(orchestrator.versionActionStub(newVid));
});

app.get("/documents/:docId/versions", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  return c.json({
    current_version_id: meta.current_version_id,
    versions: store.listVersionRecords(docId),
  });
});

app.get("/documents/:docId/versions/:v1/diff/:v2", async (c) => {
  const docId = c.req.param("docId");
  const v1 = c.req.param("v1");
  const v2 = c.req.param("v2");
  const d1 = store.readDraft(docId, v1);
  const d2 = store.readDraft(docId, v2);
  const flat = (d: typeof d1) =>
    Object.fromEntries(
      Object.entries(d).filter(([k]) => k !== "gaps" && k !== "confidence_by_field"),
    );
  return c.json({
    structured: structuredDiff(flat(d1) as Record<string, unknown>, flat(d2) as Record<string, unknown>),
    text_summary: textDiff(JSON.stringify(d1, null, 2), JSON.stringify(d2, null, 2)).slice(0, 8000),
  });
});

app.get("/documents/:docId/publish-readiness", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  let draft = await safeDraft(docId, meta.current_version_id);
  if (!draft) return c.json({ error: "no draft" }, 400);
  return c.json(orchestrator.runA6Publish(draft));
});

app.patch("/documents/:docId/status", async (c) => {
  const docId = c.req.param("docId");
  const meta = store.readMeta(docId);
  const body = await c.req.json();
  const next = body.document_status as DocumentStatus;
  assertTransition(meta.document_status, next);
  meta.document_status = next;
  meta.audit.push({
    at: new Date().toISOString(),
    action: "status_changed",
    detail: next,
  });
  store.writeMeta(meta);
  return c.json(meta);
});

async function safeDraft(
  docId: string,
  versionId: string,
): Promise<import("@ebs/ground-truth-schema").GroundTruthDraft | null> {
  try {
    return store.readDraft(docId, versionId);
  } catch {
    return null;
  }
}

setInterval(() => {
  void processParseJobs(store);
}, 1500);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`API listening on http://localhost:${port}`);
