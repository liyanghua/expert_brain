import { expect, test } from "@playwright/test";

test("home shows workspace chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Expert Brain Studio/);
  await expect(page.getByRole("button", { name: "新建文档" })).toBeVisible();
  await expect(page.getByText("质量优化 Agent")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "质量检测" })).toBeVisible();
  await expect(page.getByRole("button", { name: "结构化抽取" })).toHaveCount(0);
  await expect(page.getByText("Focus Task")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成追问草稿" })).toBeVisible();
  await expect(page.getByText("追问改写 Agent 正在生成问题草稿")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "GroundTruth" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quality" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Transform" })).toBeVisible();
  await expect(page.getByText("QA 回答后会在这里形成可确认的 GT 候选。")).toBeVisible();
  await expect(page.getByRole("button", { name: "QA" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suggest" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rewrite" })).toHaveCount(0);
});
