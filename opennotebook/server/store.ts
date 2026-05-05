import { FileStore } from "@ebs/storage";
import type { RetrievalIndexEntry } from "./retrieval.js";
import type {
  NotebookDocumentUnderstanding,
  NotebookEvidencePack,
} from "./evidence-pack.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class NotebookStore extends FileStore {
  retrievalIndexPath(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "retrieval-index.json");
  }

  writeRetrievalIndex(docId: string, versionId: string, index: RetrievalIndexEntry[]) {
    const dir = this.versionDir(docId, versionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.retrievalIndexPath(docId, versionId), JSON.stringify(index, null, 2));
  }

  readRetrievalIndex(docId: string, versionId: string): RetrievalIndexEntry[] {
    return JSON.parse(readFileSync(this.retrievalIndexPath(docId, versionId), "utf8")) as RetrievalIndexEntry[];
  }

  documentUnderstandingPath(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "document-understanding.json");
  }

  writeDocumentUnderstanding(
    docId: string,
    versionId: string,
    understanding: NotebookDocumentUnderstanding,
  ) {
    const dir = this.versionDir(docId, versionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.documentUnderstandingPath(docId, versionId),
      JSON.stringify(understanding, null, 2),
    );
  }

  readDocumentUnderstanding(docId: string, versionId: string): NotebookDocumentUnderstanding | null {
    try {
      return JSON.parse(
        readFileSync(this.documentUnderstandingPath(docId, versionId), "utf8"),
      ) as NotebookDocumentUnderstanding;
    } catch {
      return null;
    }
  }

  evidencePackCachePath(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "evidence-pack-cache.json");
  }

  writeEvidencePackCache(
    docId: string,
    versionId: string,
    cache: Record<string, NotebookEvidencePack>,
  ) {
    const dir = this.versionDir(docId, versionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.evidencePackCachePath(docId, versionId), JSON.stringify(cache, null, 2));
  }

  readEvidencePackCache(
    docId: string,
    versionId: string,
  ): Record<string, NotebookEvidencePack> {
    try {
      return JSON.parse(
        readFileSync(this.evidencePackCachePath(docId, versionId), "utf8"),
      ) as Record<string, NotebookEvidencePack>;
    } catch {
      return {};
    }
  }

  contentListPath(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "content-list.json");
  }

  writeContentList(docId: string, versionId: string, contentList: unknown[]) {
    const dir = this.versionDir(docId, versionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.contentListPath(docId, versionId), JSON.stringify(contentList, null, 2));
  }

  multimodalSourceGraphPath(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "multimodal-source-graph.json");
  }

  writeMultimodalSourceGraph(docId: string, versionId: string, sourceGraph: unknown) {
    const dir = this.versionDir(docId, versionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.multimodalSourceGraphPath(docId, versionId),
      JSON.stringify(sourceGraph, null, 2),
    );
  }

  retrievalManifestPath(docId: string, versionId: string) {
    return join(this.versionDir(docId, versionId), "retrieval-manifest.json");
  }

  writeRetrievalManifest(docId: string, versionId: string, manifest: unknown) {
    const dir = this.versionDir(docId, versionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.retrievalManifestPath(docId, versionId),
      JSON.stringify(manifest, null, 2),
    );
  }
}
