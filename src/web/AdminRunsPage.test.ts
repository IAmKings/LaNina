import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminRunsPage } from "./AdminRunsPage";

const VALID_CURSOR = '{"scheduledAt":"2026-09-11T03:30:00.000Z","id":"0b9e6c59-2f3a-4c8d-9e1f-2a3b4c5d6e7f"}';

/** AdminRunsPage 在组件体里读取 window.location.search；node 测试环境用 stub 提供地址。 */
function renderPageAt(search: string): string {
  vi.stubGlobal("window", { location: { search } });
  return renderToStaticMarkup(createElement(AdminRunsPage, null));
}

describe("AdminRunsPage before data arrives", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["", "without a cursor"],
    [`?cursor=${encodeURIComponent(VALID_CURSOR)}`, "with a valid cursor"],
    [`?cursor=${encodeURIComponent("<script>alert(1)</script>")}`, "with a malformed cursor"],
    ["?cursor=", "with an empty cursor"],
  ])("renders only the loading notice %s", (search) => {
    const html = renderPageAt(search);

    expect(html).toContain("正在取得采集任务记录…");
    expect(html).toContain('class="notice-panel"');
    // 数据到达前不得渲染任何运行记录表格或分页链接。
    expect(html).not.toContain("<table");
    expect(html).not.toContain("cursor=");
  });
});
