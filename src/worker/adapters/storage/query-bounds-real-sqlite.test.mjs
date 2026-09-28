// 查询有界化真实 SQLite 回归：详情页指标序列的每指标 500 行上限与每日评估输入的
// revision 去重此前只在 FakeDatabase 上验证过 decode 层，从未在真实 schema 上执行过；
// 本文件把两条改写后的 SQL 纳入可执行断言（建库/造数方式与 write-paths-real-sqlite 一致）。
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { SqliteD1, applyMigrations, applyBaseSeeds } from "./testing/sqlite-d1.mjs";
import { D1PublicReadModelRepository } from "./cloudflare-read-models";
import { D1DailyScheduleRepository } from "./cloudflare-daily-schedule";
import { approvedDraftSeed } from "../../../domain/thesis-draft.test-support";

const GENERATED_AT = "2026-09-10T23:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function freshDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applyBaseSeeds(db);
  return db;
}

function insertSourceRun(db) {
  db.prepare(
    `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status)
     VALUES ('probe-run-1', 'noaa_cpc_roni', '2026-09-10T21:00:00.000Z', '2026-09-10T21:00:00.000Z',
             '2026-09-10T21:01:00.000Z', 'success')`,
  ).run();
}

function insertPublishedThesisFixture(db) {
  db.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, created_at, published_at
     ) VALUES ('probe-version-1', 'ENSO-CORE-01', 1, 'published', 'neutral', 'watch', 50,
       '真实 schema 探针摘要', '探针失效条件', ?, '2026-09-10T22:30:00.000Z',
       'system:daily-evaluation', '2026-09-10T22:31:00.000Z', '2026-09-10T23:00:00.000Z')`,
  ).run(JSON.stringify({ schemaVersion: "thesis-draft-calculation-v1", thesisId: "ENSO-CORE-01" }));
  db.prepare(
    `INSERT INTO thesis_publications (
       thesis_id, current_version_id, cache_token, last_transition_id, updated_at
     ) VALUES ('ENSO-CORE-01', 'probe-version-1', 'probe-cache-token', 'probe-transition-id',
       '2026-09-10T23:00:00.000Z')`,
  ).run();
}

function insertEvidence(db, observationId) {
  db.prepare(
    `INSERT INTO evidence (id, thesis_version_id, observation_id, stance, layer, weight,
         summary, citation_url, sort_order)
     VALUES ('probe-evidence-1', 'probe-version-1', ?, 'supports', 'weather', 60,
       '探针证据', 'https://www.cpc.ncep.noaa.gov/probe', 0)`,
  ).run(observationId);
}

/** 插入 count 条日频观测（observed_at 逐日递增），返回最新一条的 observed_at。 */
function insertObservations(db, count) {
  const insert = db.prepare(
    `INSERT INTO observations (id, indicator_id, observed_at, value_num, unit, published_at,
         fetched_at, revision, quality, source_run_id, citation_url)
     VALUES (?, 'enso_roni_ersstv6', ?, ?, '°C', ?, ?, 0, 'verified', 'probe-run-1',
             'https://www.cpc.ncep.noaa.gov/probe')`,
  );
  const base = Date.parse("2025-04-01T00:00:00.000Z");
  for (let index = 0; index < count; index += 1) {
    const observedAt = new Date(base + index * DAY_MS).toISOString();
    insert.run(`probe-observation-${index}`, observedAt, 0.5 + index / 1000, observedAt, observedAt);
  }
  return new Date(base + (count - 1) * DAY_MS).toISOString();
}

describe("详情页指标序列每指标 500 行上限（真实 SQLite）", () => {
  it("超过 500 条历史观测时仅保留每指标最新 500 条，展示顺序不变", async () => {
    const db = freshDb();
    insertSourceRun(db);
    insertPublishedThesisFixture(db);
    const latestObservedAt = insertObservations(db, 503);
    insertEvidence(db, "probe-observation-502");

    const result = await new D1PublicReadModelRepository(new SqliteD1(db).asDatabase())
      .thesis("enso-core", GENERATED_AT);

    const series = result.indicators.find((item) => item.id === "enso_roni_ersstv6");
    expect(series.points).toHaveLength(500);
    expect(series.points.at(-1).observedAt).toBe(latestObservedAt);
    expect(series.points[0].observedAt).toBe(
      new Date(Date.parse(latestObservedAt) - 499 * DAY_MS).toISOString(),
    );
  });

  it("不超过 500 条时展示内容与旧查询一致（全历史保留）", async () => {
    const db = freshDb();
    insertSourceRun(db);
    insertPublishedThesisFixture(db);
    insertObservations(db, 500);
    insertEvidence(db, "probe-observation-0");

    const result = await new D1PublicReadModelRepository(new SqliteD1(db).asDatabase())
      .thesis("enso-core", GENERATED_AT);

    const series = result.indicators.find((item) => item.id === "enso_roni_ersstv6");
    expect(series.points).toHaveLength(500);
    expect(series.points[0].observedAt).toBe("2025-04-01T00:00:00.000Z");
  });
});

describe("每日评估输入 revision 去重（真实 SQLite）", () => {
  it("同一 (indicator, observed_at) 多 revision 时评估输入只含最新 revision", async () => {
    const db = freshDb();
    insertSourceRun(db);
    const insert = db.prepare(
      `INSERT INTO observations (id, indicator_id, observed_at, value_num, unit, published_at,
           fetched_at, revision, supersedes_id, quality, source_run_id, citation_url)
       VALUES (?, 'enso_roni_ersstv6', ?, ?, '°C', ?, ?, ?, NULL, 'verified', 'probe-run-1',
               'https://www.cpc.ncep.noaa.gov/probe')`,
    );
    // 同一 observed_at 两个 revision：只有 revision 1 进入评估输入
    insert.run("probe-observation-x0", "2026-09-09T00:00:00.000Z", 1.0,
      "2026-09-09T08:00:00.000Z", "2026-09-09T08:05:00.000Z", 0);
    insert.run("probe-observation-x1", "2026-09-09T00:00:00.000Z", 1.2,
      "2026-09-09T12:00:00.000Z", "2026-09-09T12:05:00.000Z", 1);
    // 另一 observed_at 的 revision 0 是该时间点的最新版本，必须保留
    insert.run("probe-observation-y0", "2026-09-08T00:00:00.000Z", 0.9,
      "2026-09-08T08:00:00.000Z", "2026-09-08T08:05:00.000Z", 0);

    const [input] = await new D1DailyScheduleRepository(new SqliteD1(db).asDatabase())
      .loadEvaluationInputs([approvedDraftSeed()], "2026-09-09T22:30:00.000Z");

    expect(input.evidence.filter((item) => item.indicatorId === "enso_roni_ersstv6").map((item) => ({
      observationId: item.observationId,
      revision: item.revision,
      value: item.value,
    }))).toEqual([
      { observationId: "probe-observation-y0", revision: 0, value: 0.9 },
      { observationId: "probe-observation-x1", revision: 1, value: 1.2 },
    ]);
  });
});
