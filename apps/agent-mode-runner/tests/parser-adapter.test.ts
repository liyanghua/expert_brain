import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { builtinMarkdownParserAdapter } from "../src/parsers/builtin-markdown-parser.js";
import {
  createDoclingParserAdapter,
  doclingMarkdownToDocumentIR,
  isDoclingAvailable,
} from "../src/parsers/docling-parser.js";
import { markedMarkdownParserAdapter } from "../src/parsers/marked-markdown-parser.js";

describe("parser adapters", () => {
  it("keeps the builtin markdown parser as the V1 baseline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-mode-parser-"));
    const inputPath = join(dir, "source.md");
    writeFileSync(inputPath, "# Title\n\nBody paragraph.\n\n## Child\n\nMore body.", "utf8");

    const result = await builtinMarkdownParserAdapter.parse({
      inputPath,
      docId: "doc",
      versionId: "v0",
    });

    assert.equal(result.diagnostics.parser_name, "builtin_markdown_parser");
    assert.equal(result.ir.blocks[0]?.block_type, "heading");
    assert.equal(result.ir.blocks[1]?.block_type, "paragraph");
    assert.equal(result.ir.blocks[2]?.parent_block_id, "b1");
    assert.ok(result.ir.blocks.every((block) => block.source_span?.startsWith("L")));
  });

  it("parses markdown tables, lists, code and blockquotes with the marked adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-mode-marked-parser-"));
    const inputPath = join(dir, "source.md");
    writeFileSync(
      inputPath,
      [
        "# Marked Source",
        "",
        "Intro paragraph.",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        "| CTR | low |",
        "",
        "- Check title",
        "- Check image",
        "",
        "> Expert note",
        "",
        "```",
        "code sample",
        "```",
      ].join("\n"),
      "utf8",
    );

    const result = await markedMarkdownParserAdapter.parse({
      inputPath,
      docId: "doc",
      versionId: "v0",
    });

    assert.equal(result.diagnostics.parser_name, "marked_markdown_parser");
    assert.equal(result.diagnostics.table_count, 1);
    assert.deepEqual(
      result.ir.blocks.map((block) => block.block_type),
      ["heading", "paragraph", "table", "list", "paragraph", "paragraph"],
    );
    assert.ok(result.ir.blocks.every((block) => block.source_span?.startsWith("L")));
  });

  it("skips markdown separator-only blocks during parsing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-mode-noise-parser-"));
    const inputPath = join(dir, "source.md");
    writeFileSync(
      inputPath,
      ["# Source", "", "第一段说明诊断目标。", "", "---", "", "第二段继续说明同一个判断。"].join("\n"),
      "utf8",
    );

    const result = await markedMarkdownParserAdapter.parse({
      inputPath,
      docId: "doc",
      versionId: "v0",
    });

    assert.equal(result.ir.blocks.some((block) => /^[-*_]{3,}$/.test(block.text_content.trim())), false);
    assert.deepEqual(
      result.ir.blocks.map((block) => block.text_content),
      ["Source", "第一段说明诊断目标。", "第二段继续说明同一个判断。"],
    );
    assert.equal((result.diagnostics as { ignored_block_count?: number }).ignored_block_count, 1);
  });

  it("maps Docling markdown into DocumentIR block types", () => {
    const ir = doclingMarkdownToDocumentIR({
      markdown: [
        "# Diagnosis",
        "",
        "Intro text.",
        "",
        "| Metric | Value |",
        "| --- | --- |",
        "| CTR | low |",
        "",
        "- Check title",
        "- Check image",
        "",
        "![hero](hero.png)",
      ].join("\n"),
      filename: "docling-output.md",
      docId: "doc",
      versionId: "v0",
    });

    assert.deepEqual(
      ir.blocks.map((block) => block.block_type),
      ["heading", "paragraph", "table", "list", "image"],
    );
    assert.equal(ir.blocks[2]?.source_span, "docling:block:3");
    assert.equal(ir.blocks[3]?.parent_block_id, "b1");
  });

  it("returns a clear Docling missing-tool error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-mode-docling-missing-"));
    const inputPath = join(dir, "source.md");
    writeFileSync(inputPath, "# Missing tool test", "utf8");
    const adapter = createDoclingParserAdapter({ command: "__missing_docling_for_test__" });

    await assert.rejects(
      () => adapter.parse({ inputPath, docId: "doc", versionId: "v0" }),
      /docling_not_installed/,
    );
    assert.equal(isDoclingAvailable("__missing_docling_for_test__"), false);
  });

  it("can run the Docling adapter with mocked markdown output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-mode-docling-mock-"));
    const inputPath = join(dir, "source.docx");
    writeFileSync(inputPath, "mock binary placeholder", "utf8");
    const adapter = createDoclingParserAdapter({
      mockMarkdown: "# Mock\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    });

    const result = await adapter.parse({ inputPath, docId: "doc", versionId: "v0" });

    assert.equal(result.diagnostics.parser_name, "docling");
    assert.equal(result.diagnostics.table_count, 1);
    assert.equal(result.diagnostics.raw_docling_output_path, "raw_docling_output.json");
    assert.ok(result.extraArtifacts?.raw_docling_output);
  });
});
