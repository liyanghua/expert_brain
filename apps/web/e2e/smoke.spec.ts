import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const qualityTestDocId = "doc-quality-progress";
const blockDialogDocId = "doc-block-dialog";
const uploadTitleDocId = "doc-upload-title";

const sampleIr = {
  doc_id: qualityTestDocId,
  version_id: "v1",
  blocks: [
    {
      block_id: "b1",
      block_type: "heading",
      text_content: "质量检测测试文档",
      heading_level: 1,
      source_file: "quality.md",
      source_span: "L1",
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    },
  ],
};

async function mockQualityWorkspace(
  page: Page,
  releaseExtract: Promise<void>,
) {
  let extracted = false;
  const requests: { qa?: Record<string, unknown> } = {};
  const qualityIssueIndex = {
    doc_id: qualityTestDocId,
    version_id: "v1",
    generated_at: "2026-05-02T07:00:00.000Z",
    global_context_summary: "文档缺少判断标准。",
    issues: [
      {
        issue_id: "quality-issue-criteria",
        severity: "high",
        issue_type: "missing_judgment_criteria",
        summary: "缺少判断标准",
        why_it_matters: "需要补充判断正常或异常的口径，避免执行时断章取义。",
        primary_block_ids: ["b1"],
        supporting_block_ids: [],
        target_field: "judgment_criteria",
        recommended_question: "这里的异常判断标准是什么？",
        suggested_action: "补充阈值、例外和验证方式。",
        confidence: 0.82,
        grounding_reason: "质量诊断定位到 b1。",
      },
    ],
  };
  const qualityAnnotations = [
    {
      annotation_id: "quality-annotation-1",
      doc_id: qualityTestDocId,
      version_id: "v1",
      block_id: "b1",
      field_key: "judgment_criteria",
      content: "缺少判断标准",
      annotation_type: "quality_issue",
      issue_id: "quality-issue-criteria",
      severity: "high",
      issue_type: "missing_judgment_criteria",
      block_role: "primary",
      recommended_question: "这里的异常判断标准是什么？",
      thread_id: null,
      candidate_id: null,
      created_at: "2026-05-02T07:00:00.000Z",
      updated_at: "2026-05-02T07:00:00.000Z",
    },
  ];
  const qualityDraft = {
    ...blockDialogDraft,
    doc_id: qualityTestDocId,
    version_id: "v1",
    document_meta: {
      document_id: qualityTestDocId,
      version: "v1",
      source_files: ["quality.md"],
    },
  };
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ json: { doc_id: qualityTestDocId } });
  });
  await page.route(`**/api/documents/${qualityTestDocId}`, async (route) => {
    await route.fulfill({
      json: {
        doc_id: qualityTestDocId,
        title: "质量检测测试文档",
        document_status: "draft",
        current_version_id: "v1",
        audit: [],
      },
    });
  });
  await page.route(`**/api/documents/${qualityTestDocId}/ir`, async (route) => {
    await route.fulfill({ json: sampleIr });
  });
  await page.route(
    `**/api/documents/${qualityTestDocId}/extract`,
    async (route) => {
      await releaseExtract;
      extracted = true;
      await route.fulfill({
        json: {
          draft: qualityDraft,
          quality_triage_mode: "rules",
          quality_issue_index: qualityIssueIndex,
          global_quality_triage: {
            recommended_tasks: [
              {
                title: "补充执行步骤",
                reason: "缺少操作细节。",
                question: "具体怎么执行？",
                target_field: "execution_steps",
                source_block_ids: ["b1"],
                priority: "high",
              },
              {
                title: "补充判断依据",
                reason: "缺少指标依据。",
                question: "看哪些指标？",
                target_field: "judgment_basis",
                source_block_ids: ["b1"],
                priority: "medium",
              },
              {
                title: "补充判断标准",
                reason: "缺少判定口径。",
                question: "怎么判断正常异常？",
                target_field: "judgment_criteria",
                source_block_ids: ["b1"],
                priority: "medium",
              },
              {
                title: "补充工具表单",
                reason: "缺少可用表单。",
                question: "用什么表单？",
                target_field: "tool_templates",
                source_block_ids: ["b1"],
                priority: "low",
              },
            ],
          },
        },
      });
    },
  );
  await page.route(`**/api/documents/${qualityTestDocId}/draft`, async (route) => {
    await route.fulfill({ json: extracted ? qualityDraft : null });
  });
  await page.route(
    `**/api/documents/${qualityTestDocId}/scorecard`,
    async (route) => {
      await route.fulfill({
        json: {
          mode: "rules",
          scores: {},
          threshold_check: {},
          metric_definitions: {},
          overall_status: extracted ? "needs_work" : "pending",
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${qualityTestDocId}/improvement-plan`,
    async (route) => {
      await route.fulfill({
        json: {
          priority_actions: extracted
            ? [
                {
                  metric: "judgment_criteria",
                  metric_display_name: "判断标准",
                  reason: "缺少判定口径。",
                  actions: ["补充阈值和例外"],
                  actions_display: ["补充阈值和例外"],
                },
              ]
            : [],
          candidate_questions: [],
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${qualityTestDocId}/publish-readiness`,
    async (route) => {
      await route.fulfill({
        json: {
          readiness_status: "not_ready",
          blocking_issues: [],
          completeness_summary: {},
          review_summary: "",
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${qualityTestDocId}/versions`,
    async (route) => {
      await route.fulfill({ json: { versions: [] } });
    },
  );
  await page.route(
    `**/api/documents/${qualityTestDocId}/threads`,
    async (route) => {
      await route.fulfill({ json: { threads: [] } });
    },
  );
  await page.route(
    `**/api/documents/${qualityTestDocId}/gt-candidates`,
    async (route) => {
      await route.fulfill({ json: { candidates: [] } });
    },
  );
  await page.route(`**/api/documents/${qualityTestDocId}/notes`, async (route) => {
    await route.fulfill({ json: { notes: [] } });
  });
  await page.route(
    `**/api/documents/${qualityTestDocId}/source-annotations`,
    async (route) => {
      await route.fulfill({
        json: { annotations: extracted ? qualityAnnotations : [] },
      });
    },
  );
  await page.route(
    `**/api/documents/${qualityTestDocId}/quality-annotations`,
    async (route) => {
      await route.fulfill({
        json: {
          issue_index: extracted
            ? qualityIssueIndex
            : {
                doc_id: qualityTestDocId,
                version_id: "v1",
                generated_at: "1970-01-01T00:00:00.000Z",
                issues: [],
              },
          annotations: extracted ? qualityAnnotations : [],
        },
      });
    },
  );
  await page.route(`**/api/documents/${qualityTestDocId}/qa`, async (route) => {
    requests.qa = (await route.request().postDataJSON()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        refined_question: "这里的异常判断标准是什么？",
        direct_answer: "需要补充正常、异常和例外场景的判断口径。",
        rationale: "引用 b1。",
        source_block_refs: ["b1"],
        target_field: "judgment_criteria",
        suggested_writeback: null,
        thread_id: "quality-thread-1",
        gt_candidate: null,
      },
    });
  });
  return requests;
}

async function mockUploadTitleWorkspace(page: Page) {
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ json: { doc_id: uploadTitleDocId } });
  });
  await page.route(`**/api/documents/${uploadTitleDocId}`, async (route) => {
    await route.fulfill({
      json: {
        doc_id: uploadTitleDocId,
        title: "未命名来源",
        document_status: "draft",
        current_version_id: "v1",
        audit: [],
      },
    });
  });
  await page.route(`**/api/documents/${uploadTitleDocId}/ir`, async (route) => {
    await route.fulfill({ status: 404, json: { error: "not ready" } });
  });
  await page.route(`**/api/documents/${uploadTitleDocId}/draft`, async (route) => {
    await route.fulfill({ json: null });
  });
  await page.route(
    `**/api/documents/${uploadTitleDocId}/publish-readiness`,
    async (route) => {
      await route.fulfill({ status: 400, json: { error: "no draft" } });
    },
  );
  await page.route(`**/api/documents/${uploadTitleDocId}/versions`, async (route) => {
    await route.fulfill({ json: { versions: [] } });
  });
  await page.route(`**/api/documents/${uploadTitleDocId}/threads`, async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route(
    `**/api/documents/${uploadTitleDocId}/gt-candidates`,
    async (route) => {
      await route.fulfill({ json: { candidates: [] } });
    },
  );
  await page.route(`**/api/documents/${uploadTitleDocId}/notes`, async (route) => {
    await route.fulfill({ json: { notes: [] } });
  });
  await page.route(
    `**/api/documents/${uploadTitleDocId}/source-annotations`,
    async (route) => {
      await route.fulfill({ json: { annotations: [] } });
    },
  );
  await page.route(
    `**/api/documents/${uploadTitleDocId}/quality-annotations`,
    async (route) => {
      await route.fulfill({
        json: {
          issue_index: {
            doc_id: uploadTitleDocId,
            version_id: "v1",
            generated_at: "1970-01-01T00:00:00.000Z",
            issues: [],
          },
          annotations: [],
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${uploadTitleDocId}/sources`,
    async (route) => {
      await route.fulfill({
        json: {
          doc_id: uploadTitleDocId,
          title: "商品诊断流程.xlsx",
          document_status: "draft",
          current_version_id: "v1",
          sources: [
            {
              file_id: "file-1",
              filename: "商品诊断流程.xlsx",
              stored_path: "/tmp/source.xlsx",
            },
          ],
          audit: [],
          job_id: "job-1",
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${uploadTitleDocId}/jobs/process-next`,
    async (route) => {
      await route.fulfill({ json: { ok: true } });
    },
  );
}

const blockDialogIr = {
  doc_id: blockDialogDocId,
  version_id: "v1",
  blocks: Array.from({ length: 7 }, (_, index) => {
    const blockNumber = index + 1;
    return {
      block_id: `b${blockNumber}`,
      block_type: blockNumber === 6 ? "table" : "paragraph",
      text_content:
        blockNumber === 4
          ? "Block 4: 商品点击率下降，需要判断是流量问题还是转化问题。"
          : blockNumber === 6
            ? "| 指标 | 当前值 | 判断 |\n| --- | --- | --- |\n| 点击率 | 下降 | 需要排查入口吸引力 |"
          : `Block ${blockNumber}: 上下文段落 ${blockNumber}`,
      heading_level: 0,
      source_file: "block-dialog.md",
      source_span: `L${blockNumber}`,
      page_no: null,
      sheet_name: null,
      node_path: null,
      attachment_refs: [],
      parent_block_id: null,
      children_block_ids: [],
    };
  }),
};

const blockDialogDraft = {
  schema_name: "BusinessDocStructuredDraft",
  schema_version: "v1",
  doc_id: blockDialogDocId,
  version_id: "v1",
  document_meta: {
    document_id: blockDialogDocId,
    version: "v1",
    source_files: [],
  },
  required_inputs: [],
  deliverables: [],
  thinking_framework: [],
  execution_steps: [],
  execution_actions: [],
  key_node_rationales: [],
  page_screenshots: [],
  faq_types: [],
  judgment_basis: [
    {
      text: "点击率下降可作为判断依据之一。",
      source_refs: [{ block_id: "b1" }],
    },
  ],
  judgment_criteria: [],
  resolution_methods: [],
  trigger_conditions: [],
  termination_conditions: [],
  validation_methods: [],
  tool_templates: [],
  exceptions_and_non_applicable_scope: [],
  gaps_structured: {
    missing_fields: [],
    weak_fields: [],
    inferred_fields: [],
    needs_confirmation_fields: [],
  },
  gaps: [],
  confidence_by_field: {},
  source_refs: {},
};

async function mockBlockDialogWorkspace(page: Page) {
  const now = "2026-05-01T14:40:00.000Z";
  let qaCompleted = false;
  let candidateConfirmed = false;
  let annotations: {
    annotation_id: string;
    doc_id: string;
    version_id: string;
    block_id: string;
    field_key: string;
    content: string;
    thread_id: string;
    candidate_id: string;
    created_at: string;
    updated_at: string;
  }[] = [];
  const requests: {
    refine?: Record<string, unknown>;
    qa?: Record<string, unknown>;
  } = {};
  const candidate = {
    candidate_id: "candidate-1",
    thread_id: "thread-1",
    doc_id: blockDialogDocId,
    version_id: "v1",
    field_key: "judgment_basis",
    content: { text: "点击率下降且转化率持平时，优先判断为流量质量或入口吸引力问题。" },
    source_refs: [{ block_id: "b4" }],
    status: "draft",
    recommended_mode: "append",
    created_from_step_id: null,
    rationale: "基于选中 block 和专家输入生成。",
    created_at: now,
    updated_at: now,
  };
  const confirmedCandidate = { ...candidate, status: "confirmed", updated_at: now };
  const thread = {
    thread_id: "thread-1",
    doc_id: blockDialogDocId,
    version_id: "v1",
    task_id: "task-1",
    field_key: "judgment_basis",
    status: "active",
    title: "回答judgment_basis",
    source_block_ids: ["b2", "b3", "b4", "b5", "b6"],
    recommended_question: "请说明点击率下降时如何判断问题归因？",
    created_at: now,
    latest_step_at: now,
    steps: [
      {
        step_id: "step-question",
        thread_id: "thread-1",
        type: "question_sent",
        timestamp: now,
        payload: {
          question: "请说明点击率下降时如何判断问题归因？",
          question_seed: "请说明点击率下降时如何判断问题归因？",
        },
      },
      {
        step_id: "step-answer",
        thread_id: "thread-1",
        type: "agent_answered",
        timestamp: now,
        payload: {
          answer: "可先比较点击率和转化率：点击率下降但转化率持平时，优先排查流量质量或入口吸引力。",
          rationale: "引用 b1。",
          source_block_refs: ["b4"],
          target_field: "judgment_basis",
        },
      },
      {
        step_id: "step-candidate",
        thread_id: "thread-1",
        type: "gt_candidate_created",
        timestamp: now,
        payload: {
          candidate_id: "candidate-1",
          field_key: "judgment_basis",
        },
      },
    ],
  };

  await page.route("**/api/documents", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ json: { doc_id: blockDialogDocId } });
  });
  await page.route(`**/api/documents/${blockDialogDocId}`, async (route) => {
    await route.fulfill({
      json: {
        doc_id: blockDialogDocId,
        title: "Block 对话测试文档",
        document_status: "draft",
        current_version_id: "v1",
        audit: [],
      },
    });
  });
  await page.route(`**/api/documents/${blockDialogDocId}/ir`, async (route) => {
    await route.fulfill({ json: blockDialogIr });
  });
  await page.route(`**/api/documents/${blockDialogDocId}/draft`, async (route) => {
    await route.fulfill({ json: blockDialogDraft });
  });
  await page.route(`**/api/documents/${blockDialogDocId}/scorecard`, async (route) => {
    await route.fulfill({
      json: {
        document_id: blockDialogDocId,
        version_id: "v1",
        mode: "heuristic",
        scores: {},
        threshold_check: {},
        metric_definitions: {},
        overall_status: "needs_improvement",
      },
    });
  });
  await page.route(
    `**/api/documents/${blockDialogDocId}/improvement-plan`,
    async (route) => {
      await route.fulfill({
        json: {
          document_id: blockDialogDocId,
          version_id: "v1",
          priority_actions: [],
          candidate_questions: [],
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${blockDialogDocId}/publish-readiness`,
    async (route) => {
      await route.fulfill({
        json: {
          readiness_status: "not_ready",
          blocking_issues: [],
          completeness_summary: {},
          review_summary: "",
        },
      });
    },
  );
  await page.route(`**/api/documents/${blockDialogDocId}/versions`, async (route) => {
    await route.fulfill({ json: { versions: [] } });
  });
  await page.route(`**/api/documents/${blockDialogDocId}/threads`, async (route) => {
    await route.fulfill({ json: { threads: qaCompleted ? [thread] : [] } });
  });
  await page.route(
    `**/api/documents/${blockDialogDocId}/gt-candidates`,
    async (route) => {
      await route.fulfill({
        json: {
          candidates: qaCompleted
            ? [candidateConfirmed ? confirmedCandidate : candidate]
            : [],
        },
      });
    },
  );
  await page.route(`**/api/documents/${blockDialogDocId}/notes`, async (route) => {
    await route.fulfill({ json: { notes: [] } });
  });
  await page.route(
    `**/api/documents/${blockDialogDocId}/source-annotations`,
    async (route) => {
      await route.fulfill({ json: { annotations } });
    },
  );
  await page.route(
    `**/api/documents/${blockDialogDocId}/quality-annotations`,
    async (route) => {
      await route.fulfill({
        json: {
          issue_index: {
            doc_id: blockDialogDocId,
            version_id: "v1",
            generated_at: "1970-01-01T00:00:00.000Z",
            issues: [],
          },
          annotations: [],
        },
      });
    },
  );
  await page.route(
    `**/api/documents/${blockDialogDocId}/qa/refine-question`,
    async (route) => {
      requests.refine = (await route.request().postDataJSON()) as Record<
        string,
        unknown
      >;
      await route.fulfill({
        json: {
          refined_question: "请说明点击率下降时如何判断问题归因？",
          context_summary: "商品点击率下降，需要判断问题归因。",
          source_block_refs: ["b4"],
          rationale: "结合专家输入和选中 block 改写。",
          thread_id: "thread-1",
        },
      });
    },
  );
  await page.route(`**/api/documents/${blockDialogDocId}/qa`, async (route) => {
    requests.qa = (await route.request().postDataJSON()) as Record<string, unknown>;
    qaCompleted = true;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({
      json: {
        refined_question: "请说明点击率下降时如何判断问题归因？",
        direct_answer:
          "可先比较点击率和转化率：点击率下降但转化率持平时，优先排查流量质量或入口吸引力。",
        rationale: "引用 b1。",
          source_block_refs: ["b4"],
        target_field: "judgment_basis",
        suggested_writeback: {
          field_key: "judgment_basis",
          content: candidate.content,
        },
        thread_id: "thread-1",
        gt_candidate: candidate,
      },
    });
  });
  await page.route(
    `**/api/documents/${blockDialogDocId}/gt-candidates/candidate-1/confirm`,
    async (route) => {
      candidateConfirmed = true;
      annotations = [
        {
          annotation_id: "annotation-1",
          doc_id: blockDialogDocId,
          version_id: "v1",
          block_id: "b4",
          field_key: "judgment_basis",
          content:
            "点击率下降且转化率持平时，优先判断为流量质量或入口吸引力问题。",
          thread_id: "thread-1",
          candidate_id: "candidate-1",
          created_at: now,
          updated_at: now,
        },
      ];
      await route.fulfill({
        json: {
          candidate: confirmedCandidate,
          draft: {
            ...blockDialogDraft,
            judgment_basis: [
              {
                text: "点击率下降且转化率持平时，优先判断为流量质量或入口吸引力问题。",
                source_refs: [{ block_id: "b4" }],
              },
            ],
          },
          source_annotations: annotations,
        },
      });
    },
  );
  return requests;
}

test("home shows workspace chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Expert Brain Studio/);
  await expect(page.getByRole("button", { name: "添加来源" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建文档" })).toHaveCount(0);
  await expect(page.getByText("质量优化 Agent")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "质量检测" })).toBeVisible();
  await expect(page.getByRole("button", { name: "结构化抽取" })).toHaveCount(0);
  await expect(page.getByText("当前处理任务")).toHaveCount(0);
  const workbench = page.locator(".workbench-bar");
  await expect(workbench).toContainText("当前上下文");
  const paneResizer = page.getByRole("separator", { name: "调整左右栏宽度" });
  await expect(paneResizer).toBeVisible();
  await paneResizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(paneResizer).toHaveAttribute("aria-valuenow", "55");
  await expect(page.getByRole("separator", { name: "调整底栏高度" })).toHaveCount(
    0,
  );
  await expect(page.locator(".studio-drawer")).toHaveCount(0);
  await page.getByRole("button", { name: "Studio" }).click();
  const studioDrawer = page.locator(".studio-drawer");
  await expect(studioDrawer).toBeVisible();
  await expect(studioDrawer).toContainText("待确认建议");
  await studioDrawer.getByRole("button", { name: "版本 Diff" }).click();
  await expect(studioDrawer).toContainText("当前版本");
  await studioDrawer.getByRole("button", { name: "结构字段变化" }).click();
  await expect(studioDrawer.locator("pre")).toContainText("—");
  await studioDrawer.getByRole("button", { name: "任务与问题" }).click();
  await expect(studioDrawer).toContainText("状态");
  await studioDrawer.getByRole("button", { name: "操作日志" }).click();
  await expect(studioDrawer).toContainText("操作日志");
  await studioDrawer.getByRole("button", { name: "LLM DEBUG" }).click();
  await expect(studioDrawer).toContainText("还没有可查看的 LLM 调用");
  await studioDrawer.getByRole("button", { name: "关闭" }).click();
  await expect(page.locator(".studio-drawer")).toHaveCount(0);
  await expect(workbench.getByRole("button", { name: "生成追问草稿" })).toHaveCount(0);
  await workbench.getByRole("button", { name: "展开", exact: true }).click();
  await expect(workbench.getByRole("button", { name: "生成追问草稿" })).toHaveCount(0);
  await expect(workbench.getByRole("button", { name: "查看任务队列" })).toHaveCount(0);
  await workbench.getByRole("button", { name: "收起", exact: true }).click();
  await expect(workbench.getByRole("button", { name: "生成追问草稿" })).toHaveCount(0);
  await expect(page.getByText("追问改写 Agent 正在生成问题草稿")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "GroundTruth" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quality" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transform" })).toHaveCount(0);
  await expect(
    page.getByText("选择一个缺口、字段或原文证据后，Agent 会在这里生成追问、回答和可确认的补充内容。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "QA" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suggest" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rewrite" })).toHaveCount(0);
});

test("upload replaces placeholder title with source filename", async ({ page }) => {
  await mockUploadTitleWorkspace(page);

  await page.goto("/");
  await page.getByRole("button", { name: "添加来源" }).click();
  await expect(page.locator(".topbar")).toContainText("未命名来源");

  await page.locator('input[type="file"]').setInputFiles({
    name: "商品诊断流程.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fake spreadsheet"),
  });

  await expect(page.locator(".topbar")).toContainText("商品诊断流程.xlsx");
});

test("quality progress title transitions from running to completed", async ({
  page,
}) => {
  let finishExtract: () => void = () => {};
  const releaseExtract = new Promise<void>((resolve) => {
    finishExtract = resolve;
  });
  const requests = await mockQualityWorkspace(page, releaseExtract);

  await page.goto("/");
  await page.getByRole("button", { name: "添加来源" }).click();
  await expect(page.locator(".topbar")).toContainText("质量检测测试文档");
  const qualityButton = page.getByRole("button", {
    name: "质量检测",
    exact: true,
  });
  await expect(qualityButton).toBeEnabled();

  await qualityButton.click();
  const progressTitle = page.locator(".quality-timeline-panel strong");
  await expect(progressTitle).toHaveText("文档审阅助手正在梳理结构");

  finishExtract();
  await expect(progressTitle).toHaveText("文档审阅助手已整理任务");
  const qualityAnnotatedBlock = page
    .locator(".source-block.has-quality-issue")
    .filter({ hasText: "质量检测测试文档" });
  await expect(qualityAnnotatedBlock).toContainText("质量提示");
  await expect(qualityAnnotatedBlock).toContainText("缺少判断标准");
  await qualityAnnotatedBlock.getByRole("button", { name: "带问题提问" }).click();
  await expect(page.locator(".composer-input-shell")).toContainText(
    "当前问题：缺少判断标准",
  );
  await page.getByRole("button", { name: "带上下文提问", exact: true }).click();
  await expect.poll(() => requests.qa?.qa_source).toBe("quality_issue");
  await expect.poll(() => requests.qa?.evidence_block_ids).toEqual(["b1"]);
  await expect(page.locator(".quality-task-chips .task-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "对照" }).click();
  await expect(page.locator(".recommended-task-row")).toHaveCount(3);
});

test("selected block uses inline local context and direct QA candidate flow", async ({
  page,
}) => {
  const requests = await mockBlockDialogWorkspace(page);

  await page.goto("/");
  await page.getByRole("button", { name: "添加来源" }).click();
  await expect(page.locator(".topbar")).toContainText("Block 对话测试文档");
  await expect(page.locator(".source-reader")).toBeVisible();
  await expect(page.locator(".source-reader-header")).toContainText("来源阅读器");
  await expect(page.locator(".source-outline")).toHaveCount(0);
  await expect(page.getByText("文档目录")).toHaveCount(0);
  await page.locator(".source-block").filter({ hasText: "Block 1:" }).click();
  await expect(page.locator(".source-selection-card")).toContainText("已选原文片段");
  await expect(page.locator(".source-selection-card")).not.toContainText("相邻上下文");
  await expect(page.locator(".source-selection-card")).not.toContainText("查看关联字段");
  await expect(page.locator(".source-selection-card").getByRole("button")).toHaveText(
    "加入对话",
  );
  await expect(page.locator(".source-block.is-selected")).toContainText("Block 1:");
  await expect(page.locator(".source-block.is-mapped")).toContainText("Block 1:");
  await expect(page.locator(".source-block.in-context")).toHaveCount(0);
  await expect(page.locator(".composer-input-shell")).not.toContainText(
    "已加入对话上下文",
  );
  const workbench = page.locator(".workbench-bar");
  await workbench.getByRole("button", { name: "展开", exact: true }).click();
  await expect(
    workbench.getByRole("button", { name: "生成追问草稿" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "加入对话", exact: true }).click();
  await expect(
    page.locator(".source-block.in-context").filter({ hasText: "Block 1:" }),
  ).toHaveCount(1);

  await page.locator(".source-block").filter({ hasText: "Block 4:" }).click();
  await expect(page.locator(".source-selection-card")).not.toContainText("相邻证据");
  await page.getByRole("button", { name: "加入对话", exact: true }).click();
  await expect(
    page.locator(".source-block.in-context").filter({ hasText: "Block 4:" }),
  ).toHaveCount(1);
  await expect(page.locator(".source-block.in-context")).toHaveCount(1);

  await expect(page.locator(".composer-context-card")).toHaveCount(0);
  const composerShell = page.locator(".composer-input-shell");
  await expect(composerShell).toContainText(
    "已加入对话上下文",
  );
  await expect(composerShell.locator(".composer-inline-context")).toContainText(
    "paragraph: Block 4",
  );
  await expect(composerShell.locator(".composer-inline-context")).not.toContainText(
    "Block 2",
  );
  await expect(composerShell.locator(".composer-inline-context")).not.toContainText(
    "Block 3",
  );
  await expect(composerShell.locator(".composer-inline-context")).not.toContainText(
    "Block 5",
  );
  await expect(composerShell.locator(".composer-inline-context")).not.toContainText(
    "点击率 | 下降",
  );
  await expect(
    page.locator(".source-block").filter({ hasText: "入口吸引力" }).locator("table"),
  ).toBeVisible();
  await expect(composerShell.locator(".chat-input")).toBeFocused();
  expect(requests.refine).toBeUndefined();
  expect(requests.qa).toBeUndefined();

  await page.locator(".chat-input").fill("请基于当前 block 生成判断依据");
  await page.getByRole("button", { name: "带上下文提问", exact: true }).click();
  await expect(
    page.getByText("QA Agent 正在回答，并生成候选内容用于更新知识库..."),
  ).toBeVisible();

  await expect
    .poll(() => requests.qa?.evidence_block_ids)
    .toEqual(["b2", "b3", "b4", "b5", "b6"]);
  expect(requests.refine).toBeUndefined();

  const candidateCard = page
    .locator(".gt-candidate-card")
    .filter({ hasText: "判断依据" });
  await expect(candidateCard).toContainText("点击率下降且转化率持平");
  await candidateCard.getByRole("button", { name: "确认写入" }).click();
  await expect(candidateCard).toContainText("已写入");
  await expect(
    page.locator(".source-block").filter({ hasText: "Block 4:" }),
  ).toContainText("专家补充");
  await expect(
    page.locator(".source-block").filter({ hasText: "Block 4:" }),
  ).toContainText("入口吸引力问题");
});
