// 派生指标（L0 机制）真实 SQLite 回归：迁移 0014、幂等写入（同值 skip / 变值新 revision
// + supersedes）、缺失 marketing-year 的 fail-closed、以及评估管道对派生观测的消费链路
// （loadEvaluationInputs 以 run.source_id = indicators.source_id 连接派生观测与其父源）。
// 建库/造数方式与 ingestion-write-paths-real-sqlite 一致。
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { DerivedIndicatorRecalculationJob } from "../../modules/derived-indicators";
import { D1DailyScheduleRepository } from "./cloudflare-daily-schedule";
import { D1DerivedIndicatorRepository } from "./cloudflare-derived-indicators";
import { SqliteD1, applyMigrations, applyBaseSeeds, readRepoFile } from "./testing/sqlite-d1.mjs";

const SCHEDULED_AT = "2026-09-26T22:30:00.000Z";
const RAIN_WITHOUT_SERIES = [
  "thai_rain_anomaly_30d_pct",
  "sea_rain_anomaly_90d_pct",
  "sa_maize_rain_anomaly_crop_window_pct",
].map((derivedIndicatorId) => ({
  derivedIndicatorId,
  status: "insufficient_history",
  observedAt: null,
  value: null,
}));
const CITED = "https://api.fas.usda.gov/api/psd/commodity/fixture";
const PALM_DERIVED = "usda_malaysia_palm_ending_stocks_yoy_pct";
const MAIZE_DERIVED = "sa_maize_production_vs_5yr_mean_pct";
const PALM_BASE = "usda_psd_malaysia_palm_oil_ending_stocks_1000mt";
const MAIZE_BASE = "usda_psd_south_africa_corn_production_1000mt";

const DERIVED_INDICATOR_IDS = [
  "thai_rain_anomaly_30d_pct",
  "sea_rain_anomaly_90d_pct",
  PALM_DERIVED,
  MAIZE_DERIVED,
  "sa_maize_rain_anomaly_crop_window_pct",
  "thai_rainfall_climatology_monthly",
  "sea_rainfall_climatology_monthly",
  "sa_maize_rainfall_climatology_monthly",
  "panama_rainfall_climatology_monthly",
];

const databases = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function freshDb({ seeds = true } = {}) {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  applyMigrations(db);
  if (seeds) {
    applyBaseSeeds(db);
    // 派生指标行带 WHERE EXISTS 父源守卫：种子之后重跑 0014 才会落行（无种子的裸库上
    // 是 no-op，不触发外键失败）。重跑两次验证 INSERT OR IGNORE 幂等。
    db.exec(readRepoFile("migrations/0014_derived_indicators.sql"));
  }
  return db;
}

function asD1(db) {
  return new SqliteD1(db).asDatabase();
}

function derivedJob(db) {
  return new DerivedIndicatorRecalculationJob(new D1DerivedIndicatorRepository(asD1(db)));
}

function insertRun(db, { id, sourceId, scheduledAt, finishedAt }) {
  db.prepare(
    `INSERT INTO source_runs (
       id, source_id, scheduled_at, started_at, finished_at, status,
       observations_inserted, observations_revised
     ) VALUES (?, ?, ?, ?, ?, 'success', 3, 0)`,
  ).run(id, sourceId, scheduledAt, scheduledAt, finishedAt);
}

function insertBaseObservation(db, { id, indicatorId, observedAt, periodStart, value, runId, marketYear, attributeId = 176, fetchedAt = "2026-09-20T18:17:01.000Z", revision = 0 }) {
  db.prepare(
    `INSERT INTO observations (
       id, indicator_id, observed_at, period_start, value_num, value_text,
       unit, published_at, fetched_at, revision, supersedes_id, quality,
       source_run_id, citation_url, metadata_json
     ) VALUES (?, ?, ?, ?, ?, NULL, '1000 MT', NULL, ?, ?, NULL, 'estimated', ?, ?, ?)`,
  ).run(
    id,
    indicatorId,
    observedAt,
    periodStart,
    value,
    fetchedAt,
    revision,
    runId,
    CITED,
    JSON.stringify({ attributeName: "fixture", marketYear, attributeId }),
  );
}

/** 与适配器存储语义一致（2026-09-27 核实）：棕榈 MY 起点 10 月、玉米 MY 起点 5 月。 */
function palmStocks(db, marketYear, value, runId) {
  insertBaseObservation(db, {
    id: `palm-stocks-my${marketYear}`,
    indicatorId: PALM_BASE,
    observedAt: `${marketYear + 1}-09-30T00:00:00.000Z`,
    periodStart: `${marketYear}-10-01T00:00:00.000Z`,
    value,
    runId,
    marketYear,
  });
}

function maizeProduction(db, marketYear, value, runId) {
  insertBaseObservation(db, {
    id: `maize-prod-my${marketYear}`,
    indicatorId: MAIZE_BASE,
    observedAt: `${marketYear + 1}-04-30T00:00:00.000Z`,
    periodStart: `${marketYear}-05-01T00:00:00.000Z`,
    value,
    runId,
    marketYear,
    attributeId: 28,
  });
}

function seedUsdaHistory(db) {
  insertRun(db, {
    id: "run-palm-2026",
    sourceId: "usda_psd_malaysia_palm_oil",
    scheduledAt: "2026-09-20T18:17:00.000Z",
    finishedAt: "2026-09-26T18:17:00.000Z",
  });
  insertRun(db, {
    id: "run-corn-2026",
    sourceId: "usda_psd_south_africa_corn",
    scheduledAt: "2026-09-20T18:17:00.000Z",
    finishedAt: "2026-09-26T18:17:00.000Z",
  });
  palmStocks(db, 2023, 2000, "run-palm-2026");
  palmStocks(db, 2024, 2400, "run-palm-2026");
  palmStocks(db, 2025, 2100, "run-palm-2026");
  maizeProduction(db, 2020, 1800, "run-corn-2026");
  maizeProduction(db, 2021, 1900, "run-corn-2026");
  maizeProduction(db, 2022, 2000, "run-corn-2026");
  maizeProduction(db, 2023, 2100, "run-corn-2026");
  maizeProduction(db, 2024, 2200, "run-corn-2026");
  maizeProduction(db, 2025, 1700, "run-corn-2026");
}

function derivedRows(db, indicatorId) {
  return db.prepare(
    `SELECT id, observed_at, period_start, value_num, unit, quality, revision,
            supersedes_id, source_run_id, citation_url, fetched_at, metadata_json
       FROM observations
      WHERE indicator_id = ?
      ORDER BY revision`,
  ).all(indicatorId);
}

describe("0014 derived indicator migration", () => {
  it("creates exactly the nine derived/climatology indicator rows on a seeded database", () => {
    const db = freshDb();
    const rows = db.prepare(
      `SELECT id, unit, public, source_id FROM indicators WHERE id IN (${DERIVED_INDICATOR_IDS.map(() => "?").join(", ")})`,
    ).all(...DERIVED_INDICATOR_IDS);
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.public).toBe(1);
      expect(row.unit === "%" || row.unit === "mm/day").toBe(true);
    }
    expect(rows.filter((row) => row.unit === "mm/day")).toHaveLength(4);
  });

  it("is idempotent when re-applied on a seeded database", () => {
    const db = freshDb();
    db.exec(readRepoFile("migrations/0014_derived_indicators.sql"));
    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM indicators WHERE id IN (${DERIVED_INDICATOR_IDS.map(() => "?").join(", ")})`,
    ).get(...DERIVED_INDICATOR_IDS).n;
    expect(count).toBe(9);
  });

  it("stays a no-op on a migrations-only database without the parent sources", () => {
    const db = freshDb({ seeds: false });
    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM indicators WHERE id IN (${DERIVED_INDICATOR_IDS.map(() => "?").join(", ")})`,
    ).get(...DERIVED_INDICATOR_IDS).n;
    expect(count).toBe(0);
  });
});

describe("derived indicator recalculation on real SQLite", () => {
  it("derives USDA marketing-year observations with base storage semantics", async () => {
    const db = freshDb();
    seedUsdaHistory(db);

    const result = await derivedJob(db).run({ scheduledAt: SCHEDULED_AT });
    expect(result.outcomes).toEqual([
      {
        derivedIndicatorId: PALM_DERIVED,
        status: "written",
        observedAt: "2026-09-30T00:00:00.000Z",
        value: -12.5,
      },
      {
        derivedIndicatorId: MAIZE_DERIVED,
        status: "written",
        observedAt: "2026-04-30T00:00:00.000Z",
        value: -15,
      },
      ...RAIN_WITHOUT_SERIES,
    ]);

    const [palm] = derivedRows(db, PALM_DERIVED);
    expect(palm).toMatchObject({
      observed_at: "2026-09-30T00:00:00.000Z",
      period_start: "2025-10-01T00:00:00.000Z",
      value_num: -12.5,
      unit: "%",
      quality: "verified",
      revision: 0,
      supersedes_id: null,
      source_run_id: "run-palm-2026",
      citation_url: CITED,
      fetched_at: SCHEDULED_AT,
    });
    expect(JSON.parse(palm.metadata_json)).toMatchObject({
      computation: "market_year_yoy_pct",
      baseIndicatorId: PALM_BASE,
      baseObservationId: "palm-stocks-my2025",
      marketYear: 2025,
      currentValue: 2100,
    });
    expect(JSON.parse(palm.metadata_json).priorObservations).toHaveLength(1);

    const [maize] = derivedRows(db, MAIZE_DERIVED);
    expect(maize).toMatchObject({
      observed_at: "2026-04-30T00:00:00.000Z",
      period_start: "2025-05-01T00:00:00.000Z",
      value_num: -15,
      unit: "%",
      quality: "verified",
      revision: 0,
      source_run_id: "run-corn-2026",
    });
    expect(JSON.parse(maize.metadata_json)).toMatchObject({
      computation: "market_year_vs_prior_mean_pct:5",
      marketYear: 2025,
    });
    expect(JSON.parse(maize.metadata_json).priorObservations).toHaveLength(5);

    // 派生不创建 source_runs 行、不触碰来源运行账本。
    expect(db.prepare("SELECT COUNT(*) AS n FROM source_runs").get().n).toBe(2);
  });

  it("skips unchanged derived values on the second run", async () => {
    const db = freshDb();
    seedUsdaHistory(db);
    const job = derivedJob(db);
    await job.run({ scheduledAt: SCHEDULED_AT });
    const second = await job.run({ scheduledAt: "2026-09-27T22:30:00.000Z" });

    expect(second.outcomes.map((outcome) => outcome.status)).toEqual([
      "unchanged",
      "unchanged",
      "insufficient_history",
      "insufficient_history",
      "insufficient_history",
    ]);
    expect(derivedRows(db, PALM_DERIVED)).toHaveLength(1);
    expect(derivedRows(db, MAIZE_DERIVED)).toHaveLength(1);
  });

  it("appends a derived revision with supersedes when a base value changes", async () => {
    const db = freshDb();
    seedUsdaHistory(db);
    const job = derivedJob(db);
    await job.run({ scheduledAt: SCHEDULED_AT });
    const original = derivedRows(db, MAIZE_DERIVED)[0];

    // USDA 新月度发布修订当期 MY 产量估计：1700 → 1360（同观测期新 revision）。
    insertRun(db, {
      id: "run-corn-2026b",
      sourceId: "usda_psd_south_africa_corn",
      scheduledAt: "2026-09-27T18:17:00.000Z",
      finishedAt: "2026-09-27T18:17:00.000Z",
    });
    insertBaseObservation(db, {
      id: "maize-prod-my2025-rev1",
      indicatorId: MAIZE_BASE,
      observedAt: "2026-04-30T00:00:00.000Z",
      periodStart: "2025-05-01T00:00:00.000Z",
      value: 1360,
      runId: "run-corn-2026b",
      marketYear: 2025,
      attributeId: 28,
      fetchedAt: "2026-09-27T18:17:01.000Z",
      revision: 1,
    });

    const third = await job.run({ scheduledAt: "2026-09-27T22:30:00.000Z" });
    expect(third.outcomes).toEqual([
      expect.objectContaining({ derivedIndicatorId: PALM_DERIVED, status: "unchanged" }),
      expect.objectContaining({ derivedIndicatorId: MAIZE_DERIVED, status: "written", value: -32 }),
      ...RAIN_WITHOUT_SERIES,
    ]);

    const revisions = derivedRows(db, MAIZE_DERIVED);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({
      value_num: -32,
      revision: 1,
      supersedes_id: original.id,
      fetched_at: "2026-09-27T22:30:00.000Z",
    });
  });

  it("fails closed without writing when a marketing year is missing", async () => {
    const db = freshDb();
    seedUsdaHistory(db);
    const job = derivedJob(db);
    await job.run({ scheduledAt: SCHEDULED_AT });
    const before = derivedRows(db, MAIZE_DERIVED);

    // 2021 缺失 + 当期值变化：宁可无派生观测，也不静默降级为「可用年份的均值」。
    db.prepare("DELETE FROM observations WHERE id = 'maize-prod-my2021'").run();
    insertRun(db, {
      id: "run-corn-2026c",
      sourceId: "usda_psd_south_africa_corn",
      scheduledAt: "2026-09-28T18:17:00.000Z",
      finishedAt: "2026-09-28T18:17:00.000Z",
    });
    insertBaseObservation(db, {
      id: "maize-prod-my2025-rev1",
      indicatorId: MAIZE_BASE,
      observedAt: "2026-04-30T00:00:00.000Z",
      periodStart: "2025-05-01T00:00:00.000Z",
      value: 1000,
      runId: "run-corn-2026c",
      marketYear: 2025,
      attributeId: 28,
      fetchedAt: "2026-09-28T18:17:01.000Z",
      revision: 1,
    });

    const rerun = await job.run({ scheduledAt: "2026-09-28T22:30:00.000Z" });
    expect(rerun.outcomes).toEqual([
      expect.objectContaining({ derivedIndicatorId: PALM_DERIVED, status: "unchanged" }),
      expect.objectContaining({
        derivedIndicatorId: MAIZE_DERIVED,
        status: "insufficient_history",
        value: null,
      }),
      ...RAIN_WITHOUT_SERIES,
    ]);
    expect(derivedRows(db, MAIZE_DERIVED)).toEqual(before);
  });

  it("excludes periods whose latest revision is invalid and keeps series order ascending", async () => {
    const db = freshDb();
    seedUsdaHistory(db);
    const repository = new D1DerivedIndicatorRepository(asD1(db));

    const series = await repository.loadMarketYearBaseSeries(PALM_BASE, SCHEDULED_AT);
    expect(series.map((row) => row.observedAt)).toEqual([
      "2024-09-30T00:00:00.000Z",
      "2025-09-30T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    ]);
    expect(series.at(-1)).toMatchObject({ value: 2100, revision: 0, runSourceId: "usda_psd_malaysia_palm_oil" });

    db.prepare(
      `UPDATE observations SET quality = 'invalid' WHERE id = 'palm-stocks-my2024'`,
    ).run();
    const filtered = await repository.loadMarketYearBaseSeries(PALM_BASE, SCHEDULED_AT);
    expect(filtered.map((row) => row.observedAt)).toEqual([
      "2024-09-30T00:00:00.000Z",
      "2026-09-30T00:00:00.000Z",
    ]);
  });

  it("feeds derived observations into the daily evaluation inputs", async () => {
    const db = freshDb();
    seedUsdaHistory(db);
    await derivedJob(db).run({ scheduledAt: SCHEDULED_AT });

    const repository = new D1DailyScheduleRepository(asD1(db));
    const seed = {
      id: "PALM-SEA-01",
      indicatorSelectors: [{
        id: "test-derived-selector",
        indicatorId: PALM_DERIVED,
        layer: "balance",
        defaultStance: "supports",
        weight: 50,
        reviewStatus: "approved",
        active: true,
        notes: "derived chain test selector",
      }],
    };
    const [input] = await repository.loadEvaluationInputs([seed], SCHEDULED_AT);

    expect(input.evidence).toHaveLength(1);
    expect(input.evidence[0]).toMatchObject({
      observationId: expect.any(String),
      indicatorId: PALM_DERIVED,
      sourceId: "usda_psd_malaysia_palm_oil",
      sourceRunId: "run-palm-2026",
      value: -12.5,
      unit: "%",
      quality: "verified",
      observedAt: "2026-09-30T00:00:00.000Z",
      sourceTier: "A",
      sourceHealth: "healthy",
      layer: "balance",
    });
  });
});
