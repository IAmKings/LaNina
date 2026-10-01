import { describe, expect, it } from "vitest";

import type { DerivedIndicatorDefinition } from "../../domain/derived-indicators";
import {
  DerivedIndicatorRecalculationJob,
  type ClimatologyBaseObservation,
  type DerivedIndicatorRepository,
  type DerivedObservationWrite,
  type MarketYearBaseObservation,
  type PersistedDerivedObservation,
  type RainfallBaseObservation,
} from "./derived-indicators";

const SCHEDULED_AT = "2026-09-26T22:30:00.000Z";

const PALM_YOY: DerivedIndicatorDefinition = {
  derivedIndicatorId: "usda_malaysia_palm_ending_stocks_yoy_pct",
  baseIndicatorId: "usda_psd_malaysia_palm_oil_ending_stocks_1000mt",
  climatologyIndicatorId: null,
  parentSourceId: "usda_psd_malaysia_palm_oil",
  computation: { kind: "market_year_yoy_pct" },
};

const MAIZE_MEAN: DerivedIndicatorDefinition = {
  derivedIndicatorId: "sa_maize_production_vs_5yr_mean_pct",
  baseIndicatorId: "usda_psd_south_africa_corn_production_1000mt",
  climatologyIndicatorId: null,
  parentSourceId: "usda_psd_south_africa_corn",
  computation: { kind: "market_year_vs_prior_mean_pct", priorYears: 5 },
};

const THAI_30D: DerivedIndicatorDefinition = {
  derivedIndicatorId: "thai_rain_anomaly_30d_pct",
  baseIndicatorId: "regional_rainfall_southern_thailand_rubber_v1",
  climatologyIndicatorId: "thai_rainfall_climatology_monthly",
  parentSourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
  computation: { kind: "rain_anomaly_rolling_days", windowDays: 30 },
};

function baseRow(overrides: Partial<MarketYearBaseObservation> & {
  observedAt: string;
  periodStart: string;
  value: number;
}): MarketYearBaseObservation {
  return {
    observationId: `obs-${overrides.periodStart}`,
    unit: "1000 MT",
    revision: 0,
    sourceRunId: "run-parent",
    sourceId: "usda_psd_malaysia_palm_oil",
    runSourceId: "usda_psd_malaysia_palm_oil",
    citationUrl: "https://api.fas.usda.gov/api/psd/fixture",
    ...overrides,
  };
}

function palmSeries(): readonly MarketYearBaseObservation[] {
  return [
    baseRow({
      observedAt: "2025-09-30T00:00:00.000Z",
      periodStart: "2024-10-01T00:00:00.000Z",
      value: 2400,
    }),
    baseRow({
      observedAt: "2026-09-30T00:00:00.000Z",
      periodStart: "2025-10-01T00:00:00.000Z",
      value: 2100,
      revision: 2,
    }),
  ];
}

class FakeRepository implements DerivedIndicatorRepository {
  readonly loaded: { baseIndicatorId: string; cutoff: string }[] = [];
  readonly climatologyLoaded: { climatologyIndicatorId: string; cutoff: string }[] = [];
  readonly persisted: (readonly DerivedObservationWrite[])[] = [];

  constructor(
    private readonly series: ReadonlyMap<string, readonly MarketYearBaseObservation[]> = new Map(),
    private readonly persistResults: readonly PersistedDerivedObservation[] = [],
    private readonly verbatimPersistResults = false,
    private readonly dailySeries: ReadonlyMap<string, readonly RainfallBaseObservation[]> = new Map(),
    private readonly climatologySeries: ReadonlyMap<string, readonly ClimatologyBaseObservation[]> = new Map(),
  ) {}

  async loadMarketYearBaseSeries(
    baseIndicatorId: string,
    cutoff: string,
  ): Promise<readonly MarketYearBaseObservation[]> {
    this.loaded.push({ baseIndicatorId, cutoff });
    return this.series.get(baseIndicatorId) ?? [];
  }

  async loadRecentRainfallSeries(
    baseIndicatorId: string,
    cutoff: string,
  ): Promise<readonly RainfallBaseObservation[]> {
    this.loaded.push({ baseIndicatorId, cutoff });
    return this.dailySeries.get(baseIndicatorId) ?? [];
  }

  async loadClimatologySeries(
    climatologyIndicatorId: string,
    cutoff: string,
  ): Promise<readonly ClimatologyBaseObservation[]> {
    this.climatologyLoaded.push({ climatologyIndicatorId, cutoff });
    return this.climatologySeries.get(climatologyIndicatorId) ?? [];
  }

  async persistDerivedObservations(
    writes: readonly DerivedObservationWrite[],
  ): Promise<readonly PersistedDerivedObservation[]> {
    this.persisted.push(writes);
    if (this.verbatimPersistResults) return this.persistResults;
    return writes.map((_, index) => this.persistResults[index] ?? "written");
  }
}

describe("DerivedIndicatorRecalculationJob", () => {
  it("loads each base series at the scheduled cutoff and persists derived writes", async () => {
    const repository = new FakeRepository(new Map([
      [PALM_YOY.baseIndicatorId, palmSeries()],
      [MAIZE_MEAN.baseIndicatorId, []],
    ]));
    const result = await new DerivedIndicatorRecalculationJob(repository, [PALM_YOY, MAIZE_MEAN])
      .run({ scheduledAt: SCHEDULED_AT });

    expect(repository.loaded).toEqual([
      { baseIndicatorId: PALM_YOY.baseIndicatorId, cutoff: SCHEDULED_AT },
      { baseIndicatorId: MAIZE_MEAN.baseIndicatorId, cutoff: SCHEDULED_AT },
    ]);
    expect(result.scheduledAt).toBe(SCHEDULED_AT);
    expect(result.outcomes).toEqual([
      {
        derivedIndicatorId: PALM_YOY.derivedIndicatorId,
        status: "written",
        observedAt: "2026-09-30T00:00:00.000Z",
        value: -12.5,
      },
      {
        derivedIndicatorId: MAIZE_MEAN.derivedIndicatorId,
        status: "insufficient_history",
        observedAt: null,
        value: null,
      },
    ]);

    expect(repository.persisted).toHaveLength(1);
    const [write] = repository.persisted[0]!;
    expect(write).toMatchObject({
      derivedIndicatorId: "usda_malaysia_palm_ending_stocks_yoy_pct",
      observedAt: "2026-09-30T00:00:00.000Z",
      periodStart: "2025-10-01T00:00:00.000Z",
      value: -12.5,
      unit: "%",
      sourceRunId: "run-parent",
      citationUrl: "https://api.fas.usda.gov/api/psd/fixture",
    });
    expect(write!.metadata).toEqual({
      computation: "market_year_yoy_pct",
      baseIndicatorId: PALM_YOY.baseIndicatorId,
      baseObservationId: "obs-2025-10-01T00:00:00.000Z",
      baseRevision: 2,
      marketYear: 2025,
      currentValue: 2100,
      priorObservations: [{
        observationId: "obs-2024-10-01T00:00:00.000Z",
        revision: 0,
        marketYear: 2024,
        value: 2400,
      }],
    });
  });

  it("reports unchanged when persistence skipped an identical derived value", async () => {
    const repository = new FakeRepository(
      new Map([[PALM_YOY.baseIndicatorId, palmSeries()]]),
      ["skipped_unchanged"],
    );
    const result = await new DerivedIndicatorRecalculationJob(repository, [PALM_YOY])
      .run({ scheduledAt: SCHEDULED_AT });
    expect(result.outcomes).toEqual([{
      derivedIndicatorId: PALM_YOY.derivedIndicatorId,
      status: "unchanged",
      observedAt: "2026-09-30T00:00:00.000Z",
      value: -12.5,
    }]);
  });

  it("persists nothing when every definition lacks sufficient history", async () => {
    const repository = new FakeRepository(new Map());
    const result = await new DerivedIndicatorRecalculationJob(repository, [PALM_YOY, MAIZE_MEAN])
      .run({ scheduledAt: SCHEDULED_AT });
    expect(repository.persisted).toHaveLength(0);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "insufficient_history",
      "insufficient_history",
    ]);
  });

  it("fails closed with SCHEMA_DRIFT when a base observation belongs to another source", async () => {
    const mismatched = palmSeries().map((row) => ({ ...row, runSourceId: "usda_psd_south_africa_corn" }));
    const repository = new FakeRepository(new Map([[PALM_YOY.baseIndicatorId, mismatched]]));
    await expect(
      new DerivedIndicatorRecalculationJob(repository, [PALM_YOY]).run({ scheduledAt: SCHEDULED_AT }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT", name: "DerivedIndicatorError" });
  });

  it("fails closed with SCHEMA_DRIFT when the base indicator itself sits on another source", async () => {
    const mismatched = palmSeries().map((row) => ({ ...row, sourceId: "some_other_source" }));
    const repository = new FakeRepository(new Map([[PALM_YOY.baseIndicatorId, mismatched]]));
    await expect(
      new DerivedIndicatorRecalculationJob(repository, [PALM_YOY]).run({ scheduledAt: SCHEDULED_AT }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });

  it("fails closed with DATABASE when persistence reports an unexpected result count", async () => {
    const repository = new FakeRepository(
      new Map([[PALM_YOY.baseIndicatorId, palmSeries()]]),
      [],
      true,
    );
    await expect(
      new DerivedIndicatorRecalculationJob(repository, [PALM_YOY]).run({ scheduledAt: SCHEDULED_AT }),
    ).rejects.toMatchObject({ code: "DATABASE", name: "DerivedIndicatorError" });
  });

  it("rejects a non-canonical scheduledAt", async () => {
    const repository = new FakeRepository(new Map());
    await expect(
      new DerivedIndicatorRecalculationJob(repository, [PALM_YOY])
        .run({ scheduledAt: "2026-09-26 22:30:00" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

/** NASA 日观测行构造：period_start = observed_at = 该日，mm/day。 */
function dailyRow(day: string, value: number, overrides: Partial<RainfallBaseObservation> = {}): RainfallBaseObservation {
  return {
    observationId: `daily-${day}`,
    observedAt: `${day}T00:00:00.000Z`,
    periodStart: `${day}T00:00:00.000Z`,
    value,
    unit: "mm/day",
    revision: 0,
    sourceRunId: "run-nasa",
    sourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    runSourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    citationUrl: "https://power.larc.nasa.gov/api/temporal/daily/point?fixture",
    ...overrides,
  };
}

function dailyDays(windowStartDay: string, days: number, value: number): RainfallBaseObservation[] {
  const startMs = Date.parse(`${windowStartDay}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) =>
    dailyRow(new Date(startMs + index * 86_400_000).toISOString().slice(0, 10), value));
}

/** 月序气候态行（存储语义：observed_at = 2020-MM-15）。 */
function climatologyRow(month: number, value: number): ClimatologyBaseObservation {
  return {
    observationId: `clim-${month}`,
    month,
    value,
    revision: 0,
    sourceRunId: "run-nasa",
    sourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    runSourceId: "nasa_power_rainfall_southern_thailand_rubber_v1",
    citationUrl: "https://power.larc.nasa.gov/api/temporal/climatology/point?fixture",
  };
}

function climatologyMonths12(value: number): ClimatologyBaseObservation[] {
  return Array.from({ length: 12 }, (_, index) => climatologyRow(index + 1, value));
}

describe("DerivedIndicatorRecalculationJob rain anomaly (Round 2)", () => {
  it("derives the 30-day rolling anomaly from daily rainfall plus the monthly climatology", async () => {
    // 窗口 2026-02-01..2026-03-02：常年 = 2 月气候态×28 + 3 月×2；实际 = 30 天恒定 0.5。
    const repository = new FakeRepository(
      new Map(),
      [],
      false,
      new Map([[THAI_30D.baseIndicatorId, dailyDays("2026-02-01", 30, 0.5)]]),
      new Map([[THAI_30D.climatologyIndicatorId ?? "", climatologyMonths12(1)]]),
    );
    const result = await new DerivedIndicatorRecalculationJob(repository, [THAI_30D])
      .run({ scheduledAt: SCHEDULED_AT });

    expect(result.outcomes).toEqual([{
      derivedIndicatorId: THAI_30D.derivedIndicatorId,
      status: "written",
      observedAt: "2026-03-02T00:00:00.000Z",
      value: ((0.5 * 30) - 30) / 30 * 100,
    }]);
    expect(repository.loaded).toEqual([
      { baseIndicatorId: THAI_30D.baseIndicatorId, cutoff: SCHEDULED_AT },
    ]);
    expect(repository.climatologyLoaded).toEqual([{
      climatologyIndicatorId: THAI_30D.climatologyIndicatorId,
      cutoff: SCHEDULED_AT,
    }]);

    const [write] = repository.persisted[0]!;
    expect(write).toMatchObject({
      derivedIndicatorId: THAI_30D.derivedIndicatorId,
      observedAt: "2026-03-02T00:00:00.000Z",
      periodStart: "2026-02-01T00:00:00.000Z",
      unit: "%",
      fetchedAt: SCHEDULED_AT,
      sourceRunId: "run-nasa",
    });
    expect(write.metadata).toEqual({
      computation: "rain_anomaly_rolling_days:30",
      baseIndicatorId: THAI_30D.baseIndicatorId,
      baseObservationId: "daily-2026-03-02",
      baseRevision: 0,
      windowStart: "2026-02-01T00:00:00.000Z",
      windowEnd: "2026-03-02T00:00:00.000Z",
      actualTotalMm: 15,
      normalTotalMm: 30,
      climatologyIndicatorId: THAI_30D.climatologyIndicatorId,
    });
  });

  it("fails closed as insufficient_history when the climatology lacks twelve months", async () => {
    const repository = new FakeRepository(
      new Map(),
      [],
      false,
      new Map([[THAI_30D.baseIndicatorId, dailyDays("2026-02-01", 30, 0.5)]]),
      new Map([[THAI_30D.climatologyIndicatorId ?? "", climatologyMonths12(1).slice(1)]]),
    );
    const result = await new DerivedIndicatorRecalculationJob(repository, [THAI_30D])
      .run({ scheduledAt: SCHEDULED_AT });
    expect(result.outcomes).toEqual([{
      derivedIndicatorId: THAI_30D.derivedIndicatorId,
      status: "insufficient_history",
      observedAt: null,
      value: null,
    }]);
    expect(repository.persisted).toHaveLength(0);
  });

  it("fails closed as insufficient_history when window base days are missing", async () => {
    const repository = new FakeRepository(
      new Map(),
      [],
      false,
      new Map([[THAI_30D.baseIndicatorId, dailyDays("2026-02-02", 29, 0.5)]]),
      new Map([[THAI_30D.climatologyIndicatorId ?? "", climatologyMonths12(1)]]),
    );
    const result = await new DerivedIndicatorRecalculationJob(repository, [THAI_30D])
      .run({ scheduledAt: SCHEDULED_AT });
    expect(result.outcomes.map(({ status }) => status)).toEqual(["insufficient_history"]);
  });

  it("fails closed with SCHEMA_DRIFT when a climatology row belongs to another source", async () => {
    const repository = new FakeRepository(
      new Map(),
      [],
      false,
      new Map([[THAI_30D.baseIndicatorId, dailyDays("2026-02-01", 30, 0.5)]]),
      new Map([[
        THAI_30D.climatologyIndicatorId ?? "",
        climatologyMonths12(1).map((row) => ({ ...row, runSourceId: "usda_psd_malaysia_palm_oil" })),
      ]]),
    );
    await expect(
      new DerivedIndicatorRecalculationJob(repository, [THAI_30D]).run({ scheduledAt: SCHEDULED_AT }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT", name: "DerivedIndicatorError" });
  });

  it("fails closed with SCHEMA_DRIFT when a rain anomaly definition declares no climatology", async () => {
    const broken: DerivedIndicatorDefinition = { ...THAI_30D, climatologyIndicatorId: null };
    const repository = new FakeRepository(
      new Map(),
      [],
      false,
      new Map([[THAI_30D.baseIndicatorId, dailyDays("2026-02-01", 30, 0.5)]]),
    );
    await expect(
      new DerivedIndicatorRecalculationJob(repository, [broken]).run({ scheduledAt: SCHEDULED_AT }),
    ).rejects.toMatchObject({ code: "SCHEMA_DRIFT" });
  });

  it("derives nothing (insufficient_history) when the daily series is empty", async () => {
    const repository = new FakeRepository(
      new Map(),
      [],
      false,
      new Map(),
      new Map([[THAI_30D.climatologyIndicatorId ?? "", climatologyMonths12(1)]]),
    );
    const result = await new DerivedIndicatorRecalculationJob(repository, [THAI_30D])
      .run({ scheduledAt: SCHEDULED_AT });
    expect(result.outcomes.map(({ status }) => status)).toEqual(["insufficient_history"]);
    expect(repository.persisted).toHaveLength(0);
  });
});
