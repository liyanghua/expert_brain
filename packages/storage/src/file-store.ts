import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentIR } from "@ebs/document-ir";
import type {
  DocumentStatus,
  ExpertMemory,
  GroundTruthDraft,
  SuggestionRecord,
  VersionRecord,
} from "@ebs/ground-truth-schema";
import { ExpertMemorySchema } from "@ebs/ground-truth-schema";

export type DocumentMeta = {
  doc_id: string;
  title: string;
  document_status: DocumentStatus;
  current_version_id: string;
  sources: { file_id: string; filename: string; stored_path: string }[];
  suggestion_ids: string[];
  audit: { at: string; action: string; detail?: string }[];
};

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

export class FileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
    ensureDir(root);
    ensureDir(join(root, "jobs"));
    ensureDir(join(root, "uploads"));
  }

  docDir(docId: string) {
    return join(this.root, "docs", docId);
  }

  versionDir(docId: string, versionId: string) {
    return join(this.docDir(docId), "versions", versionId);
  }

  derivedAssetsDir(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "derived", "assets");
  }

  readMeta(docId: string): DocumentMeta {
    const p = join(this.docDir(docId), "meta.json");
    return JSON.parse(readFileSync(p, "utf8")) as DocumentMeta;
  }

  writeMeta(meta: DocumentMeta) {
    const dir = this.docDir(meta.doc_id);
    ensureDir(dir);
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  writeIR(docId: string, versionId: string, ir: DocumentIR) {
    const dir = this.versionDir(docId, versionId);
    ensureDir(dir);
    writeFileSync(join(dir, "ir.json"), JSON.stringify(ir, null, 2));
  }

  readIR(docId: string, versionId: string): DocumentIR {
    const p = join(this.versionDir(docId, versionId), "ir.json");
    return JSON.parse(readFileSync(p, "utf8")) as DocumentIR;
  }

  writeDraft(docId: string, versionId: string, draft: GroundTruthDraft) {
    const dir = this.versionDir(docId, versionId);
    ensureDir(dir);
    writeFileSync(join(dir, "draft.json"), JSON.stringify(draft, null, 2));
  }

  readDraft(docId: string, versionId: string): GroundTruthDraft {
    const p = join(this.versionDir(docId, versionId), "draft.json");
    return JSON.parse(readFileSync(p, "utf8")) as GroundTruthDraft;
  }

  appendSuggestion(docId: string, s: SuggestionRecord) {
    const dir = this.docDir(docId);
    ensureDir(dir);
    const p = join(dir, "suggestions.json");
    let list: SuggestionRecord[] = [];
    try {
      list = JSON.parse(readFileSync(p, "utf8")) as SuggestionRecord[];
    } catch {
      list = [];
    }
    const idx = list.findIndex((x) => x.suggestion_id === s.suggestion_id);
    if (idx >= 0) list[idx] = s;
    else list.push(s);
    writeFileSync(p, JSON.stringify(list, null, 2));
  }

  readSuggestions(docId: string): SuggestionRecord[] {
    const p = join(this.docDir(docId), "suggestions.json");
    try {
      return JSON.parse(readFileSync(p, "utf8")) as SuggestionRecord[];
    } catch {
      return [];
    }
  }

  saveImmutableUpload(docId: string, fileId: string, filename: string, buf: Buffer) {
    const dir = join(this.root, "uploads", docId);
    ensureDir(dir);
    const safeName = filename.replace(/[^\w.\-]+/g, "_");
    const path = join(dir, `${fileId}_${safeName}`);
    writeFileSync(path, buf);
    return path;
  }

  enqueueJob(job: { job_id: string; type: string; payload: unknown }) {
    const tmp = join(this.root, "jobs", `${job.job_id}.tmp`);
    const final = join(this.root, "jobs", `${job.job_id}.json`);
    writeFileSync(tmp, JSON.stringify(job));
    renameSync(tmp, final);
  }

  writeVersionRecord(docId: string, v: VersionRecord) {
    const dir = join(this.docDir(docId), "versions");
    ensureDir(dir);
    writeFileSync(join(dir, `${v.version_id}.meta.json`), JSON.stringify(v, null, 2));
  }

  readVersionRecord(docId: string, versionId: string): VersionRecord | null {
    try {
      const p = join(this.docDir(docId), "versions", `${versionId}.meta.json`);
      return JSON.parse(readFileSync(p, "utf8")) as VersionRecord;
    } catch {
      return null;
    }
  }

  listVersionRecords(docId: string): VersionRecord[] {
    const dir = join(this.docDir(docId), "versions");
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".meta.json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as VersionRecord)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    } catch {
      return [];
    }
  }

  readExpertMemory(docId: string): ExpertMemory {
    const p = join(this.docDir(docId), "expert_memory.json");
    try {
      return ExpertMemorySchema.parse(JSON.parse(readFileSync(p, "utf8")));
    } catch {
      return ExpertMemorySchema.parse({});
    }
  }

  writeExpertMemory(docId: string, memory: ExpertMemory) {
    const dir = this.docDir(docId);
    ensureDir(dir);
    const checked = ExpertMemorySchema.parse(memory);
    writeFileSync(
      join(dir, "expert_memory.json"),
      JSON.stringify(
        {
          ...checked,
          updated_at: checked.updated_at ?? new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
}
