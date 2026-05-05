import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { DocumentBlock, DocumentIR } from "../types.js";
import type { ParserAdapter, ParserInput, ParserResult } from "./parser-adapter.js";
import { isIgnorableBlockText } from "./block-normalization.js";

function parseMarkdown(text: string, filename: string): { blocks: DocumentBlock[]; ignoredBlockCount: number } {
  const blocks: DocumentBlock[] = [];
  const headingStack: { level: number; block: DocumentBlock }[] = [];
  let paragraph: string[] = [];
  let startLine = 1;
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

  const flushParagraph = (lineNo: number) => {
    const content = paragraph.join("\n").trim();
    if (!content) return;
    push({
      block_id: `b${blocks.length + 1}`,
      block_type: "paragraph",
      text_content: content,
      heading_level: 0,
      source_file: filename,
      source_span: `L${startLine}-L${lineNo}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
    });
    paragraph = [];
  };

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index]!;
    if (line.trim() !== "" && isIgnorableBlockText(line)) {
      flushParagraph(lineNo - 1);
      ignoredBlockCount += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(lineNo - 1);
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
        source_file: filename,
        source_span: `L${lineNo}`,
        page_no: null,
        sheet_name: null,
        node_path: null,
        parent_block_id: parent?.block_id ?? null,
      });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph(lineNo - 1);
      continue;
    }
    if (paragraph.length === 0) startLine = lineNo;
    paragraph.push(line);
  }
  flushParagraph(lines.length);
  return { blocks, ignoredBlockCount };
}

export function buildBuiltinMarkdownDocumentIR(input: ParserInput): DocumentIR {
  const buffer = readFileSync(input.inputPath);
  const filename = basename(input.inputPath);
  const parsed = parseMarkdown(buffer.toString("utf8"), filename);
  return {
    doc_id: input.docId,
    version_id: input.versionId,
    blocks: parsed.blocks,
  };
}

export const builtinMarkdownParserAdapter: ParserAdapter = {
  profile: "builtin",
  async parse(input: ParserInput): Promise<ParserResult> {
    const started = Date.now();
    const filename = basename(input.inputPath);
    const parsed = parseMarkdown(readFileSync(input.inputPath, "utf8"), filename);
    const ir = {
      doc_id: input.docId,
      version_id: input.versionId,
      blocks: parsed.blocks,
    };
    const headingCount = ir.blocks.filter((block) => block.block_type === "heading").length;
    const tableCount = ir.blocks.filter((block) => block.block_type === "table").length;
    const imageCount = ir.blocks.filter((block) => block.block_type === "image").length;
    return {
      ir,
      diagnostics: {
        parser_name: "builtin_markdown_parser",
        parser_version: "v1",
        input_file_type: filename.split(".").pop() ?? "unknown",
        parse_duration_ms: Date.now() - started,
        block_count: ir.blocks.length,
        heading_count: headingCount,
        table_count: tableCount,
        image_count: imageCount,
        conversion_mode: "markdown_line_parser",
        ignored_block_count: parsed.ignoredBlockCount,
        ignored_block_reasons: parsed.ignoredBlockCount > 0 ? ["separator_or_symbol_only"] : [],
        warnings: ir.blocks.length === 0 ? ["empty_document_ir"] : [],
      },
      metricHints: {
        block_integrity_rate: ir.blocks.length > 0 ? 0.9 : 0,
        heading_preservation_rate: headingCount > 0 ? 0.95 : 0.9,
        table_preservation_rate: tableCount > 0 ? 0.9 : 1,
      },
    };
  },
};
