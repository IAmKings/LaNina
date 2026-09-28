import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { D1ClimatologyRepository, CLIMATOLOGY_RUN_SCHEDULED_AT } from "./cloudflare-climatology";
import { SqliteD1, applyMigrations, applyBaseSeeds, readRepoFile } from "./testing/sqlite-d1.mjs";

const SOURCE_ID = "nasa_power_rainfall_panama_canal_catchment_v1";
const INDICATOR_ID = "panama_rainfall_climatology_monthly";
const FETCHED_AT = "2026-09-26T22:30:00.000Z";

const databases = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("climatology refresh persistence", () => {
  it("appends twelve month rows on the parent source without touching source health", async () => {
    const db = freshDb();
    let sequence = 0;
    const repository = new D1ClimatologyRepository(
      new SqliteD1(db).asDatabase(),
      () => `clim-${sequence++}`,
    );
    const request = persistRequest(3);

    await expect(repository.persist(request)).resolves.toBe("written");
    await expect(repository.persist(request)).resolves.toBe("unchanged");

    const rows = db.prepare(
      `SELECT revision, value_num FROM observations WHERE indicator_id = ? ORDER BY observed_at`,
    ).all(INDICATOR_ID);
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.revision === 0 && row.value_num === 3)).toBe(true);

    const run = db.prepare(
      `SELECT scheduled_at, status FROM source_runs WHERE source_id = ? AND scheduled_at = ?`,
    ).get(SOURCE_ID, CLIMATOLOGY_RUN_SCHEDULED_AT);
    expect(run).toEqual({ scheduled_at: CLIMATOLOGY_RUN_SCHEDULED_AT, status: "success" });
    expect(db.prepare(`SELECT last_success_at FROM sources WHERE id = ?`).get(SOURCE_ID).last_success_at).toBeNull();

    const revised = persistRequest(3);
    revised.observations[0].value = 4;
    revised.contentHash = "b".repeat(64);
    await expect(repository.persist(revised)).resolves.toBe("written");
    const january = db.prepare(
      `SELECT revision, value_num, supersedes_id IS NOT NULL AS revised
         FROM observations
        WHERE indicator_id = ? AND observed_at = ?
        ORDER BY revision`,
    ).all(INDICATOR_ID, "2020-01-15T00:00:00.000Z");
    expect(january).toEqual([
      { revision: 0, value_num: 3, revised: 0 },
      { revision: 1, value_num: 4, revised: 1 },
    ]);
  });
});

function freshDb() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  applyMigrations(db);
  applyBaseSeeds(db);
  db.exec(readRepoFile("migrations/0014_derived_indicators.sql"));
  return db;
}

function persistRequest(value) {
  return {
    sourceId: SOURCE_ID,
    fetchedAt: FETCHED_AT,
    contentHash: "a".repeat(64),
    snapshotKey: "raw/test/climatology.json",
    observations: Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      const observedAt = `2020-${month}-15T00:00:00.000Z`;
      return {
        indicatorId: INDICATOR_ID,
        observedAt,
        periodStart: observedAt,
        value,
        unit: "mm/day",
        fetchedAt: FETCHED_AT,
        citationUrl: "https://power.larc.nasa.gov/api/temporal/climatology/point?fixture",
        metadata: { month: index + 1 },
      };
    }),
  };
}
