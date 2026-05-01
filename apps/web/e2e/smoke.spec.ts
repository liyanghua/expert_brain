import { expect, test } from "@playwright/test";

test("home shows workspace chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Expert Brain Studio/);
  await expect(page.getByRole("button", { name: "新建文档" })).toBeVisible();
  await expect(page.getByText("质量优化 Agent")).toHaveCount(0);
  await expect(page.getByText("Focus Task")).toBeVisible();
  await expect(page.getByRole("button", { name: "QA" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Suggest" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rewrite" })).toHaveCount(0);
});
