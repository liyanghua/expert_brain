import { expect, test } from "@playwright/test";

test("home shows workspace chrome", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Expert Brain Studio/);
  await expect(page.getByRole("button", { name: "新建文档" })).toBeVisible();
  await expect(page.getByText("质量优化 Agent")).toBeVisible();
  await expect(page.getByRole("button", { name: "展开" })).toBeVisible();
});
