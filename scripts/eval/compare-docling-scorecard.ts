/**
 * Docling 允许 vs 禁用：同一文件两条解析路径 → runStructuring → computeExtractionScorecard 并排对比。
 * Usage: pnpm exec tsx scripts/eval/compare-docling-scorecard.ts <path-to.pdf|docx|pptx>
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStructuring } from "@ebs/agent-core";
import { computeExtractionScorecard } from "@ebs/extraction-scorecard";
import type { DocumentIR } from "@ebs/document-ir";
import { DocumentIRSchema } from "@ebs/document-ir";
import {
  classifySource,
  cleanupWorkDir,
  fileBufferToDocumentIR,
  mergeBlocksWithDerivedImages,
  tryDoclingConvert,
} from "@ebs/parsing";
import type { SourceKind } from "@ebs/parsing";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

const DOC_IDS = {
  docId: "eval-ab",
  versionId: "v1",
} as const;

const HEURISTIC_COMPARABLE_SCORE_KEYS = [
  "field_coverage",
  "source_grounding_rate",
  "structural_consistency",
  "gap_detection_accuracy",
  "inference_handling_accuracy",
] as const;

const HEURISTIC_NULL_OR_SKIPPED = [
  "field_accuracy",
  "item_f1",
  "human_revision_rate",
] as const;

function irStats(ir: DocumentIR) {
  const { blocks } = ir;
  return {
    block_count: blocks.length,
    image_block_count: blocks.filter((b) => b.block_type === "image").length,
    table_block_count: blocks.filter((b) => b.block_type === "table").length,
    heading_block_count: blocks.filter((b) => b.block_type === "heading").length,
    list_block_count: blocks.filter((b) => b.block_type === "list").length,
    paragraph_block_count: blocks.filter((b) => b.block_type === "paragraph")
      .length,
  };
}

async function buildIr(args: {
  buffer: Buffer;
  filename: string;
  kind: SourceKind;
  allowDoclingPath: boolean;
}): Promise<{ ir: DocumentIR; docling_path: "docling" | "fallback" | "n/a" }> {
  const { buffer, filename, kind, allowDoclingPath } = args;
  const { docId, versionId } = DOC_IDS;

  if (!allowDoclingPath) {
    const ir = await fileBufferToDocumentIR({
      docId,
      versionId,
      filename,
      buffer,
    });
    return { ir, docling_path: "n/a" };
  }

  const workDir = join(repoRoot, "tmp", `eval-ab-${randomUUID()}`);
  let ir: DocumentIR | undefined;
  let docling_path: "docling" | "fallback" = "fallback";

  try {
    if (kind === "pdf" || kind === "docx" || kind === "pptx") {
      const conv = tryDoclingConvert({
        buffer,
        filename,
        repoRoot,
        workDir,
      });
      if (conv && conv.blocks.length > 0) {
        docling_path = "docling";
        let blocks = conv.blocks;
        if (conv.assetsSourceDir) {
          blocks = mergeBlocksWithDerivedImages({
            blocks,
            assetsDir: conv.assetsSourceDir,
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
      buffer,
    });
  }

  return { ir, docling_path };
}

function main() {
  void run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "用法: pnpm exec tsx scripts/eval/compare-docling-scorecard.ts <pdf|docx|pptx>",
    );
    process.exit(1);
  }

  const filename = filePath.split(/[/\\]/).pop() ?? filePath;
  const kind = classifySource(filename);
  if (kind !== "pdf" && kind !== "docx" && kind !== "pptx") {
    console.error(
      `仅支持 pdf / docx / pptx（当前文件归类为: ${kind}）。仓库内若无样例，请自备一份 Office/PDF 测试文件。`,
    );
    process.exit(1);
  }

  const buffer = readFileSync(filePath);
  const prevFlag = process.env.EBS_USE_DOCLING;

  try {
    delete process.env.EBS_USE_DOCLING;
    const armA = await buildIr({
      buffer,
      filename,
      kind,
      allowDoclingPath: true,
    });
    const draftA = runStructuring(armA.ir);
    const scoreA = computeExtractionScorecard({ draft: draftA, ir: armA.ir });

    process.env.EBS_USE_DOCLING = "0";
    const armB = await buildIr({
      buffer,
      filename,
      kind,
      allowDoclingPath: false,
    });
    const draftB = runStructuring(armB.ir);
    const scoreB = computeExtractionScorecard({ draft: draftB, ir: armB.ir });

    const report = {
      input: { path: filePath, filename, kind },
      heuristic_note: {
        mode: scoreA.mode,
        comparable_score_keys: [...HEURISTIC_COMPARABLE_SCORE_KEYS],
        typically_null_or_skipped: [...HEURISTIC_NULL_OR_SKIPPED],
      },
      arm_docling_allowed: {
        docling_path: armA.docling_path,
        ir_stats: irStats(armA.ir),
        scorecard: scoreA,
      },
      arm_docling_off: {
        docling_path: armB.docling_path,
        ir_stats: irStats(armB.ir),
        scorecard: scoreB,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (prevFlag === undefined) delete process.env.EBS_USE_DOCLING;
    else process.env.EBS_USE_DOCLING = prevFlag;
  }
}

main();
