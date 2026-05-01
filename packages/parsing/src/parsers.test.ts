import { describe, expect, it } from "vitest";
import { parseMarkdownToBlocks } from "./parsers.js";

describe("parseMarkdownToBlocks", () => {
  it("extracts heading and paragraph", () => {
    const md = "# Title\n\nBody line.";
    const blocks = parseMarkdownToBlocks(md, "t.md");
    expect(blocks.some((b) => b.block_type === "heading")).toBe(true);
    expect(blocks.some((b) => b.text_content.includes("Body"))).toBe(true);
  });

  it("recognizes bold section titles as headings and assigns hierarchy", () => {
    const md = [
      "天猫店铺运营操盘手视角｜商品诊断全体系",
      "",
      "**一、商品诊断核心定位（操盘手底层认知）**",
      "",
      "诊断不是看数据，是“问题→方案→任务→增长”",
      "",
      "**新品期（定生死）**",
      "",
      "核心目标：验证定位、跑通流量、达标基础转化",
    ].join("\n");

    const blocks = parseMarkdownToBlocks(md, "doc.docx");
    const headings = blocks.filter((b) => b.block_type === "heading");
    const phase = headings.find((b) => b.text_content.includes("新品期"));
    const phaseBody = blocks.find((b) => b.text_content.startsWith("核心目标"));

    expect(headings.map((b) => b.text_content)).toEqual([
      "天猫店铺运营操盘手视角｜商品诊断全体系",
      "一、商品诊断核心定位（操盘手底层认知）",
      "新品期（定生死）",
    ]);
    expect(phase?.heading_level).toBe(2);
    expect(phaseBody?.parent_block_id).toBe(phase?.block_id);
    expect(phase?.children_block_ids).toContain(phaseBody?.block_id);
  });

  it("merges consecutive markdown table rows into one table block", () => {
    const md = [
      "| 维度 | 内容 |",
      "| --- | --- |",
      "| 场景目标 | 定位问题、输出方案 |",
      "| 输出成果 | 诊断报告、任务清单 |",
      "",
      "表后说明",
    ].join("\n");

    const blocks = parseMarkdownToBlocks(md, "doc.docx");
    const tables = blocks.filter((b) => b.block_type === "table");

    expect(tables).toHaveLength(1);
    expect(tables[0]?.text_content).toContain("场景目标");
    expect(tables[0]?.text_content.split("\n")).toHaveLength(4);
    expect(tables[0]?.source_span).toBe("L1-L4");
  });
});
