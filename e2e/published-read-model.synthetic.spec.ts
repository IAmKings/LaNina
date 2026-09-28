import { expect, test, type Page, type Response, type Route } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import type { ApiEnvelope, ApiMeta } from "../src/domain/contracts";
import type { ChangesPageModel } from "../src/domain/page-models";
import { PAGE_MODEL_FIXTURES } from "../src/domain/page-models.fixtures";
import {
  assertNoNewAxeViolations,
  isAxeCaptureMode,
  loadAxeBaseline,
  printCapturedAxeBaseline,
  recordAxeViolationsForCapture,
} from "./axe-support";

// These are deterministic browser fixtures, not observations, market research, a real published thesis,
// or deployed data. They exercise UI branches labelled "published" without proving publication happened.
// Keep the API boundary realistic: public pages only receive an ApiEnvelope from their same-origin route.
const SYNTHETIC_API_META: ApiMeta = Object.freeze({
  generatedAt: "2026-09-10T00:00:00.000Z",
  dataCutoff: "2026-09-09T22:30:00.000Z",
  methodologyVersion: "evaluation-v1-draft",
});

/** 分类页与 axe 扫描共用：用首页的已发布变化填充“近期变化”，让扫描覆盖更完整的内容状态。 */
const SYNTHETIC_CATEGORY_WITH_CHANGES = Object.freeze({
  ...PAGE_MODEL_FIXTURES.category,
  changes: PAGE_MODEL_FIXTURES.overview.topChanges,
});

const SYNTHETIC_CHANGES: ChangesPageModel = Object.freeze({
  changes: PAGE_MODEL_FIXTURES.overview.topChanges,
  nextCursor: null,
  freshness: "current",
});

test("合成 fixture：首页展示已发布摘要、论点、变化与来源健康（非真实市场或已部署数据）", async ({ page }) => {
  await blockUnexpectedPublicApi(page);
  await routeSyntheticEnvelope(page, "/api/v1/overview", PAGE_MODEL_FIXTURES.overview);

  const [overviewResponse] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/overview")),
    page.goto("/"),
  ]);

  expect(overviewResponse.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "ENSO 风险仍待实物与市场层确认" })).toBeVisible();
  await expect(page.getByText("今日更新保留了支持和反向证据，未把单一价格变化视为市场确认。")).toBeVisible();

  const thesisSection = page.getByRole("region", { name: "正在跟踪的研究判断" });
  await expect(thesisSection.getByRole("link", { name: "泰国天然橡胶" })).toBeVisible();
  await expect(thesisSection.getByText("区域天气与实物供应共同指向短期原料压力。")).toBeVisible();

  // PRD §6.2 次序：今日变化位于六条论点卡片之前，名称与该位置一致。
  const changesSection = page.getByRole("region", { name: "今日变化" });
  await expect(changesSection.getByText("区域降水观测已修订。")).toBeVisible();

  const healthSection = page.getByRole("region", { name: "数据健康" });
  await expect(healthSection.getByText("正常 2 · 延迟 0 · 降级 0 · 过期 0 · 故障 0")).toBeVisible();
  await expect(healthSection.getByText("当前", { exact: true })).toBeVisible();
});

test("合成 fixture：主导航进入天然橡胶分类，展示发布卡、变化与覆盖缺口（非真实市场或已部署数据）", async ({ page }) => {
  await blockUnexpectedPublicApi(page);
  await routeSyntheticEnvelope(page, "/api/v1/overview", PAGE_MODEL_FIXTURES.overview);
  await routeSyntheticEnvelope(page, "/api/v1/categories/rubber", SYNTHETIC_CATEGORY_WITH_CHANGES);

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "主要导航" });
  const rubberLink = navigation.getByRole("link", { name: "天然橡胶", exact: true });
  const [categoryResponse] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/categories/rubber")),
    rubberLink.click(),
  ]);

  expect(categoryResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/rubber$/);
  await expect(page.getByRole("heading", { name: "天然橡胶", exact: true })).toBeVisible();

  const publishedSection = page.getByRole("region", { name: "当前市场影响路径" });
  await expect(publishedSection.getByRole("link", { name: "泰国天然橡胶" })).toBeVisible();
  await expect(publishedSection.getByText("泰国南部主产区")).toBeVisible();

  const changesSection = page.getByRole("region", { name: "近期变化" });
  await expect(changesSection.getByText("泰国天然橡胶 · 区域降水观测已修订。")).toBeVisible();

  const coverageSection = page.getByRole("region", { name: "公开范围说明" });
  await expect(coverageSection.getByText("缺少可公开再分发的橡胶现货价格序列。")).toBeVisible();
});

test("合成 fixture：从首页进入已发布论点详情，保留证据、指标图表文字说明与数据表（非真实市场或已部署数据）", async ({ page }) => {
  await blockUnexpectedPublicApi(page);
  await routeSyntheticEnvelope(page, "/api/v1/overview", PAGE_MODEL_FIXTURES.overview);
  await routeSyntheticEnvelope(page, "/api/v1/theses/thailand-rubber", PAGE_MODEL_FIXTURES.thesis);

  await page.goto("/");
  const [thesisResponse] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/theses/thailand-rubber")),
    page.getByRole("link", { name: "泰国天然橡胶" }).first().click(),
  ]);

  expect(thesisResponse.status()).toBe(200);
  await expect(page).toHaveURL(/\/theses\/thailand-rubber$/);
  await expect(page.getByRole("heading", { name: "泰国天然橡胶", exact: true })).toBeVisible();
  await expect(page.getByText("已发布版本 3")).toBeVisible();

  const supportingEvidence = page.getByRole("region", { name: "支持证据" });
  await expect(supportingEvidence.getByText("泰南降水异常扩大了割胶窗口的不确定性。")).toBeVisible();
  await expect(supportingEvidence.getByText("降水异常 -18%")).toBeVisible();

  const counterEvidence = page.getByRole("region", { name: "反向证据" });
  await expect(counterEvidence.getByText("库存尚未显示持续性下降。")).toBeVisible();

  const indicators = page.getByRole("region", { name: "关键指标与数据口径" });
  await expect(indicators.getByRole("img", { name: "泰南降水异常趋势图，单位 %" })).toBeVisible();
  await expect(indicators.getByText("缺失观测保留为空档，不按零值处理；质量、修订、来源及全部时间口径见下表。")).toBeVisible();
  const table = indicators.getByRole("table", { name: "图表对应的完整公开指标数据表" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("cell", { name: "-18 %" })).toBeVisible();
  await expect(table.getByRole("link", { name: "NOAA Climate Prediction Center" })).toBeVisible();
});

/**
 * Public-page accessibility regression via axe-core. Each key public destination is scanned with
 * the same deterministic synthetic envelopes as the tests above, and compared against the
 * recorded violations in e2e/axe-baseline.md (page + rule id dimension). Run
 * `AXE_CAPTURE_BASELINE=1 npx playwright test --grep axe` to re-capture the machine block.
 */
const AXE_SCANNED_PAGES = [
  {
    path: "/",
    endpoint: "/api/v1/overview",
    routes: [["/api/v1/overview", PAGE_MODEL_FIXTURES.overview]],
    ready: async (page: Page) => {
      await expect(page.getByRole("heading", { name: "ENSO 风险仍待实物与市场层确认" })).toBeVisible();
      await expect(page.getByRole("region", { name: "正在跟踪的研究判断" })).toBeVisible();
    },
  },
  {
    path: "/rubber",
    endpoint: "/api/v1/categories/rubber",
    routes: [["/api/v1/categories/rubber", SYNTHETIC_CATEGORY_WITH_CHANGES]],
    ready: async (page: Page) => {
      await expect(page.getByRole("heading", { name: "天然橡胶", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "近期变化" })).toBeVisible();
    },
  },
  {
    path: "/changes",
    endpoint: "/api/v1/changes",
    routes: [
      ["/api/v1/changes", SYNTHETIC_CHANGES],
      ["/api/v1/theses", PAGE_MODEL_FIXTURES.overview.theses],
    ],
    ready: async (page: Page) => {
      await expect(page.getByRole("heading", { name: "已公开的变化记录" })).toBeVisible();
      await expect(page.getByText("区域降水观测已修订。")).toBeVisible();
    },
  },
  {
    path: "/data-health",
    endpoint: "/api/v1/data-health",
    routes: [["/api/v1/data-health", PAGE_MODEL_FIXTURES.dataHealth]],
    ready: async (page: Page) => {
      await expect(page.getByRole("heading", { name: "公开来源健康记录" })).toBeVisible();
      await expect(page.getByRole("link", { name: "NOAA Climate Prediction Center" })).toBeVisible();
    },
  },
  {
    path: "/methodology",
    endpoint: "/api/v1/methodology",
    routes: [["/api/v1/methodology", PAGE_MODEL_FIXTURES.methodology]],
    ready: async (page: Page) => {
      await expect(page.getByRole("heading", { name: "方法论与已知局限" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "置信度" })).toBeVisible();
    },
  },
  {
    path: "/theses/thailand-rubber",
    endpoint: "/api/v1/theses/thailand-rubber",
    routes: [["/api/v1/theses/thailand-rubber", PAGE_MODEL_FIXTURES.thesis]],
    ready: async (page: Page) => {
      await expect(page.getByRole("heading", { name: "泰国天然橡胶", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "支持证据" })).toBeVisible();
      // The lazily loaded ECharts canvas carries an accessible name; scan it in its settled state.
      await expect(page.getByRole("img", { name: "泰南降水异常趋势图，单位 %" })).toBeVisible();
    },
  },
] as const;

test.describe("公开页 axe 无障碍扫描（对比 e2e/axe-baseline.md 基线）", () => {
  const captureMode = isAxeCaptureMode();
  const baseline = captureMode ? null : loadAxeBaseline();

  test.afterAll(() => {
    if (captureMode) {
      printCapturedAxeBaseline();
    }
  });

  for (const scanned of AXE_SCANNED_PAGES) {
    test(`合成 fixture：${scanned.path} 不引入基线之外的 axe 违规`, async ({ page }) => {
      await blockUnexpectedPublicApi(page);
      for (const [pathname, data] of scanned.routes) {
        await routeSyntheticEnvelope(page, pathname, data);
      }

      const [response] = await Promise.all([
        page.waitForResponse(isGetEndpoint(scanned.endpoint)),
        page.goto(scanned.path),
      ]);
      expect(response.status()).toBe(200);
      await scanned.ready(page);

      const results = await new AxeBuilder({ page }).analyze();
      const violations = results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes,
      }));

      if (captureMode) {
        recordAxeViolationsForCapture(scanned.path, violations);
        return;
      }
      assertNoNewAxeViolations(scanned.path, violations, baseline!);
    });
  }
});

async function blockUnexpectedPublicApi(page: Page): Promise<void> {
  // Playwright runs the most recently registered matching route first. Each expected endpoint is
  // registered afterwards by routeSyntheticEnvelope, while any unexpected /api/v1/* request fails
  // rather than reaching the ephemeral Worker, D1, or an external origin.
  await page.route("**/api/v1/**", (route) => {
    throw new Error(`Synthetic E2E made an unhandled public API request: ${route.request().url()}`);
  });
}

async function routeSyntheticEnvelope<T>(page: Page, pathname: string, data: T): Promise<void> {
  const envelope: ApiEnvelope<T> = { data, meta: SYNTHETIC_API_META };
  await page.route(`**${pathname}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.origin).toBe(new URL(page.url()).origin);
    expect(requestUrl.pathname).toBe(pathname);
    await fulfillJson(route, envelope);
  });
}

async function fulfillJson<T>(route: Route, body: ApiEnvelope<T>): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json; charset=utf-8",
    headers: { "cache-control": "public, max-age=60" },
    body: JSON.stringify(body),
  });
}

function isGetEndpoint(pathname: string): (response: Response) => boolean {
  return (response) => response.request().method() === "GET"
    && new URL(response.url()).pathname === pathname;
}
