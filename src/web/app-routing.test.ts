import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { App } from "./App";

/** 路由解析直接读取 window.location；node 测试环境用 stub 提供当前地址。 */
function renderAppAt(pathname: string, search = ""): string {
  vi.stubGlobal("window", {
    location: { origin: "https://preview.example.test", pathname, search },
  });
  return renderToStaticMarkup(createElement(App, null));
}

describe("App routing", () => {
  beforeAll(async () => {
    // 后台页面是 React.lazy：首次渲染才发起按需加载。先渲染一次并等加载完成后，
    // 后续测试才能同步断言真实后台页面而不是 Suspense 兜底。
    await import("./AdminRunsPage");
    await import("./AdminDailyPage");
    renderAppAt("/admin/runs");
    renderAppAt("/admin/daily");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the public overview on the root path", () => {
    const html = renderAppAt("/");

    expect(html).toContain("把气候信号转化为可核验的市场判断。");
    expect(html).not.toContain("页面不存在");
  });

  it("treats one trailing slash as the same page and keeps the navigation highlight", () => {
    const html = renderAppAt("/rubber/");

    expect(html).toContain("正在取得已发布分类内容…");
    expect(html).toContain('<a href="/rubber" aria-current="page">天然橡胶</a>');
  });

  it("keeps bare category and information routes on their pages", () => {
    expect(renderAppAt("/rubber")).toContain("正在取得已发布分类内容…");
    expect(renderAppAt("/methodology")).toContain("正在取得已发布方法论…");
  });

  it("lands /admin/daily/ with a trailing slash on the current brief date page", () => {
    const html = renderAppAt("/admin/daily/");

    expect(html).toContain("正在取得每日判定预检信息…");
  });

  it("lands /admin/runs/ with a trailing slash on the admin runs page", () => {
    const html = renderAppAt("/admin/runs/");

    expect(html).toContain("正在取得采集任务记录…");
  });

  it("keeps the /admin prefix on the Access redirect screen", () => {
    const html = renderAppAt("/admin");

    expect(html).toContain("正在加载后台界面…");
  });

  it("renders thesis details for a lowercase slug", () => {
    const html = renderAppAt("/theses/thailand-rubber");

    expect(html).toContain("正在取得已发布论点…");
  });

  it.each(["/Rubber", "/foo", "/theses/ABC", "/admin/unknown", "/rubber//"])(
    "renders the explicit 404 page instead of the public overview for %s",
    (pathname) => {
      const html = renderAppAt(pathname);

      expect(html).toContain("页面不存在");
      expect(html).toContain('<a href="/">返回首页</a>');
      expect(html).toContain("aria-labelledby=\"not-found-heading\"");
      // 兜底不再是公开首页：内容与元数据（见 seo.test.ts）一致地表达 404。
      expect(html).not.toContain("把气候信号转化为可核验的市场判断。");
      expect(html).not.toContain("正在取得已发布分类内容…");
    },
  );
});
