import { randomUUID } from "node:crypto";
import type { DocumentBlock } from "@ebs/document-ir";

export type SourceKind =
  | "markdown"
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "image"
  | "xmind"
  | "unknown";

export function classifySource(filename: string, mime?: string): SourceKind {
  const lower = filename.toLowerCase();
  if (mime?.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (
    mime?.includes("wordprocessingml") ||
    mime?.includes("msword") ||
    lower.endsWith(".docx")
  )
    return "docx";
  if (mime?.includes("presentationml") || lower.endsWith(".pptx"))
    return "pptx";
  if (
    mime?.includes("spreadsheet") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  )
    return "xlsx";
  if (mime?.includes("markdown") || lower.endsWith(".md")) return "markdown";
  if (
    mime?.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp)$/i.test(lower)
  )
    return "image";
  if (lower.endsWith(".xmind")) return "xmind";
  return "unknown";
}

type BlockInput = Omit<
  DocumentBlock,
  "block_id" | "attachment_refs" | "children_block_ids"
> &
  Partial<Pick<DocumentBlock, "attachment_refs" | "children_block_ids">> & {
    block_id?: string;
  };

function makeBlock(partial: BlockInput): DocumentBlock {
  return {
    block_id: partial.block_id ?? randomUUID(),
    block_type: partial.block_type,
    text_content: partial.text_content,
    heading_level: partial.heading_level,
    source_file: partial.source_file,
    source_span: partial.source_span,
    page_no: partial.page_no ?? null,
    sheet_name: partial.sheet_name ?? null,
    node_path: partial.node_path ?? null,
    attachment_refs: partial.attachment_refs ?? [],
    parent_block_id: partial.parent_block_id ?? null,
    children_block_ids: partial.children_block_ids ?? [],
  };
}

function stripOuterBold(text: string): string | null {
  const m = /^\*\*(.+?)\*\*$/.exec(text.trim());
  return m ? m[1]!.trim() : null;
}

function boldHeadingLevel(text: string): number {
  if (/^[一二三四五六七八九十]+[、.．]/.test(text)) return 1;
  if (/(新品期|成长期|爆发期|衰退期|核心指标|核心目标)/.test(text)) return 2;
  return 2;
}

function looksLikeDocumentTitle(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (t.includes("|")) return false;
  if (/[:：。；;]/.test(t)) return false;
  return true;
}

export function parseMarkdownToBlocks(
  text: string,
  sourceFile: string,
): DocumentBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: DocumentBlock[] = [];
  let para: string[] = [];
  let tableRows: { line: string; ord: number }[] = [];
  let ord = 0;
  let seenContent = false;
  const headingStack: { level: number; block: DocumentBlock }[] = [];

  const pushBlock = (partial: BlockInput) => {
    const isHeading = partial.block_type === "heading";
    let parent: DocumentBlock | undefined;
    if (isHeading) {
      const level = partial.heading_level ?? 1;
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]!.level >= level
      ) {
        headingStack.pop();
      }
      parent = headingStack[headingStack.length - 1]?.block;
    } else {
      parent = headingStack[headingStack.length - 1]?.block;
    }

    const block = makeBlock({
      ...partial,
      parent_block_id: partial.parent_block_id ?? parent?.block_id ?? null,
    });
    blocks.push(block);
    if (parent) parent.children_block_ids.push(block.block_id);
    if (isHeading) {
      headingStack.push({ level: block.heading_level || 1, block });
    }
    seenContent = true;
    return block;
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const start = tableRows[0]!.ord;
    const end = tableRows[tableRows.length - 1]!.ord;
    pushBlock({
      block_type: "table",
      text_content: tableRows.map((r) => r.line).join("\n"),
      heading_level: 0,
      source_file: sourceFile,
      source_span: start === end ? `L${start}` : `L${start}-L${end}`,
    });
    tableRows = [];
  };

  const flushPara = () => {
    const t = para.join("\n").trim();
    if (t) {
      pushBlock({
        block_type: "paragraph",
        text_content: t,
        heading_level: 0,
        source_file: sourceFile,
        source_span: `L${ord - para.length}-L${ord}`,
      });
    }
    para = [];
  };

  for (const line of lines) {
    ord += 1;
    const trimmed = line.trim();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushTable();
      flushPara();
      const level = h[1]!.length;
      pushBlock({
        block_type: "heading",
        text_content: h[2]!.trim(),
        heading_level: level,
        source_file: sourceFile,
        source_span: `L${ord}`,
      });
      continue;
    }
    if (trimmed === "") {
      flushTable();
      flushPara();
      continue;
    }
    const boldTitle = stripOuterBold(trimmed);
    if (boldTitle && looksLikeDocumentTitle(boldTitle)) {
      flushTable();
      flushPara();
      pushBlock({
        block_type: "heading",
        text_content: boldTitle,
        heading_level: boldHeadingLevel(boldTitle),
        source_file: sourceFile,
        source_span: `L${ord}`,
      });
      continue;
    }
    if (!seenContent && looksLikeDocumentTitle(trimmed)) {
      flushTable();
      flushPara();
      pushBlock({
        block_type: "heading",
        text_content: trimmed,
        heading_level: 1,
        source_file: sourceFile,
        source_span: `L${ord}`,
      });
      continue;
    }
    const imgLine = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(trimmed);
    if (imgLine) {
      flushTable();
      flushPara();
      const pathPart = imgLine[2]!.trim();
      const basename = pathPart.split(/[/\\]/).pop() ?? pathPart;
      pushBlock({
        block_type: "image",
        text_content: imgLine[1]!.trim() || "[Image]",
        heading_level: 0,
        source_file: sourceFile,
        source_span: basename,
      });
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      flushTable();
      flushPara();
      pushBlock({
        block_type: "list",
        text_content: trimmed,
        heading_level: 0,
        source_file: sourceFile,
        source_span: `L${ord}`,
      });
      continue;
    }
    if (line.includes("|") && trimmed.startsWith("|")) {
      flushPara();
      tableRows.push({ line, ord });
      continue;
    }
    flushTable();
    para.push(line);
  }
  flushTable();
  flushPara();
  return blocks;
}

export async function parsePdfToBlocks(
  buffer: Buffer,
  sourceFile: string,
): Promise<DocumentBlock[]> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  const text = (data.text ?? "").trim();
  if (!text) {
    return [
      makeBlock({
        block_type: "paragraph",
        text_content: "(empty or scanned PDF — no extractable text)",
        heading_level: 0,
        source_file: sourceFile,
        page_no: 1,
      }),
    ];
  }
  const chunks = text.split(/\n\n+/).filter(Boolean);
  return chunks.map((c, i) =>
    makeBlock({
      block_type: "paragraph",
      text_content: c.trim(),
      heading_level: 0,
      source_file: sourceFile,
      source_span: `pdf_chunk_${i}`,
      page_no: null,
    }),
  );
}

export async function parseDocxToBlocks(
  buffer: Buffer,
  sourceFile: string,
): Promise<DocumentBlock[]> {
  const mammoth = await import("mammoth");
  const r = await mammoth.extractRawText({ buffer });
  const text = r.value.trim();
  if (!text) {
    return [
      makeBlock({
        block_type: "paragraph",
        text_content: "(empty docx)",
        heading_level: 0,
        source_file: sourceFile,
      }),
    ];
  }
  return parseMarkdownToBlocks(text.replace(/\r/g, ""), sourceFile);
}

export async function parseXlsxToBlocks(
  buffer: Buffer,
  sourceFile: string,
): Promise<DocumentBlock[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const blocks: DocumentBlock[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    blocks.push(
      makeBlock({
        block_type: "table",
        text_content: csv,
        heading_level: 0,
        source_file: sourceFile,
        sheet_name: sheetName,
        source_span: `sheet:${sheetName}`,
      }),
    );
  }
  return blocks;
}