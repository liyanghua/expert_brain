import { describe, expect, it } from "vitest";
import type { DocumentIR } from "@ebs/document-ir";
import { emptyGroundTruthDraft } from "@ebs/ground-truth-schema";
import {
  buildDocumentIndex,
  createTopTasks,
  probePriorityFields,
} from "./task-planner.js";

function createIr(texts: Array<{ id: string; type?: string; text: string }>): DocumentIR {
  return {
    doc_id: "doc-1",
    version_id: "v1",
    blocks: texts.map((item, index) => ({
      block_id: item.id,
      block_type: item.type ?? "paragraph",
      text_content: item.text,
      heading_level: 0,
      source_file: "doc.md",
      source_span: `L${index + 1}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    })),
  };
}

describe("task planner", () => {
  it("prioritizes core fields and only returns top three tasks", () => {
    const ir = createIr([
      {
        id: "b1",
        text: "本 SOP 的目标是处理异常订单，需要在后台确认订单状态。",
      },
      {
        id: "b2",
        text: "开始时先打开后台页面，然后搜索订单号，进入订单详情页，最后点击提交。",
      },
      {
        id: "b3",
        text: "如果金额大于 1000 且收货地址异常，则需要人工二次核验。",
      },
    ]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");

    const index = buildDocumentIndex(ir);
    const probes = probePriorityFields({ ir, draft, index });
    const tasks = createTopTasks({ probes, limit: 3 });

    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.fieldKey)).toEqual([
      "tool_templates",
      "judgment_criteria",
      "judgment_basis",
    ]);
    expect(tasks[0]?.status).toBe("missing");
  });

  it("marks a field as covered when retrieval finds strong supporting evidence", () => {
    const ir = createIr([
      {
        id: "b1",
        text: "执行步骤：1. 打开系统 2. 输入工单号 3. 核对结果 4. 点击确认。",
      },
      {
        id: "b2",
        text: "判断依据包括订单状态、风控标记、用户备注与收货信息。",
      },
      {
        id: "b3",
        text: "判断标准：若风控标记存在且备注为空，则判定为高风险，需要升级处理。",
      },
      {
        id: "b4",
        text: "使用《异常订单核查表》模板记录处理结果。",
      },
    ]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");

    const index = buildDocumentIndex(ir);
    const probes = probePriorityFields({ ir, draft, index });

    expect(probes.find((probe) => probe.fieldKey === "execution_steps")?.status).toBe(
      "covered",
    );
    expect(probes.find((probe) => probe.fieldKey === "tool_templates")?.evidence.length).toBeGreaterThan(
      0,
    );
  });

  it("deduplicates multiple weak hits for the same field into one task", () => {
    const ir = createIr([
      {
        id: "b1",
        text: "需要查看后台页面上的若干标签信息，结合地址和金额做人审。",
      },
      {
        id: "b2",
        text: "判断时需要参考异常标签、地址模式和退款原因，但未给出标准。",
      },
      {
        id: "b3",
        text: "再次强调需要经验判断，没有明确规则。",
      },
    ]);
    const draft = emptyGroundTruthDraft("doc-1", "v1");

    const index = buildDocumentIndex(ir);
    const probes = probePriorityFields({ ir, draft, index });
    const tasks = createTopTasks({ probes, limit: 5 });

    const basisTasks = tasks.filter((task) => task.fieldKey === "judgment_basis");
    expect(basisTasks).toHaveLength(1);
  });
});
