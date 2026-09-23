import { expect, test, type Response } from "@playwright/test";

const LOCAL_DEMO_HEADER = "synthetic-published-read-model";

test("本机 demo：首页通过实际同源接口展示合成 Read Model", async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/overview")),
    page.goto("/"),
  ]);

  await expectSyntheticDemoResponse(response);
  await expect(page.getByRole("heading", { name: "ENSO 风险仍待实物与市场层确认" })).toBeVisible();
  await expect(page.getByRole("region", { name: "正在跟踪的研究判断" })
    .getByRole("link", { name: "泰国天然橡胶" })).toBeVisible();

  // §6.2 第 4 项：跨市场风险图按传导阶段列出六条判断，且明确不合并为单一评分。
  const riskMap = page.getByRole("region", { name: "六条判断所处的传导阶段" });
  await expect(riskMap).toBeVisible();
  await expect(riskMap.getByRole("table")).toBeVisible();
  for (const stage of ["观察中", "天气已兑现", "实物承压", "供需收紧", "市场确认", "压力缓解"]) {
    await expect(riskMap.getByRole("rowheader", { name: stage, exact: true })).toBeVisible();
  }
  await expect(page.getByText("不是评分，不合并为单一结论")).toBeVisible();
});

test("本机 demo：分类页通过实际同源接口展示合成变化", async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/categories/rubber")),
    page.goto("/rubber"),
  ]);

  await expectSyntheticDemoResponse(response);
  await expect(page.getByRole("heading", { name: "天然橡胶", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "近期变化" })
    .getByText("泰国天然橡胶 · 区域降水观测已修订。")).toBeVisible();
});

test("本机 demo：论点详情通过实际同源接口展示合成证据与图表数据", async ({ page }) => {
  const [response] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/theses/thailand-natural-rubber")),
    page.goto("/theses/thailand-natural-rubber"),
  ]);

  await expectSyntheticDemoResponse(response);
  await expect(page.getByRole("heading", { name: "泰国天然橡胶", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "支持证据" })
    .getByText("泰南降水异常扩大了割胶窗口的不确定性。")).toBeVisible();
  await expect(page.getByRole("table", { name: "图表对应的完整公开指标数据表" })
    .getByRole("cell", { name: "-18 %" })).toBeVisible();
});

test("本机 demo：未接管的公开接口仍由本地 Worker 处理", async ({ page }) => {
  const response = await page.request.get("/api/v1/healthz");

  expect(response.status()).toBe(200);
  expect(response.headers()["x-enso-local-demo"]).toBeUndefined();
});

test("本机 demo：1280×800 两屏内可见 ENSO 判定、今日变化与六条论点", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const [response] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/overview")),
    page.goto("/"),
  ]);
  await expectSyntheticDemoResponse(response);

  // PRD §6.2 验收：不滚动超过两屏即可看到 ENSO 判定、今日变化与六条论点状态。
  const twoScreens = 800 * 2;
  const verdict = await page.getByRole("heading", { name: "ENSO 风险仍待实物与市场层确认" }).boundingBox();
  const changes = await page.getByRole("region", { name: "今日变化" }).boundingBox();
  const cards = await page.getByRole("region", { name: "正在跟踪的研究判断" }).boundingBox();

  expect(verdict).not.toBeNull();
  expect(changes).not.toBeNull();
  expect(cards).not.toBeNull();
  const reached = {
    verdict: verdict!.y,
    changes: changes!.y,
    cards: cards!.y + cards!.height,
  };
  // Recorded as an annotation so the two-screen evidence carries the measured geometry.
  testInfo.annotations.push({ type: "two-screen-geometry", description: JSON.stringify(reached) });
  expect(reached.verdict).toBeLessThan(twoScreens);
  expect(reached.changes).toBeLessThan(twoScreens);
  expect(reached.cards).toBeLessThanOrEqual(twoScreens);
});

const VIEWPORTS = [
  { name: "360x800", width: 360, height: 800 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

const DEMO_PAGES = [
  {
    path: "/",
    endpoint: "/api/v1/overview",
    heading: "把气候信号转化为可核验的市场判断。",
    landmark: { role: "region", name: "正在跟踪的研究判断" },
  },
  {
    path: "/rubber",
    endpoint: "/api/v1/categories/rubber",
    heading: "天然橡胶",
    landmark: { role: "region", name: "近期变化" },
  },
  {
    path: "/agriculture",
    endpoint: "/api/v1/categories/agriculture",
    heading: "农产品",
    landmark: { role: "region", name: "近期变化" },
  },
  {
    path: "/shipping",
    endpoint: "/api/v1/categories/shipping",
    heading: "航运",
    landmark: { role: "region", name: "近期变化" },
  },
  {
    path: "/theses/thailand-natural-rubber",
    endpoint: "/api/v1/theses/thailand-natural-rubber",
    heading: "泰国天然橡胶",
    landmark: { role: "region", name: "支持证据" },
  },
  {
    path: "/changes",
    endpoint: "/api/v1/changes",
    heading: "最新变化",
    landmark: { role: "heading", name: "已公开的变化记录" },
  },
  {
    path: "/data-health",
    endpoint: "/api/v1/data-health",
    heading: "数据健康",
    landmark: { role: "heading", name: "公开来源健康记录" },
  },
  {
    path: "/methodology",
    endpoint: "/api/v1/methodology",
    heading: "方法论与已知局限",
    landmark: null,
  },
] as const;

/**
 * PRD AC: no core content is truncated at 360/768/1280. Geometry is asserted
 * instead of eyeballed, so the evidence is reproducible rather than a claim.
 */
for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} 视口`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const page_ of DEMO_PAGES) {
      test(`${page_.path} 不产生横向溢出且保留核心内容`, async ({ page }, testInfo) => {
        const [response] = await Promise.all([
          page.waitForResponse(isGetEndpoint(page_.endpoint)),
          page.goto(page_.path),
        ]);
        await expectSyntheticDemoResponse(response);

        await expect(page.getByRole("heading", { level: 1, name: page_.heading })).toBeVisible();
        await expect(page.getByRole("navigation", { name: "主要导航" })).toBeVisible();
        if (page_.landmark !== null) {
          await expect(page.getByRole(page_.landmark.role, { name: page_.landmark.name })).toBeVisible();
        }

        // Every public destination stays reachable in the primary navigation.
        const destinations = page.getByRole("navigation", { name: "主要导航" }).getByRole("link");
        expect(await destinations.count()).toBeGreaterThanOrEqual(7);

        const geometry = await page.evaluate(() => {
          // Content inside an intentional horizontal scroll container (the mobile
          // navigation, wide data tables) is reachable rather than truncated.
          const insideScrollContainer = (element: Element): boolean => {
            let node = element.parentElement;
            while (node !== null) {
              const overflowX = getComputedStyle(node).overflowX;
              if (overflowX === "auto" || overflowX === "scroll") return true;
              node = node.parentElement;
            }
            return false;
          };
          const overflowing = Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.right > window.innerWidth + 1;
            })
            .filter((element) => !insideScrollContainer(element))
            .slice(0, 5)
            .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            overflowing,
          };
        });

        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
        expect(geometry.overflowing).toEqual([]);

        // The detail page loads the real ECharts runtime lazily; the drawn canvas
        // must fit the viewport and keep its accessible table beside it.
        if (page_.path === "/theses/thailand-natural-rubber") {
          const canvas = page.locator(".indicator-chart-canvas canvas");
          await expect(canvas).toBeVisible();
          const box = await canvas.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeLessThanOrEqual(viewport.width);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          await expect(page.getByRole("table", { name: "图表对应的完整公开指标数据表" })).toBeVisible();
        }

        await testInfo.attach(`${viewport.name}${page_.path.replace(/\//g, "_")}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      });
    }
  });
}

test("本机 demo：变化页筛选可键盘操作、写入地址栏并重新请求", async ({ page }) => {
  const [initial] = await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/changes")),
    page.goto("/changes"),
  ]);
  await expectSyntheticDemoResponse(initial);

  // Every filter control is a labelled form field, so keyboard and screen readers reach it.
  const category = page.getByLabel("类别", { exact: true });
  const thesis = page.getByLabel("论点", { exact: true });
  const from = page.getByLabel("起始日（Asia/Shanghai）", { exact: true });
  const to = page.getByLabel("结束日（Asia/Shanghai）", { exact: true });
  await expect(category).toBeVisible();
  await expect(thesis).toBeVisible();
  await expect(from).toBeVisible();
  await expect(to).toBeVisible();

  const [filtered] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/v1/changes"
      && new URL(response.url()).searchParams.get("category") === "rubber"),
    (async () => {
      await category.selectOption("rubber");
      await page.getByRole("button", { name: "应用筛选" }).click();
    })(),
  ]);
  await expectSyntheticDemoResponse(filtered);

  expect(new URL(page.url()).search).toBe("?category=rubber");
  await expect(page.getByText("当前筛选：类别：天然橡胶")).toBeVisible();

  await page.getByRole("button", { name: "清除筛选" }).click();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByText("当前筛选", { exact: false })).toHaveCount(0);
});

test("本机 demo：浏览器返回/前进与筛选状态保持同步", async ({ page }) => {
  await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/changes")),
    page.goto("/changes"),
  ]);

  const category = page.getByLabel("类别", { exact: true });
  await category.selectOption("rubber");
  await page.getByRole("button", { name: "应用筛选" }).click();
  expect(new URL(page.url()).search).toBe("?category=rubber");
  await expect(page.getByText("当前筛选：类别：天然橡胶")).toBeVisible();

  // 返回键：URL 回退到无筛选，页面必须同步（控件复位、摘要消失）。
  await page.goBack();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByLabel("类别", { exact: true })).toHaveValue("");
  await expect(page.getByText("当前筛选", { exact: false })).toHaveCount(0);

  // 前进键：恢复筛选后的状态。
  await page.goForward();
  expect(new URL(page.url()).search).toBe("?category=rubber");
  await expect(page.getByLabel("类别", { exact: true })).toHaveValue("rubber");
  await expect(page.getByText("当前筛选：类别：天然橡胶")).toBeVisible();
});

test("本机 demo：每个公开接口都有数据，不再有空白页面", async ({ page }) => {
  // The thesis list feeds the change filters, so an empty list silently broke that dropdown.
  const theses = await page.request.get("/api/v1/theses");
  expect(theses.status()).toBe(200);
  const cards = (await theses.json() as { data: readonly { slug: string }[] }).data;
  expect(cards).toHaveLength(6);
  for (const card of cards) {
    const detail = await page.request.get(`/api/v1/theses/${card.slug}`);
    expect(detail.status(), `thesis detail ${card.slug}`).toBe(200);
  }

  for (const category of ["rubber", "agriculture", "shipping"]) {
    const response = await page.request.get(`/api/v1/categories/${category}`);
    expect(response.status(), `category ${category}`).toBe(200);
    const body = await response.json() as { data: { theses: readonly unknown[] } };
    expect(body.data.theses.length, `category ${category} cards`).toBeGreaterThan(0);
  }

  // The Atom feed is rendered by the real renderer and must carry entries, not only a title.
  const feed = await page.request.get("/feed.xml");
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("atom+xml");
  const xml = await feed.text();
  expect(xml).toContain("<entry>");
  expect(xml).toContain("每日判定：");
});

test("本机 demo：变化页的论点下拉已由论点列表填充", async ({ page }) => {
  await Promise.all([
    page.waitForResponse(isGetEndpoint("/api/v1/theses")),
    page.goto("/changes"),
  ]);

  const options = page.getByLabel("论点", { exact: true }).locator("option");
  await expect(options).toHaveCount(7); // 全部论点 + 六条论点
  await expect(options.nth(1)).not.toHaveText("全部论点");
});

async function expectSyntheticDemoResponse(response: Response): Promise<void> {
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-enso-local-demo"]).toBe(LOCAL_DEMO_HEADER);
}

function isGetEndpoint(pathname: string): (response: Response) => boolean {
  return (response) => response.request().method() === "GET"
    && new URL(response.url()).pathname === pathname;
}
