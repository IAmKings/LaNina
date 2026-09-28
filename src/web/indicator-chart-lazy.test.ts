import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAGE_MODEL_FIXTURES } from "../domain/page-models.fixtures";

import { IndicatorChart } from "./IndicatorChart";

const chartableSeries = PAGE_MODEL_FIXTURES.thesis.indicators[0];
const unchartableSeries = {
  ...chartableSeries,
  points: [{ ...chartableSeries.points[0], value: null }],
};

/**
 * Static renders lock the pre-viewport placeholder contract: the ECharts chunk is requested only
 * when the container approaches the viewport (see viewport-entry tests for the observer behavior),
 * and until then the accessible summary and the data table below stay available.
 */
describe("indicator chart viewport lazy loading", () => {
  it("shows the not-yet-in-view placeholder instead of claiming the chart is loading", () => {
    const html = renderToStaticMarkup(createElement(IndicatorChart, { series: chartableSeries }));

    expect(html).toContain("图表进入视野后加载；下方数据表始终可用。");
    expect(html).not.toContain("图表正在加载");
    expect(html).toContain('role="img"');
    // Nothing is being fetched before the viewport entry, so the canvas is not busy.
    expect(html).toContain('aria-busy="false"');
  });

  it("keeps the non-numeric fallback without any chart container", () => {
    const html = renderToStaticMarkup(createElement(IndicatorChart, { series: unchartableSeries }));

    expect(html).toContain("暂无可绘制的数值型观测；下表保留缺失原因、原始标签与来源时间口径。");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("图表进入视野后加载");
  });
});
