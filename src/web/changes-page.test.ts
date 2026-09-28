import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";

import type { ChangesPageModel } from "../domain/page-models";
import { emptyChangesFilter } from "./public-information-view";
import { ChangesTimeline } from "./PublicInformationPages";

const loadedChanges: ChangesPageModel = {
  changes: PAGE_MODEL_FIXTURES.overview.topChanges,
  nextCursor: "cursor-2",
  freshness: "current",
};

function render(state: Parameters<typeof ChangesTimeline>[0]["state"]) {
  return renderToStaticMarkup(createElement(ChangesTimeline, {
    state,
    filters: emptyChangesFilter(),
  }));
}

describe("changes timeline refreshing behavior", () => {
  it("keeps the previous read model on screen with aria-busy and a visible updating notice", () => {
    const html = render({ status: "refreshing", data: loadedChanges });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在按当前筛选更新变化清单；以下保留上一次的公开结果。");
    // The stale read model stays rendered while the refetch runs.
    expect(html).toContain("区域降水观测已修订。");
    expect(html).toContain('class="changes-list changes-list-detailed"');
    expect(html).toContain("<h2 id=\"changes-list-title\">已公开的变化记录</h2>");
  });

  it("renders the refreshed read model without aria-busy or the updating notice", () => {
    const html = render({ status: "ready", data: loadedChanges });

    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("正在按当前筛选更新变化清单");
    expect(html).toContain("区域降水观测已修订。");
    expect(html).toContain("查看更早的公开变化");
  });

  it("keeps the explicit first-load and error states free of stale data", () => {
    const loadingHtml = render({ status: "loading" });
    expect(loadingHtml).toContain("正在取得最新公开变化…");
    expect(loadingHtml).toContain('aria-busy="false"');
    expect(loadingHtml).not.toContain("区域降水观测已修订。");

    const errorHtml = render({ status: "error", message: "公开页面暂时无法加载。" });
    expect(errorHtml).toContain("公开变化暂时无法加载。");
    expect(errorHtml).toContain("role=\"alert\"");
    expect(errorHtml).not.toContain("区域降水观测已修订。");
  });
});
