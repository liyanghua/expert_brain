import { randomUUID } from "node:crypto";
import type { DocumentIR } from "@ebs/document-ir";
import { DocumentIRSchema } from "@ebs/document-ir";
import {
  classifySource,
  parseDocxToBlocks,
  parseMarkdownToBlocks,
  parsePdfToBlocks,
  parseXlsxToBlocks,
} from "./parsers.js";

export async function fileBufferToDocumentIR(input: {
  docId: string;
  versionId: string;
  filename: string;
  mime?: string;
  buffer: Buffer;
}): Promise<DocumentIR> {
  const kind = classifySource(input.filename, input.mime);
  let blocks;

  switch (kind) {
    case "markdown":
      blocks = parseMarkdownToBlocks(
        input.buffer.toString("utf8"),
        input.filename,
      );
      break;
    case "pdf":
      blocks = await parsePdfToBlocks(input.buffer, input.filename);
      break;
    case "docx":
      blocks = await parseDocxToBlocks(input.buffer, input.filename);
      break;
    case "xlsx":
      blocks = await parseXlsxToBlocks(input.buffer, input.filename);
      break;
    case "pptx":
      blocks = [
        {
          block_id: randomUUID(),
          block_type: "paragraph" as const,
          text_content:
            "[PPTX] 安装 Docling（见 apps/docling-worker）后可转换为 Markdown；或导出为 PDF 再导入。",
          heading_level: 0,
          source_file: input.filename,
          source_span: "pptx",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
      ];
      break;
    case "image":
      blocks = [
        {
          block_id: randomUUID(),
          block_type: "image" as const,
          text_content: `[Image file: ${input.filename}]`,
          heading_level: 0,
          source_file: input.filename,
          source_span: "image",
          page_no: null,
          sheet_name: null,
          node_path: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
      ];
      break;
    case "xmind":
      blocks = [
        {
          block_id: randomUUID(),
          block_type: "outline" as const,
          text_content:
            "[XMind parsing not implemented — placeholder outline block]",
          heading_level: 0,
          source_file: input.filename,
          node_path: "/",
          page_no: null,
          sheet_name: null,
          attachment_refs: [],
          parent_block_id: null,
          children_block_ids: [],
        },
      ];
      break;
    default:
      blocks = parseMarkdownToBlocks(
        input.buffer.toString("utf8"),
        input.filename,
      );
  }

  return DocumentIRSchema.parse({
    doc_id: input.docId,
    version_id: input.versionId,
    blocks,
  });
}

export * from "./parsers.js";
