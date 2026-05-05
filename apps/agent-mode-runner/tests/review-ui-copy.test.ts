import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("review UI copy", () => {
  it("uses business-friendly default page wording", () => {
    const html = readFileSync(
      resolve(process.cwd(), "apps/agent-mode-runner/review-ui/index.html"),
      "utf8",
    );
    const forbiddenVisibleCopy = [
      "Agent Mode Runner",
      "Schema 检测",
      "当前 Block 主语义",
      "run artifacts",
      "Required",
      "Critical",
      "未分类",
      "查看系统调试指标",
      "${escapeHtml(metric.key)}",
      "metric.status ||",
      "alert(\"一键优化失败",
    ];

    for (const copy of forbiddenVisibleCopy) {
      assert.equal(html.includes(copy), false, `UI should not show engineering copy: ${copy}`);
    }
    assert.match(html, /这篇文档主要讲什么/);
    assert.match(html, /方法主线/);
    assert.match(html, /按文档要素导航/);
    assert.match(html, /相关语义单元/);
    assert.match(html, /关联原文片段/);
    assert.match(html, /只看待补强/);
    assert.match(html, /展开标签导航/);
    assert.match(html, /收起标签导航/);
    assert.match(html, /拖拽调整宽度/);
    assert.match(html, /initResizableLayout/);
    assert.match(html, /toggleNavigatorView/);
    assert.match(html, /fieldEvidenceGroups/);
    assert.match(html, /renderTagNavigator/);
    assert.match(html, /文档要素检查/);
    assert.match(html, /第一阶段评估/);
    assert.match(html, /查看详细评估依据/);
    assert.match(html, /已达标/);
    assert.match(html, /建议关注/);
    assert.match(html, /一键优化/);
    assert.match(html, /优化计划/);
    assert.match(html, /待处理事项/);
    assert.match(html, /语义段落/);
    assert.match(html, /语义单元/);
    assert.match(html, /同一语义单元/);
    assert.match(html, /这组段落共同支持的文档要素/);
    assert.match(html, /合并原因/);
    assert.match(html, /语义连贯性判断/);
    assert.match(html, /计划推理过程/);
    assert.match(html, /LLM 计划生成/);
    assert.match(html, /查看生成过程/);
    assert.match(html, /规则输入/);
    assert.match(html, /计划输出/);
    assert.match(html, /生成预览/);
    assert.match(html, /优化建议预览/);
    assert.match(html, /查看LLM调用/);
    assert.match(html, /系统提示词/);
    assert.match(html, /原始返回/);
  });
});
