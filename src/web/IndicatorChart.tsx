import { useEffect, useId, useRef, useState } from "react";

import type { EChartsOption } from "echarts";

import type { IndicatorSeriesModel } from "../domain/page-models";
import { chartMarkerLegend, chartableIndicatorPoints } from "./indicator-markers";

type ChartState = "loading" | "ready" | "error";

interface IndicatorChartProps {
  readonly series: IndicatorSeriesModel;
}

export function IndicatorChart({ series }: IndicatorChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const [state, setState] = useState<ChartState>("loading");
  const hasChartableValue = series.points.some((point) => typeof point.value === "number" && Number.isFinite(point.value));
  const markerLegend = chartMarkerLegend(chartableIndicatorPoints(series));

  useEffect(() => {
    if (!hasChartableValue) return;

    const container = containerRef.current;
    if (container === null) return;

    let cancelled = false;
    let chart: { dispose(): void; resize(): void; setOption(option: EChartsOption): void } | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let removeWindowResizeListener: (() => void) | undefined;

    setState("loading");
    void loadIndicatorChartRuntime()
      .then(({ indicatorChartOption, initIndicatorChart }) => {
        if (cancelled) return;
        chart = initIndicatorChart(container);
        chart.setOption(indicatorChartOption(series));

        const resize = () => chart?.resize();
        if (typeof ResizeObserver === "function") {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(container);
        } else {
          window.addEventListener("resize", resize);
          removeWindowResizeListener = () => window.removeEventListener("resize", resize);
        }
        setState("ready");
      })
      .catch(() => {
        chart?.dispose();
        chart = undefined;
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      removeWindowResizeListener?.();
      chart?.dispose();
    };
  }, [hasChartableValue, series]);

  if (!hasChartableValue) {
    return <p className="indicator-chart-message muted">暂无可绘制的数值型观测；下表保留缺失原因、原始标签与来源时间口径。</p>;
  }

  return (
    <div className="indicator-chart">
      <p className="indicator-chart-summary" id={summaryId}>
        {series.name}按 {series.unit} 展示。缺失观测保留为空档，不按零值处理；质量、修订、来源及全部时间口径见下表。
      </p>
      {markerLegend.length === 0 ? null : (
        <p className="indicator-chart-legend">
          标记：{markerLegend.map((label) => (
            <span className="indicator-marker" key={label}>
              <span aria-hidden="true">{label === "修订观测" ? "◆" : "○"}</span> {label}
            </span>
          ))}
        </p>
      )}
      {state === "loading" ? <p className="indicator-chart-message" role="status">图表正在加载；可先阅读下方数据表。</p> : null}
      {state === "error" ? <p className="indicator-chart-message is-error" role="status">图表暂时无法显示，请使用下方可访问的数据表。</p> : null}
      <div
        aria-busy={state === "loading"}
        aria-describedby={summaryId}
        aria-label={`${series.name}趋势图，单位 ${series.unit}`}
        className={`indicator-chart-canvas${state === "error" ? " is-hidden" : ""}`}
        ref={containerRef}
        role="img"
      />
    </div>
  );
}

/**
 * Load ECharts only when a detail page actually has a numeric series to draw.
 * The package entry includes every chart and renderer, so load the core and the
 * four registrations this line chart needs instead.
 */
async function loadIndicatorChartRuntime() {
  return import("./indicator-chart");
}
