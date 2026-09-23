import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { EChartsOption } from "echarts";

import type { IndicatorSeriesModel } from "../domain/page-models";
import {
  chartPointDataItem,
  chartableIndicatorPoints,
  hasChartableIndicatorValue,
} from "./indicator-markers";

/**
 * This module is dynamically imported by IndicatorChart. Keeping the ECharts
 * registrations here lets Vite retain only the line-chart implementation and
 * its grid, tooltip and canvas dependencies in the lazy chunk.
 *
 * Marker conventions themselves live in `indicator-markers`, which has no chart
 * dependency, so the page can describe them without loading this chunk.
 */
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export function initIndicatorChart(container: HTMLDivElement) {
  return echarts.init(container, undefined, { renderer: "canvas" });
}

export {
  chartMarkerLegend,
  chartPointMarker,
  chartPointDataItem,
  chartableIndicatorPoints,
  hasChartableIndicatorValue,
  type ChartPointMarker,
  type ChartableIndicatorPoint,
} from "./indicator-markers";

export function indicatorChartOption(series: IndicatorSeriesModel): EChartsOption {
  const points = chartableIndicatorPoints(series);

  return {
    animationDuration: 240,
    grid: { top: 36, right: 20, bottom: 44, left: 58, containLabel: true },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => {
        if (value === "-" || value === null || value === undefined) return "缺失";
        return `${String(value)} ${series.unit}`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.observedAt),
      axisLabel: {
        color: "#52605b",
        formatter: (value: string) => formatChartDate(value),
      },
      axisLine: { lineStyle: { color: "#aeb8b3" } },
    },
    yAxis: {
      type: "value",
      name: series.unit,
      nameTextStyle: { color: "#52605b", padding: [0, 0, 0, 4] },
      axisLabel: { color: "#52605b" },
      splitLine: { lineStyle: { color: "rgba(23, 32, 30, 0.12)" } },
    },
    series: [{
      name: series.name,
      type: "line",
      data: points.map(chartPointDataItem),
      connectNulls: false,
      showSymbol: true,
      symbolSize: 7,
      lineStyle: { color: "#174c39", width: 2 },
      itemStyle: { color: "#174c39" },
      emphasis: { focus: "series" },
    }],
  };
}

export function hasChartableValue(series: IndicatorSeriesModel): boolean {
  return hasChartableIndicatorValue(series);
}

function formatChartDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}
