import { expect, test, type Response } from "@playwright/test";

test("公开首页在本机 DATABASE 降级时不展示内部详情", async ({ page }) => {
  const [overviewResponse] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/overview")),
    page.goto("/"),
  ]);

  expect(overviewResponse.status()).toBe(503);
  expect(overviewResponse.headers()["cache-control"]).toBe("no-store");

  await expect(page).toHaveTitle("ENSO 市场影响监测");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("公开概览暂时无法加载。");
  await expect(alert).toContainText("页面不会展示不完整或未经发布的数据。");
  await expect(page.locator("body")).not.toContainText(/sqlite|select |insert |update |delete |miniflare|wrangler|stack|env\./i);
});

test("公开分类在本机 DATABASE 降级时保留导航和安全提示", async ({ page }) => {
  await page.goto("/");

  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toHaveAttribute("href", "#content");
  await skipLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();

  const navigation = page.getByRole("navigation", { name: "主要导航" });
  const rubberLink = navigation.getByRole("link", { name: "天然橡胶", exact: true });
  await expect(rubberLink).toHaveAttribute("href", "/rubber");

  const [categoryResponse] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/categories/rubber")),
    rubberLink.click(),
  ]);

  expect(categoryResponse.status()).toBe(503);
  expect(categoryResponse.headers()["cache-control"]).toBe("no-store");
  await expect(page).toHaveURL(/\/rubber$/);
  await expect(page).toHaveTitle("天然橡胶影响路径 | ENSO 市场影响监测");
  const categoryAlert = page.getByRole("alert");
  await expect(categoryAlert).toContainText("公开分类内容暂时无法加载。");
  await expect(categoryAlert).toContainText("页面只显示当前已发布的论点与公开变化，不会用草稿或内部运行信息填补空缺。");
  await expect(page.locator("body")).not.toContainText(/sqlite|select |insert |update |delete |miniflare|wrangler|stack|env\./i);
});

function isGetEndpoint(pathname: string): (response: Response) => boolean {
  return (response) => response.request().method() === "GET"
    && new URL(response.url()).pathname === pathname;
}
