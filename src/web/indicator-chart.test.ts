import { describe, expect, it } from "vitest";

import type { IndicatorSeriesModel } from "../domain/page-models";
import {
  chartMarkerLegend,
  chartPointDataItem,
  chartPointMarker,
  chartableIndicatorPoints,
  hasChartableIndicatorValue,
  indicatorChartOption,
} from "./indicator-chart";

const series: IndicatorSeriesModel = {
  id: "rainfall",
  name: "泰南降水异常",
  unit: "%",
  missingReason: null,
  points: [
    {
      observedAt: "2026-09-01T00:00:00.000Z",
      value: -12,
      unit: "%",
      quality: "verified",
      revision: 0,
      isRevision: false,
      source: { name: "NOAA", organization: "NOAA", citationUrl: "https://example.test/noaa" },
      times: { observedAt: "2026-09-01T00:00:00.000Z", publishedAt: null, fetchedAt: "2026-09-01T01:00:00.000Z" },
    },
    {
      observedAt: "2026-09-08T00:00:00.000Z",
      value: null,
      unit: "%",
      quality: "provisional",
      revision: 1,
      isRevision: true,
      source: { name: "NOAA", organization: "NOAA", citationUrl: "https://example.test/noaa" },
      times: { observedAt: "2026-09-08T00:00:00.000Z", publishedAt: null, fetchedAt: "2026-09-08T01:00:00.000Z" },
    },
    {
      observedAt: "2026-09-15T00:00:00.000Z",
      value: "尚未量化",
      unit: "%",
      quality: "estimated",
      revision: 0,
      isRevision: false,
      source: { name: "NOAA", organization: "NOAA", citationUrl: "https://example.test/noaa" },
      times: { observedAt: "2026-09-15T00:00:00.000Z", publishedAt: null, fetchedAt: "2026-09-15T01:00:00.000Z" },
    },
  ],
};

describe("indicator chart mapping", () => {
  it("keeps missing and non-numeric observations as gaps instead of zero", () => {
    expect(chartableIndicatorPoints(series)).toEqual([
      { observedAt: "2026-09-01T00:00:00.000Z", value: -12, quality: "verified", revision: 0 },
      { observedAt: "2026-09-08T00:00:00.000Z", value: null, quality: "provisional", revision: 1 },
      { observedAt: "2026-09-15T00:00:00.000Z", value: null, quality: "estimated", revision: 0 },
    ]);
    expect(hasChartableIndicatorValue(series)).toBe(true);
    expect(hasChartableIndicatorValue({ ...series, points: series.points.slice(1) })).toBe(false);
  });

  it("marks revised and provisional observations without changing their values", () => {
    const revised = { observedAt: "2026-09-01T00:00:00.000Z", value: 7, quality: "verified" as const, revision: 2 };
    const provisional = { observedAt: "2026-09-02T00:00:00.000Z", value: 9, quality: "provisional" as const, revision: 0 };
    const plain = { observedAt: "2026-09-03T00:00:00.000Z", value: 11, quality: "verified" as const, revision: 0 };

    expect(chartPointMarker(revised)).toMatchObject({ symbol: "diamond", label: "修订观测" });
    expect(chartPointMarker(provisional)).toMatchObject({ symbol: "emptyCircle", label: "暂定观测" });
    expect(chartPointMarker(plain)).toBeNull();
    expect(chartPointDataItem(revised)).toEqual({ value: 7, symbol: "diamond", symbolSize: 11 });
    expect(chartPointDataItem(provisional)).toEqual({ value: 9, symbol: "emptyCircle", symbolSize: 9 });
    expect(chartPointDataItem(plain)).toBe(11);
    expect(chartPointDataItem({ ...plain, value: null })).toBeNull();
    expect(chartMarkerLegend([revised, provisional, plain, revised])).toEqual(["修订观测", "暂定观测"]);
    expect(chartMarkerLegend([plain])).toEqual([]);
  });

  it("builds one unit-labelled series and never introduces a second axis", () => {
    const option = indicatorChartOption(series);

    expect(option.yAxis).toMatchObject({ type: "value", name: "%" });
    expect(option.series).toEqual([expect.objectContaining({
      type: "line",
      name: "泰南降水异常",
      data: [-12, null, null],
      connectNulls: false,
    })]);
    expect(Array.isArray(option.xAxis)).toBe(false);
    expect(Array.isArray(option.yAxis)).toBe(false);
  });
});
