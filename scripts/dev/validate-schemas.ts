import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentIRSchema } from "@ebs/document-ir";
import { GroundTruthDraftSchema } from "@ebs/ground-truth-schema";
import type { z } from "zod";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = join(root, "data/fixtures");

function validate(name: string, schema: z.ZodType<unknown>, path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const r = schema.safeParse(raw);
  if (!r.success) {
    console.error(`FAIL ${name}`, r.error.flatten());
    process.exitCode = 1;
    return;
  }
  console.log(`OK ${name}`);
}

validate("sample-document-ir", DocumentIRSchema, join(fixturesDir, "sample-document-ir.json"));
validate(
  "sample-ground-truth-draft",
  GroundTruthDraftSchema,
  join(fixturesDir, "sample-ground-truth-draft.json"),
);

if (process.exitCode === 1) {
  process.exit(1);
}
