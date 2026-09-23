import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";
import { PageShell } from "./App";
import { ThesisDetail } from "./ThesisDetailPage";

describe("public accessibility semantics", () => {
  it("keeps keyboard users' skip target and the active category destination in the primary navigation", () => {
    const html = renderToStaticMarkup(createElement(
      PageShell,
      { currentPath: "/rubber", children: createElement("h1", null, "天然橡胶") },
    ));

    expect(html).toContain('<a class="skip-link" href="#content">跳到主要内容</a>');
    expect(html).toContain('<nav aria-label="主要导航">');
    expect(html).toContain('<a href="/rubber" aria-current="page">天然橡胶</a>');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('<main id="content" class="site-frame" tabindex="-1">');
  });

  it("retains the complete public data table when a chart is available", () => {
    const html = renderToStaticMarkup(createElement(ThesisDetail, { model: PAGE_MODEL_FIXTURES.thesis }));

    expect(html).toContain('role="img"');
    expect(html).toContain('泰南降水异常趋势图，单位 %');
    expect(html).toContain('<table>');
    expect(html).toContain('<caption>图表对应的完整公开指标数据表</caption>');
    expect(html.match(/scope="col"/g)).toHaveLength(4);
    expect(html).toContain('观测 2026/09/08 08:00');
    expect(html).toContain('发布 2026/09/09 20:00');
    expect(html).toContain('采集 2026/09/09 20:05');
  });

  it("uses the text-table fallback rather than concealing non-numeric public observations", () => {
    const model = {
      ...PAGE_MODEL_FIXTURES.thesis,
      indicators: [{
        ...PAGE_MODEL_FIXTURES.thesis.indicators[0],
        missingReason: "来源尚未发布数值。",
        points: [{
          ...PAGE_MODEL_FIXTURES.thesis.indicators[0].points[0],
          value: null,
        }],
      }],
    };
    const html = renderToStaticMarkup(createElement(ThesisDetail, { model }));

    expect(html).toContain('暂无可绘制的数值型观测；下表保留缺失原因、原始标签与来源时间口径。');
    expect(html).toContain('缺失说明：来源尚未发布数值。');
    expect(html).toContain('<caption>图表对应的完整公开指标数据表</caption>');
    expect(html).toContain('<td>缺失</td>');
    expect(html).not.toContain('role="img"');
  });
});
