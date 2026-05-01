import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStructuring } from "@ebs/agent-core";
import { DocumentIRSchema } from "@ebs/document-ir";
import { STRUCTURED_FIELD_KEYS } from "@ebs/ground-truth-schema";
import { parseMarkdownToBlocks } from "@ebs/parsing";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const mdPath = join(root, "data/fixtures/sample.md");
const md = readFileSync(mdPath, "utf8");
const blocks = parseMarkdownToBlocks(md, "sample.md");
const ir = DocumentIRSchema.parse({
  doc_id: "eval-doc",
  version_id: "v1",
  blocks,
});
const draft = runStructuring(ir);

let filled = 0;
for (const k of STRUCTURED_FIELD_KEYS) {
  const v = draft[k as keyof typeof draft];
  if (Array.isArray(v) && v.length) filled++;
  else if (v && typeof v === "object" && "content" in (v as object)) filled++;
}

console.log(
  JSON.stringify(
    {
      field_fill_ratio: filled / STRUCTURED_FIELD_KEYS.length,
      gap_count: draft.gaps.length,
      sample_confidence: draft.confidence_by_field.business_scenario,
    },
    null,
    2,
  ),
);
