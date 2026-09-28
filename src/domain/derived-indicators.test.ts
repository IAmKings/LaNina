import { describe, expect, it } from "vitest";

import {
  DERIVED_INDICATOR_DEFINITIONS,
  computeDerivedIndicator,
  computeRainAnomalyIndicator,
  latestCompletedCropWindow,
  marketYearVersusPriorMeanPercent,
  marketYearYearOverYearPercent,
  rainAnomalyPercent,
  rollingRainWindowEndingAt,
  type ClimatologyMonthPoint,
  type DerivedIndicatorDefinition,
  type MarketYearPoint,
  type RainfallDayPoint,
} from "./derived-indicators";

/**
 * MY 序列构造沿用 USDA FAS PSD 适配器的存储语义（2026-09-27 核实）：
 * 马来西亚棕榈油 MY 起点 10 月（observed_at = MY 期末日 9-30），南非玉米 MY 起点 5 月
 * （observed_at = MY 期末日次年 4-30）；period_start 日历年即 MY 标识。
 */
function palmMy(marketYear: number, value: number): MarketYearPoint {
  return {
    observedAt: `${marketYear + 1}-09-30T00:00:00.000Z`,
    periodStart: `${marketYear}-10-01T00:00:00.000Z`,
    value,
  };
}

function maizeMy(marketYear: number, value: number): MarketYearPoint {
  return {
    observedAt: `${marketYear + 1}-04-30T00:00:00.000Z`,
    periodStart: `${marketYear}-05-01T00:00:00.000Z`,
    value,
  };
}

describe("marketYearYearOverYearPercent", () => {
  it("computes the year-over-year percent against the previous marketing year", () => {
    // (2100 - 2400) / 2400 * 100 = -12.5%（去库 12.5%）
    expect(marketYearYearOverYearPercent([palmMy(2024, 2400), palmMy(2025, 2100)])).toEqual({
      observedAt: "2026-09-30T00:00:00.000Z",
      periodStart: "2025-10-01T00:00:00.000Z",
      value: -12.5,
    });
  });

  it("keeps the observed_at/period_start of the current marketing year exactly", () => {
    const result = marketYearYearOverYearPercent([maizeMy(2024, 1800), maizeMy(2025, 1500)]);
    expect(result).not.toBeNull();
    expect(result!.observedAt).toBe("2026-04-30T00:00:00.000Z");
    expect(result!.periodStart).toBe("2025-05-01T00:00:00.000Z");
  });

  it("does not rely on the input order", () => {
    const forward = marketYearYearOverYearPercent([palmMy(2023, 2000), palmMy(2024, 2200)]);
    const shuffled = marketYearYearOverYearPercent([palmMy(2024, 2200), palmMy(2023, 2000)]);
    expect(shuffled).toEqual(forward);
  });

  it("fails closed with fewer than two marketing years", () => {
    expect(marketYearYearOverYearPercent([])).toBeNull();
    expect(marketYearYearOverYearPercent([palmMy(2025, 2400)])).toBeNull();
  });

  it("fails closed when the previous marketing year is missing (gap)", () => {
    // MY2024 缺失：2023 与 2025 不连续，绝不静默用隔年做同比
    expect(marketYearYearOverYearPercent([palmMy(2023, 2000), palmMy(2025, 2100)])).toBeNull();
  });

  it("fails closed on a non-positive denominator or invalid values", () => {
    expect(marketYearYearOverYearPercent([palmMy(2024, 0), palmMy(2025, 100)])).toBeNull();
    expect(marketYearYearOverYearPercent([
      palmMy(2024, 100),
      palmMy(2025, Number.NaN),
    ])).toBeNull();
    expect(marketYearYearOverYearPercent([
      palmMy(2024, 100),
      palmMy(2025, Number.POSITIVE_INFINITY),
    ])).toBeNull();
  });

  it("fails closed when the same marketing year appears twice", () => {
    expect(marketYearYearOverYearPercent([
      palmMy(2024, 100),
      palmMy(2024, 110),
      palmMy(2025, 120),
    ])).toBeNull();
  });

  it("fails closed on an unparseable period_start", () => {
    expect(marketYearYearOverYearPercent([
      palmMy(2024, 100),
      { observedAt: "2026-09-30T00:00:00.000Z", periodStart: "not-a-date", value: 120 },
    ])).toBeNull();
  });

  it("still derives when the current value is zero but the denominator is positive", () => {
    const result = marketYearYearOverYearPercent([palmMy(2024, 100), palmMy(2025, 0)]);
    expect(result).toEqual({
      observedAt: "2026-09-30T00:00:00.000Z",
      periodStart: "2025-10-01T00:00:00.000Z",
      value: -100,
    });
  });
});

describe("marketYearVersusPriorMeanPercent", () => {
  it("compares the current marketing year against the mean of the five prior years", () => {
    // 五年均值 = (1800+1900+2000+2100+2200)/5 = 2000；(1700-2000)/2000*100 = -15%
    const series = [
      maizeMy(2020, 1800),
      maizeMy(2021, 1900),
      maizeMy(2022, 2000),
      maizeMy(2023, 2100),
      maizeMy(2024, 2200),
      maizeMy(2025, 1700),
    ];
    expect(marketYearVersusPriorMeanPercent(series, 5)).toEqual({
      observedAt: "2026-04-30T00:00:00.000Z",
      periodStart: "2025-05-01T00:00:00.000Z",
      value: -15,
    });
  });

  it("uses exactly the five most recent prior years when more history exists", () => {
    const series = [
      maizeMy(2018, 10_000),
      maizeMy(2019, 10_000),
      maizeMy(2020, 1800),
      maizeMy(2021, 1900),
      maizeMy(2022, 2000),
      maizeMy(2023, 2100),
      maizeMy(2024, 2200),
      maizeMy(2025, 1500),
    ];
    const result = marketYearVersusPriorMeanPercent(series, 5);
    expect(result).not.toBeNull();
    expect(result!.value).toBeCloseTo(((1500 - 2000) / 2000) * 100, 10);
  });

  it("fails closed when any of the five prior years is missing", () => {
    const series = [
      maizeMy(2020, 1800),
      // 2021 缺失
      maizeMy(2022, 2000),
      maizeMy(2023, 2100),
      maizeMy(2024, 2200),
      maizeMy(2025, 1700),
    ];
    expect(marketYearVersusPriorMeanPercent(series, 5)).toBeNull();
  });

  it("fails closed when fewer than the window plus the current year exist", () => {
    const series = [maizeMy(2023, 2100), maizeMy(2024, 2200), maizeMy(2025, 1700)];
    expect(marketYearVersusPriorMeanPercent(series, 5)).toBeNull();
  });

  it("fails closed when the window is non-contiguous even with enough rows", () => {
    const series = [
      maizeMy(2020, 1800),
      maizeMy(2021, 1900),
      maizeMy(2022, 2000),
      // 2023 缺失 → 2024 与 2020..2022 不连续
      maizeMy(2024, 2200),
      maizeMy(2025, 1700),
    ];
    expect(marketYearVersusPriorMeanPercent(series, 5)).toBeNull();
  });

  it("fails closed on a non-positive mean", () => {
    const series = [
      maizeMy(2020, 0),
      maizeMy(2021, 0),
      maizeMy(2022, 0),
      maizeMy(2023, 0),
      maizeMy(2024, 0),
      maizeMy(2025, 100),
    ];
    expect(marketYearVersusPriorMeanPercent(series, 5)).toBeNull();
  });

  it("rejects a non-integer or non-positive window size", () => {
    const series = [maizeMy(2024, 1), maizeMy(2025, 1)];
    expect(marketYearVersusPriorMeanPercent(series, 0)).toBeNull();
    expect(marketYearVersusPriorMeanPercent(series, 1.5)).toBeNull();
    expect(marketYearVersusPriorMeanPercent(series, -1)).toBeNull();
  });
});

describe("DERIVED_INDICATOR_DEFINITIONS", () => {
  it("keeps each derived indicator on the same parent source as its base indicator", () => {
    for (const definition of DERIVED_INDICATOR_DEFINITIONS) {
      expect(definition.derivedIndicatorId).not.toBe(definition.baseIndicatorId);
      // marketing-year 派生归 USDA 父源；降水距平派生与其日值基准、月气候态基准同归 NASA 父源。
      if (definition.computation.kind.startsWith("market_year")) {
        expect(definition.parentSourceId).toMatch(/usda_psd_/);
        expect(definition.climatologyIndicatorId).toBeNull();
      } else {
        expect(definition.parentSourceId).toMatch(/nasa_power_rainfall_/);
        expect(definition.climatologyIndicatorId).toMatch(/_rainfall_climatology_monthly$/);
      }
    }
  });

  it("registers exactly the five signed derived indicators", () => {
    expect(DERIVED_INDICATOR_DEFINITIONS.map(({ derivedIndicatorId }) => derivedIndicatorId)).toEqual([
      "usda_malaysia_palm_ending_stocks_yoy_pct",
      "sa_maize_production_vs_5yr_mean_pct",
      "thai_rain_anomaly_30d_pct",
      "sea_rain_anomaly_90d_pct",
      "sa_maize_rain_anomaly_crop_window_pct",
    ]);
  });

  it("computes each registered market-year definition through computeDerivedIndicator", () => {
    const [palmYoY, maizeFiveYear] = DERIVED_INDICATOR_DEFINITIONS;
    expect(computeDerivedIndicator(palmYoY!, [palmMy(2024, 2000), palmMy(2025, 1800)])).toEqual({
      observedAt: "2026-09-30T00:00:00.000Z",
      periodStart: "2025-10-01T00:00:00.000Z",
      value: -10,
    });
    expect(computeDerivedIndicator(
      maizeFiveYear!,
      [
        maizeMy(2020, 1800),
        maizeMy(2021, 1900),
        maizeMy(2022, 2000),
        maizeMy(2023, 2100),
        maizeMy(2024, 2200),
        maizeMy(2025, 1700),
      ],
    )).toEqual({
      observedAt: "2026-04-30T00:00:00.000Z",
      periodStart: "2025-05-01T00:00:00.000Z",
      value: -15,
    });
    // 历史不足 fail-closed
    expect(computeDerivedIndicator(palmYoY!, [palmMy(2025, 1800)])).toBeNull();
  });

  it("rejects rain anomaly computations through the market-year dispatcher", () => {
    const [thaiAnomaly] = DERIVED_INDICATOR_DEFINITIONS.filter(
      ({ derivedIndicatorId }) => derivedIndicatorId === "thai_rain_anomaly_30d_pct",
    );
    expect(() => computeDerivedIndicator(thaiAnomaly!, [])).toThrow(TypeError);
  });
});

/** 区域降水日观测构造：从窗口首日起逐日 base..base+days-1 mm/day（确定性浮点求和）。 */
function dailySeries(windowStart: string, days: number, base = 1): RainfallDayPoint[] {
  const startMs = Date.parse(`${windowStart}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => ({
    observedAt: `${new Date(startMs + index * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`,
    value: base + index,
  }));
}

/** 恒定日降水序列（mm/day），便于手算累计。 */
function constantDailySeries(windowStart: string, days: number, value: number): RainfallDayPoint[] {
  return dailySeries(windowStart, days).map((point) => ({ ...point, value }));
}

function sumDaily(daily: readonly RainfallDayPoint[]): number {
  return daily.reduce((total, point) => total + point.value, 0);
}

const CLIMATOLOGY_MM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function climatology(values: readonly number[] = CLIMATOLOGY_MM): ClimatologyMonthPoint[] {
  return values.map((value, index) => ({ month: index + 1, value }));
}

describe("rainAnomalyPercent", () => {
  it("weights the monthly climatology by each month's day count inside the window", () => {
    // 2026-02-01..2026-03-02：28 个 2 月日 + 2 个 3 月日（2026 非闰年）。
    const daily = dailySeries("2026-02-01", 30);
    const actual = sumDaily(daily);
    // 常年 = 2 月气候态 × 28 + 3 月气候态 × 2 = 2×28 + 3×2 = 62（mm/day 口径按日累加）。
    const result = rainAnomalyPercent(
      daily,
      climatology(),
      "2026-02-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    );
    expect(result).not.toBeNull();
    expect(result!.normalTotalMm).toBeCloseTo(2 * 28 + 3 * 2, 10);
    expect(result!.actualTotalMm).toBeCloseTo(actual, 10);
    expect(result!.value).toBeCloseTo(((actual - 62) / 62) * 100, 10);
    expect(result!.windowStart).toBe("2026-02-01T00:00:00.000Z");
    expect(result!.windowEnd).toBe("2026-03-02T00:00:00.000Z");
  });

  it("attributes a leap day to February without a FEB29 special case", () => {
    // 2028 闰年：02-01..03-01 = 29 个 2 月日 + 1 个 3 月日。
    const daily = dailySeries("2028-02-01", 30);
    const result = rainAnomalyPercent(
      daily,
      climatology(),
      "2028-02-01T00:00:00.000Z",
      "2028-03-01T00:00:00.000Z",
    );
    expect(result).not.toBeNull();
    expect(result!.normalTotalMm).toBeCloseTo(2 * 29 + 3, 10);
  });

  it("maps actual accumulation below the normal to a negative anomaly", () => {
    // 实际累计 31 mm 对常年 62 mm → 距平 −50%（偏干方向，签字阈值语义）。
    const result = rainAnomalyPercent(
      constantDailySeries("2026-02-01", 30, 31 / 30),
      climatology(),
      "2026-02-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    );
    expect(result).not.toBeNull();
    expect(result!.actualTotalMm).toBeCloseTo(31, 10);
    expect(result!.value).toBeCloseTo(-50, 6);
  });

  it("fails closed when any window day is missing from the base observations", () => {
    const daily = dailySeries("2026-02-01", 30).slice(1); // 缺窗口首日
    expect(rainAnomalyPercent(
      daily,
      climatology(),
      "2026-02-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    )).toBeNull();
  });

  it("fails closed on a duplicated UTC day or an out-of-window duplicate", () => {
    const duplicated = [...dailySeries("2026-02-01", 30)];
    duplicated[5] = duplicated[0]!;
    expect(rainAnomalyPercent(
      duplicated,
      climatology(),
      "2026-02-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    )).toBeNull();
  });

  it("fails closed unless the climatology is exactly twelve unique valid months", () => {
    const daily = dailySeries("2026-02-01", 30);
    const window = ["2026-02-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"] as const;
    expect(rainAnomalyPercent(daily, climatology(CLIMATOLOGY_MM.slice(1)), ...window)).toBeNull();
    expect(rainAnomalyPercent(daily, [...climatology(), { month: 3, value: 9 }], ...window)).toBeNull();
    expect(rainAnomalyPercent(daily, climatology(CLIMATOLOGY_MM.map((v) => -v)), ...window)).toBeNull();
    expect(rainAnomalyPercent(daily, climatology(CLIMATOLOGY_MM.map((v, i) => (i === 4 ? Number.NaN : v))), ...window)).toBeNull();
  });

  it("fails closed on a zero normal total (zero-denominator guard)", () => {
    const daily = dailySeries("2026-02-01", 30);
    expect(rainAnomalyPercent(
      daily,
      climatology(CLIMATOLOGY_MM.map(() => 0)),
      "2026-02-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    )).toBeNull();
  });

  it("fails closed on non-midnight or non-canonical window bounds", () => {
    const daily = dailySeries("2026-02-01", 30);
    expect(rainAnomalyPercent(daily, climatology(), "2026-02-01T12:00:00.000Z", "2026-03-02T00:00:00.000Z")).toBeNull();
    expect(rainAnomalyPercent(daily, climatology(), "2026-02-30T00:00:00.000Z", "2026-03-02T00:00:00.000Z")).toBeNull();
    expect(rainAnomalyPercent(daily, climatology(), "2026-03-02T00:00:00.000Z", "2026-02-01T00:00:00.000Z")).toBeNull();
  });

  it("rejects windows beyond the structural day guard", () => {
    const daily = dailySeries("2026-01-01", 401);
    expect(rainAnomalyPercent(daily, climatology(), "2026-01-01T00:00:00.000Z", "2027-02-05T00:00:00.000Z")).toBeNull();
  });
});

describe("latestCompletedCropWindow", () => {
  it("selects the November–March window that closed on or before the cutoff", () => {
    expect(latestCompletedCropWindow("2026-09-26T22:30:00.000Z")).toEqual({
      windowStart: "2025-11-01T00:00:00.000Z",
      windowEnd: "2026-03-31T00:00:00.000Z",
    });
    // 恰在期末日：窗口视为已完结。
    expect(latestCompletedCropWindow("2026-03-31T22:30:00.000Z")).toEqual({
      windowStart: "2025-11-01T00:00:00.000Z",
      windowEnd: "2026-03-31T00:00:00.000Z",
    });
    // 期末前一天：最近完结窗口是上一个跨年窗口。
    expect(latestCompletedCropWindow("2026-03-30T22:30:00.000Z")).toEqual({
      windowStart: "2024-11-01T00:00:00.000Z",
      windowEnd: "2025-03-31T00:00:00.000Z",
    });
    expect(latestCompletedCropWindow("2026-01-15T22:30:00.000Z")).toEqual({
      windowStart: "2024-11-01T00:00:00.000Z",
      windowEnd: "2025-03-31T00:00:00.000Z",
    });
  });

  it("fails closed on a non-canonical cutoff", () => {
    expect(latestCompletedCropWindow("2026-09-26 22:30:00")).toBeNull();
  });
});

describe("rollingRainWindowEndingAt", () => {
  it("builds an inclusive N-day window ending at the latest base observation", () => {
    expect(rollingRainWindowEndingAt("2026-09-05T00:00:00.000Z", 30)).toEqual({
      windowStart: "2026-08-07T00:00:00.000Z",
      windowEnd: "2026-09-05T00:00:00.000Z",
    });
    expect(rollingRainWindowEndingAt("2026-09-05T00:00:00.000Z", 1)).toEqual({
      windowStart: "2026-09-05T00:00:00.000Z",
      windowEnd: "2026-09-05T00:00:00.000Z",
    });
    expect(rollingRainWindowEndingAt("2026-09-05T00:00:00.000Z", 90)).toEqual({
      windowStart: "2026-06-08T00:00:00.000Z",
      windowEnd: "2026-09-05T00:00:00.000Z",
    });
  });

  it("fails closed on invalid day counts or timestamps", () => {
    expect(rollingRainWindowEndingAt("2026-09-05T00:00:00.000Z", 0)).toBeNull();
    expect(rollingRainWindowEndingAt("2026-09-05T00:00:00.000Z", 1.5)).toBeNull();
    expect(rollingRainWindowEndingAt("2026-09-05T00:00:00.000Z", 401)).toBeNull();
    expect(rollingRainWindowEndingAt("2026-09-05T12:00:00.000Z", 30)).toBeNull();
  });
});

describe("computeRainAnomalyIndicator", () => {
  const THAI_30D = DERIVED_INDICATOR_DEFINITIONS.find(
    ({ derivedIndicatorId }) => derivedIndicatorId === "thai_rain_anomaly_30d_pct",
  )! as DerivedIndicatorDefinition;
  const MAIZE_WINDOW = DERIVED_INDICATOR_DEFINITIONS.find(
    ({ derivedIndicatorId }) => derivedIndicatorId === "sa_maize_rain_anomaly_crop_window_pct",
  )! as DerivedIndicatorDefinition;

  it("derives the 30-day anomaly with the window ending at the latest daily observation", () => {
    const daily = dailySeries("2026-02-01", 30);
    const actual = sumDaily(daily);
    const result = computeRainAnomalyIndicator(THAI_30D, {
      daily,
      climatology: climatology(),
      cutoff: "2026-03-04T22:30:00.000Z",
    });
    expect(result).not.toBeNull();
    expect(result!.observedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(result!.periodStart).toBe("2026-02-01T00:00:00.000Z");
    expect(result!.actualTotalMm).toBeCloseTo(actual, 10);
    expect(result!.normalTotalMm).toBeCloseTo(62, 10);
    expect(result!.value).toBeCloseTo(((actual - 62) / 62) * 100, 10);
  });

  it("derives the cross-year crop window anomaly over a complete November–March series", () => {
    // 2025-11-01..2026-03-31 共 151 天（2026-02 为 28 天）；逐日 1 mm/day → 实际 151 mm。
    const daily = constantDailySeries("2025-11-01", 151, 1);
    // 常年 = 11 月气候态×30 + 12 月×31 + 1 月×31 + 2 月×28 + 3 月×31 = 330+372+31+56+93 = 882。
    const normal = 11 * 30 + 12 * 31 + 1 * 31 + 2 * 28 + 3 * 31;
    const result = computeRainAnomalyIndicator(MAIZE_WINDOW, {
      daily,
      climatology: climatology(),
      cutoff: "2026-09-26T22:30:00.000Z",
    });
    expect(result).toEqual({
      observedAt: "2026-03-31T00:00:00.000Z",
      periodStart: "2025-11-01T00:00:00.000Z",
      value: ((151 - normal) / normal) * 100,
      actualTotalMm: 151,
      normalTotalMm: normal,
    });
  });

  it("fails closed for an in-progress crop window whose base data cannot cover it", () => {
    // 窗口进行中（1 月）：目标窗口是上一个跨年窗口，日观测只有当年 1 月 → 缺口 fail-closed，
    // 绝不产出半窗观测（未完结窗口不产出，签字口径）。
    expect(computeRainAnomalyIndicator(MAIZE_WINDOW, {
      daily: dailySeries("2026-01-01", 15),
      climatology: climatology(),
      cutoff: "2026-01-15T22:30:00.000Z",
    })).toBeNull();
  });

  it("fails closed on empty daily series or incomplete climatology", () => {
    expect(computeRainAnomalyIndicator(THAI_30D, {
      daily: [],
      climatology: climatology(),
      cutoff: "2026-03-04T22:30:00.000Z",
    })).toBeNull();
    expect(computeRainAnomalyIndicator(THAI_30D, {
      daily: dailySeries("2026-02-01", 30),
      climatology: climatology(CLIMATOLOGY_MM.slice(0, 11)),
      cutoff: "2026-03-04T22:30:00.000Z",
    })).toBeNull();
  });
});
