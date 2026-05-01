import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DocumentIR } from "@ebs/document-ir";
import { DocumentIRSchema } from "@ebs/document-ir";
import {
  classifySource,
  cleanupWorkDir,
  copyDerivedAssets,
  fileBufferToDocumentIR,
  mergeBlocksWithDerivedImages,
  repoRootFromDataStore,
  tryDoclingConvert,
} from "@ebs/parsing";
import type { FileStore } from "@ebs/storage";

export async function processParseJobs(store: FileStore): Promise<number> {
  const dir = join(store.root, "jobs");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return 0;
  }
  let n = 0;
  const repoRoot = repoRootFromDataStore(store.root);

  for (const f of files) {
    const p = join(dir, f);
    try {
      const job = JSON.parse(readFileSync(p, "utf8")) as {
        job_id: string;
        type: string;
        payload: {
          doc_id: string;
          version_id: string;
          path: string;
          filename: string;
        };
      };
      if (job.type !== "parse") continue;

      const buf = readFileSync(job.payload.path);
      const { doc_id: docId, version_id: versionId, filename } = job.payload;
      const kind = classifySource(filename);
      const workDir = join(store.root, "tmp", job.job_id);

      let ir: DocumentIR | undefined;

      try {
        if (kind === "pdf" || kind === "docx" || kind === "pptx") {
          const conv = tryDoclingConvert({
            buffer: buf,
            filename,
            repoRoot,
            workDir,
          });
          if (conv && conv.blocks.length > 0) {
            let blocks = conv.blocks;
            const destAssets = store.derivedAssetsDir(docId, versionId);
            if (conv.assetsSourceDir) {
              copyDerivedAssets({
                assetsSourceDir: conv.assetsSourceDir,
                destAssetsDir: destAssets,
              });
              blocks = mergeBlocksWithDerivedImages({
                blocks,
                assetsDir: destAssets,
                docId,
                versionId,
                logicalSourceFile: filename,
              });
            }
            ir = DocumentIRSchema.parse({
              doc_id: docId,
              version_id: versionId,
              blocks,
            });
          }
        }
      } finally {
        cleanupWorkDir(workDir);
      }

      if (!ir) {
        ir = await fileBufferToDocumentIR({
          docId,
          versionId,
          filename,
          buffer: buf,
        });
      }

      store.writeIR(docId, versionId, ir);
      const meta = store.readMeta(docId);
      meta.audit.push({
        at: new Date().toISOString(),
        action: "parse_completed",
        detail: filename,
      });
      store.writeMeta(meta);
      unlinkSync(p);
      n += 1;
    } catch {
      /* leave job for retry */
    }
  }
  return n;
}
