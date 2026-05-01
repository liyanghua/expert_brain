import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const qualityTestDocId = "doc-quality-progress";
const blockDialogDocId = "doc-block-dialog";

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
      await route.fulfill({
        json: {
          draft: null,
          quality_triage_mode: "rules",
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
    await route.fulfill({ json: null });
  });
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
}

const blockDialogIr = {
  doc_id: blockDialogDocId,
  version_id: "v1",
  blocks: Array.from({ length: 7 }, (_, index) => {
    const blockNumber = index + 1;
    return {
      block_id: `b${blockNumber}`,
      block_type: "paragraph",
      text_content:
        blockNumber === 4
          ? "Block 4: 商品点击率下降，需要判断是流量问题还是转化问题。"
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
  judgment_basis: [],
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
        },
      });
    },
  );
  return requests;
}

test("home shows workspace chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Expert Brain Studio/);
  await expect(page.getByRole("button", { name: "新建文档" })).toBeVisible();
  await expect(page.getByText("质量优化 Agent")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "质量检测" })).toBeVisible();
  await expect(page.getByRole("button", { name: "结构化抽取" })).toHaveCount(0);
  await expect(page.getByText("当前处理任务")).toHaveCount(0);
  await expect(page.getByText("任务工作台")).toBeVisible();
  const paneResizer = page.getByRole("separator", { name: "调整左右栏宽度" });
  await expect(paneResizer).toBeVisible();
  await paneResizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(paneResizer).toHaveAttribute("aria-valuenow", "55");
  const drawerResizer = page.getByRole("separator", { name: "调整底栏高度" });
  await expect(drawerResizer).toBeVisible();
  await drawerResizer.focus();
  await page.keyboard.press("ArrowUp");
  await expect(drawerResizer).toHaveAttribute("aria-valuenow", "264");
  await expect(page.getByRole("button", { name: "生成追问草稿" })).toBeVisible();
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

test("quality progress title transitions from running to completed", async ({
  page,
}) => {
  let finishExtract: () => void = () => {};
  const releaseExtract = new Promise<void>((resolve) => {
    finishExtract = resolve;
  });
  await mockQualityWorkspace(page, releaseExtract);

  await page.goto("/");
  await page.getByRole("button", { name: "新建文档" }).click();
  const qualityButton = page.getByRole("button", {
    name: "质量检测",
    exact: true,
  });
  await expect(qualityButton).toBeEnabled();

  await qualityButton.click();
  const progressTitle = page.locator(".quality-timeline-panel strong");
  await expect(progressTitle).toHaveText("质量检测进行中");

  finishExtract();
  await expect(progressTitle).toHaveText("质量检测完成");
  await expect(page.locator(".quality-task-chips .task-chip")).toHaveCount(3);
  await expect(page.getByText("还有 1 个待优化项已收起")).toBeVisible();
});

test("selected block uses inline local context and direct QA candidate flow", async ({
  page,
}) => {
  const requests = await mockBlockDialogWorkspace(page);

  await page.goto("/");
  await page.getByRole("button", { name: "新建文档" }).click();
  await page.locator(".block").filter({ hasText: "Block 1:" }).click();
  await page.getByRole("button", { name: "添加到对话", exact: true }).click();

  await page.locator(".block").filter({ hasText: "Block 4:" }).click();
  await page.getByRole("button", { name: "添加到对话", exact: true }).click();

  await expect(page.locator(".composer-context-card")).toHaveCount(0);
  const composerShell = page.locator(".composer-input-shell");
  await expect(composerShell).toContainText(
    "已加入对话上下文",
  );
  await expect(composerShell.locator(".composer-inline-context")).toContainText(
    "paragraph: Block 4",
  );
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
});
