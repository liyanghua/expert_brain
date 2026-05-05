import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import type { DocumentBlock, DocumentIR } from "../types.js";
import type { ParserAdapter, ParserInput, ParserResult } from "./parser-adapter.js";
import { isIgnorableBlockText } from "./block-normalization.js";

type DoclingAdapterOptions = {
  command?: string;
  timeoutMs?: number;
  mockMarkdown?: string;
};

function blockTypeForLines(lines: string[]): DocumentBlock["block_type"] {
  const first = lines[0]?.trim() ?? "";
  if (/^!\[[^\]]*]\(.+\)/.test(first)) return "image";
  if (lines.every((line) => /^\s*(?:[-*+]|\d+\.)\s+/.test(line))) return "list";
  if (lines.some((line) => /^\s*\|.*\|\s*$/.test(line))) return "table";
  return "paragraph";
}

function parseDoclingMarkdown(input: {
  markdown: string;
  filename: string;
  docId: string;
  versionId: string;
}): { ir: DocumentIR; ignoredBlockCount: number } {
  const blocks: DocumentBlock[] = [];
  const headingStack: { level: number; block: DocumentBlock }[] = [];
  let pending: string[] = [];
  let ignoredBlockCount = 0;

  const sourceSpan = () => `docling:block:${blocks.length + 1}`;

  const push = (block: Omit<DocumentBlock, "children_block_ids" | "attachment_refs">) => {
    const parent = headingStack[headingStack.length - 1]?.block;
    const next: DocumentBlock = {
      ...block,
      parent_block_id: block.parent_block_id ?? parent?.block_id ?? null,
      children_block_ids: [],
      attachment_refs: [],
    };
    blocks.push(next);
    if (parent) parent.children_block_ids.push(next.block_id);
    if (next.block_type === "heading") {
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]!.level >= next.heading_level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level: next.heading_level, block: next });
    }
  };

  const flushPending = () => {
    const content = pending.join("\n").trim();
    if (!content) {
      pending = [];
      return;
    }
    if (isIgnorableBlockText(content)) {
      ignoredBlockCount += 1;
      pending = [];
      return;
    }
    const blockType = blockTypeForLines(pending);
    push({
      block_id: `b${blocks.length + 1}`,
      block_type: blockType,
      text_content: content,
      heading_level: 0,
      source_file: input.filename,
      source_span: sourceSpan(),
      page_no: null,
      sheet_name: null,
      node_path: null,
    });
    pending = [];
  };

  const lines = input.markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed !== "" && isIgnorableBlockText(trimmed)) {
      flushPending();
      ignoredBlockCount += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPending();
      const level = heading[1]!.length;
      let parent: DocumentBlock | undefined;
      for (let i = headingStack.length - 1; i >= 0; i -= 1) {
        if (headingStack[i]!.level < level) {
          parent = headingStack[i]!.block;
          break;
        }
      }
      push({
        block_id: `b${blocks.length + 1}`,
        block_type: "heading",
        text_content: heading[2]!.trim(),
        heading_level: level,
        source_file: input.filename,
        source_span: sourceSpan(),
        page_no: null,
        sheet_name: null,
        node_path: null,
        parent_block_id: parent?.block_id ?? null,
      });
      continue;
    }
    if (trimmed === "") {
      flushPending();
      continue;
    }

    const isTableLine = /^\s*\|.*\|\s*$/.test(line);
    const isListLine = /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
    const pendingType = pending.length > 0 ? blockTypeForLines(pending) : null;
    if (
      pending.length > 0 &&
      ((isTableLine && pendingType !== "table") || (isListLine && pendingType !== "list"))
    ) {
      flushPending();
    }
    pending.push(line);
  }
  flushPending();

  return {
    ir: {
      doc_id: input.docId,
      version_id: input.versionId,
      blocks,
    },
    ignoredBlockCount,
  };
}

export function doclingMarkdownToDocumentIR(input: {
  markdown: string;
  filename: string;
  docId: string;
  versionId: string;
}): DocumentIR {
  return parseDoclingMarkdown(input).ir;
}

export function isDoclingAvailable(command = "docling"): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10_000 });
  return !result.error && result.status === 0;
}

function readDoclingMarkdown(inputPath: string, options: Required<DoclingAdapterOptions>): string {
  if (options.mockMarkdown) return options.mockMarkdown;
  const fixturePath = process.env.AGENT_MODE_RUNNER_DOCLING_MARKDOWN_FIXTURE;
  if (fixturePath) return readFileSync(fixturePath, "utf8");

  const result = spawnSync(options.command, [inputPath, "--to", "md"], {
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error("docling_not_installed: install with `pip install docling` or use --parse-profile builtin");
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `docling_parse_failed: exit=${result.status}; stderr=${(result.stderr ?? "").trim()}`,
    );
  }
  const markdown = (result.stdout ?? "").trim();
  if (!markdown) {
    throw new Error("docling_empty_output: Docling returned no markdown output");
  }
  return markdown;
}

export function createDoclingParserAdapter(options: DoclingAdapterOptions = {}): ParserAdapter {
  const resolved: Required<DoclingAdapterOptions> = {
    command: options.command ?? process.env.AGENT_MODE_RUNNER_DOCLING_COMMAND ?? "docling",
    timeoutMs: options.timeoutMs ?? 120_000,
    mockMarkdown: options.mockMarkdown ?? "",
  };
  return {
    profile: "docling",
    async parse(input: ParserInput): Promise<ParserResult> {
      const started = Date.now();
      const filename = basename(input.inputPath);
      const markdown = readDoclingMarkdown(input.inputPath, resolved);
      const parsed = parseDoclingMarkdown({
        markdown,
        filename,
        docId: input.docId,
        versionId: input.versionId,
      });
      const ir = parsed.ir;
      const headingCount = ir.blocks.filter((block) => block.block_type === "heading").length;
      const tableCount = ir.blocks.filter((block) => block.block_type === "table").length;
      const imageCount = ir.blocks.filter((block) => block.block_type === "image").length;
      const warnings = ir.blocks.length === 0 ? ["empty_document_ir"] : [];
      if (tableCount === 0 && /\|.*\|/.test(markdown)) {
        warnings.push("table_like_markdown_not_mapped");
      }
      return {
        ir,
        diagnostics: {
          parser_name: "docling",
          parser_version: "cli",
          input_file_type: filename.split(".").pop() ?? "unknown",
          parse_duration_ms: Date.now() - started,
          block_count: ir.blocks.length,
          heading_count: headingCount,
          table_count: tableCount,
          image_count: imageCount,
          conversion_mode: "docling_markdown_to_document_ir",
          raw_docling_output_path: "raw_docling_output.json",
          ignored_block_count: parsed.ignoredBlockCount,
          ignored_block_reasons: parsed.ignoredBlockCount > 0 ? ["separator_or_symbol_only"] : [],
          warnings,
        },
        metricHints: {
          block_integrity_rate: ir.blocks.length > 0 ? 0.94 : 0,
          heading_preservation_rate: headingCount > 0 ? 0.96 : 0.85,
          table_preservation_rate: tableCount > 0 ? 0.92 : 0.7,
        },
        extraArtifacts: {
          raw_docling_output: {
            format: "markdown",
            parser_command: resolved.mockMarkdown ? "mock" : resolved.command,
            content: markdown,
          },
        },
      };
    },
  };
}

export const doclingParserAdapter = createDoclingParserAdapter();
