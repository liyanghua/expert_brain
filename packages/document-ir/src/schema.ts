import { z } from "zod";

export const BlockTypeSchema = z.enum([
  "heading",
  "paragraph",
  "list",
  "table",
  "image",
  "outline",
]);

export type BlockType = z.infer<typeof BlockTypeSchema>;

export const DocumentBlockSchema = z.object({
  block_id: z.string().min(1),
  block_type: BlockTypeSchema,
  text_content: z.string(),
  heading_level: z.number().int().min(0).max(6),
  source_file: z.string(),
  source_span: z.string().optional(),
  page_no: z.number().int().nullable().optional(),
  sheet_name: z.string().nullable().optional(),
  node_path: z.string().nullable().optional(),
  attachment_refs: z.array(z.string()).default([]),
  parent_block_id: z.string().nullable().optional(),
  children_block_ids: z.array(z.string()).default([]),
  /** API path fragment for derived asset (e.g. `/documents/:id/versions/:vid/assets/foo.png`) */
  media_uri: z.string().optional(),
});

export type DocumentBlock = z.infer<typeof DocumentBlockSchema>;

export const DocumentIRSchema = z.object({
  doc_id: z.string().min(1),
  version_id: z.string().min(1),
  blocks: z.array(DocumentBlockSchema),
});

export type DocumentIR = z.infer<typeof DocumentIRSchema>;

export function emptyDocumentIR(docId: string, versionId: string): DocumentIR {
  return {
    doc_id: docId,
    version_id: versionId,
    blocks: [],
  };
}
