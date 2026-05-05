import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Lexer } from "marked";
import type { DocumentBlock, DocumentIR } from "../types.js";
import type { ParserAdapter, ParserInput, ParserResult } from "./parser-adapter.js";
import { isIgnorableBlockText } from "./block-normalization.js";

type MarkedToken = {
  type: string;
  raw?: string;
  text?: string;
  depth?: number;
  tokens?: MarkedToken[];
  items?: MarkedToken[];
};

function countLines(raw: string): number {
  if (!raw) return 0;
  return raw.split(/\r?\n/).length;
}

function tokenText(token: MarkedToken): string {
  if (token.type === "table") return token.raw?.trim() ?? "";
  if (token.type === "list") {
    const items = token.items ?? [];
    if (items.length > 0) {
      return items.map((item) => item.raw?.trim() ?? item.text?.trim() ?? "").join("\n").trim();
    }
  }
  if (token.type === "blockquote") return token.text?.trim() ?? token.raw?.replace(/^>\s?/gm, "").trim() ?? "";
  if (token.type === "code") return token.text?.trim() ?? token.raw?.trim() ?? "";
  return token.text?.trim() ?? token.raw?.trim() ?? "";
}

function hasImageToken(token: MarkedToken): boolean {
  if (token.type === "image") return true;
  return (token.tokens ?? []).some(hasImageToken);
}

function blockType(token: MarkedToken): DocumentBlock["block_type"] {
  if (token.type === "heading") return "heading";
  if (token.type === "table") return "table";
  if (token.type === "list") return "list";
  if (hasImageToken(token)) return "image";
  return "paragraph";
}

function parseMarkedMarkdown(text: string, filename: string, docId: string, versionId: string): {
  ir: DocumentIR;
  ignoredBlockCount: number;
} {
  const blocks: DocumentBlock[] = [];
  const headingStack: { level: number; block: DocumentBlock }[] = [];
  const tokens = Lexer.lex(text, { gfm: true }) as MarkedToken[];
  let lineCursor = 1;
  let ignoredBlockCount = 0;

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

  for (const token of tokens) {
    const raw = token.raw ?? "";
    const lineCount = Math.max(1, countLines(raw));
    const startLine = lineCursor;
    const endLine = lineCursor + lineCount - 1;
    lineCursor += lineCount;

    if (token.type === "space") continue;
    const content = tokenText(token);
    if (!content) continue;
    if (isIgnorableBlockText(content)) {
      ignoredBlockCount += 1;
      continue;
    }
    const nextBlockType = blockType(token);
    const headingLevel = nextBlockType === "heading" ? token.depth ?? 1 : 0;
    let parent: DocumentBlock | undefined;
    if (nextBlockType === "heading") {
      for (let i = headingStack.length - 1; i >= 0; i -= 1) {
        if (headingStack[i]!.level < headingLevel) {
          parent = headingStack[i]!.block;
          break;
        }
      }
    }
    push({
      block_id: `b${blocks.length + 1}`,
      block_type: nextBlockType,
      text_content: content,
      heading_level: headingLevel,
      source_file: filename,
      source_span: startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
      parent_block_id: parent?.block_id ?? null,
    });
  }

  return {
    ir: {
      doc_id: docId,
      version_id: versionId,
      blocks,
    },
    ignoredBlockCount,
  };
}

export function buildMarkedMarkdownDocumentIR(input: ParserInput): DocumentIR {
  const text = readFileSync(input.inputPath, "utf8");
  return parseMarkedMarkdown(text, basename(input.inputPath), input.docId, input.versionId).ir;
}

export const markedMarkdownParserAdapter: ParserAdapter = {
  profile: "marked",
  async parse(input: ParserInput): Promise<ParserResult> {
    const started = Date.now();
    const filename = basename(input.inputPath);
    const parsed = parseMarkedMarkdown(
      readFileSync(input.inputPath, "utf8"),
      filename,
      input.docId,
      input.versionId,
    );
    const ir = parsed.ir;
    const headingCount = ir.blocks.filter((block) => block.block_type === "heading").length;
    const tableCount = ir.blocks.filter((block) => block.block_type === "table").length;
    const imageCount = ir.blocks.filter((block) => block.block_type === "image").length;
    return {
      ir,
      diagnostics: {
        parser_name: "marked_markdown_parser",
        parser_version: "marked",
        input_file_type: filename.split(".").pop() ?? "unknown",
        parse_duration_ms: Date.now() - started,
        block_count: ir.blocks.length,
        heading_count: headingCount,
        table_count: tableCount,
        image_count: imageCount,
        conversion_mode: "marked_tokens_to_document_ir",
        ignored_block_count: parsed.ignoredBlockCount,
        ignored_block_reasons: parsed.ignoredBlockCount > 0 ? ["separator_or_symbol_only"] : [],
        warnings: ir.blocks.length === 0 ? ["empty_document_ir"] : [],
      },
      metricHints: {
        block_integrity_rate: ir.blocks.length > 0 ? 0.94 : 0,
        heading_preservation_rate: headingCount > 0 ? 0.96 : 0.9,
        table_preservation_rate: tableCount > 0 ? 0.95 : 0.85,
      },
    };
  },
};
