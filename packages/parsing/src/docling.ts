import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DocumentBlock } from "@ebs/document-ir";
import { parseMarkdownToBlocks } from "./parsers.js";

function extension(filename: string): string {
  const m = /\.[^./\\]+$/.exec(filename);
  return m ? m[0] : "";
}

/** Repo root = parent of `data/store` when storeRoot ends with `data/store`. */
export function repoRootFromDataStore(storeRoot: string): string {
  return join(storeRoot, "..", "..");
}

/** Prefer `EBS_PYTHON`, else repo `apps/docling-worker/.venv/bin/python3`, else `python3`. */
export function resolveDoclingPython(repoRoot: string): string {
  const fromEnv = process.env.EBS_PYTHON?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const venvPy = join(repoRoot, "apps/docling-worker/.venv/bin/python3");
  if (existsSync(venvPy)) return venvPy;
  return "python3";
}

export type DoclingConvertResult = {
  blocks: DocumentBlock[];
  assetsSourceDir?: string;
};

/**
 * Run Docling CLI when Python + docling installed. Otherwise returns null.
 */
export function tryDoclingConvert(input: {
  buffer: Buffer;
  filename: string;
  repoRoot: string;
  workDir: string;
}): DoclingConvertResult | null {
  if (process.env.EBS_USE_DOCLING === "0") return null;

  const script = join(input.repoRoot, "apps/docling-worker/convert.py");
  if (!existsSync(script)) return null;

  mkdirSync(input.workDir, { recursive: true });
  const tmpIn = join(input.workDir, `source${extension(input.filename)}`);
  writeFileSync(tmpIn, input.buffer);

  const outDir = join(input.workDir, "docling-out");
  mkdirSync(outDir, { recursive: true });

  const python = resolveDoclingPython(input.repoRoot);
  const proc = spawnSync(python, [script, tmpIn, outDir], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 600_000,
  });

  if (proc.status === 2) return null;
  if (proc.status !== 0) return null;

  const mdPath = join(outDir, "doc.md");
  if (!existsSync(mdPath)) return null;

  const md = readFileSync(mdPath, "utf8");
  const blocks = parseMarkdownToBlocks(md, input.filename);

  const assetsDir = join(outDir, "assets");
  const assetsSourceDir = existsSync(assetsDir) ? assetsDir : undefined;

  return { blocks, assetsSourceDir };
}

export function mergeBlocksWithDerivedImages(input: {
  blocks: DocumentBlock[];
  assetsDir: string;
  docId: string;
  versionId: string;
  logicalSourceFile: string;
}): DocumentBlock[] {
  const covered = new Set<string>();
  for (const b of input.blocks) {
    if (b.block_type !== "image") continue;
    if (b.source_span) covered.add(b.source_span);
    const u = b.media_uri;
    if (u) {
      try {
        const tail = decodeURIComponent(u.split("/assets/").pop() ?? "");
        if (tail) covered.add(tail);
      } catch {
        /* ignore */
      }
    }
  }

  let names: string[] = [];
  try {
    names = readdirSync(input.assetsDir).filter((n) =>
      /\.(png|jpe?g|gif|webp|svg)$/i.test(n),
    );
  } catch {
    return input.blocks;
  }
  names = names.filter((n) => !covered.has(n));
  const extra: DocumentBlock[] = names.map((name) => ({
    block_id: randomUUID(),
    block_type: "image" as const,
    text_content: `[Figure] ${name}`,
    heading_level: 0,
    source_file: input.logicalSourceFile,
    source_span: name,
    page_no: null,
    sheet_name: null,
    node_path: null,
    attachment_refs: [],
    parent_block_id: null,
    children_block_ids: [],
    media_uri: `/documents/${input.docId}/versions/${input.versionId}/assets/${encodeURIComponent(name)}`,
  }));
  return [...input.blocks, ...extra];
}

export function copyDerivedAssets(input: {
  assetsSourceDir: string;
  destAssetsDir: string;
}): void {
  if (!existsSync(input.assetsSourceDir)) return;
  mkdirSync(input.destAssetsDir, { recursive: true });
  cpSync(input.assetsSourceDir, input.destAssetsDir, { recursive: true });
}

export function cleanupWorkDir(workDir: string): void {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
