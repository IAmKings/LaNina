import { DatabaseSync } from "node:sqlite";

import { approvedPublicationSeed } from "../../../domain/thesis-draft.test-support";
import { afterEach, describe, expect, it } from "vitest";

import { D1AdminReadModelRepository } from "./cloudflare-admin-read-models";
import { D1DailyScheduleRepository } from "./cloudflare-daily-schedule";
import { D1DailyPublicationTargetRepository } from "./cloudflare-daily-publication";
import { DailyPublicationTargetModule } from "../../modules/daily-publication";
import {
  D1AtomFeedRepository,
  D1PublicDailyBriefRepository,
  D1PublicReadModelRepository,
} from "./cloudflare-read-models";
import { EMPTY_PUBLIC_CHANGES_QUERY } from "../../modules/read-models";
import {
  SqliteD1,
  applyBaseSeeds,
  applyLocalDemoSeed,
  applyMigrations,
} from "./testing/sqlite-d1";

const GENERATED_AT = "2026-09-10T23:30:00.000Z";
const databases = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function seededDatabase({ withDemoSeed = true } = {}) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  applyMigrations(database);
  applyBaseSeeds(database);
  if (withDemoSeed) applyLocalDemoSeed(database);
  return database;
}

function repository(database) {
  return new D1PublicReadModelRepository(new SqliteD1(database).asDatabase());
}

describe("local demo publication seed", () => {
  it("makes the public site readable without touching any real source", async () => {
    const database = seededDatabase();
    const readModels = repository(database);

    const theses = await readModels.theses(null, GENERATED_AT);
    expect(theses).toHaveLength(6);
    expect(theses.map((thesis) => thesis.id)).toEqual([
      "ENSO-CORE-01", "MAIZE-SA-01", "PALM-SEA-01", "RUBBER-TH-01", "SHIP-EU-01", "SHIP-USEC-01",
    ]);

    const overview = await readModels.overview(GENERATED_AT);
    expect(overview.dailyBrief).not.toBeNull();
    expect(overview.theses).toHaveLength(6);
    expect(overview.topChanges.length).toBeGreaterThan(0);

    const changes = await readModels.changes(null, EMPTY_PUBLIC_CHANGES_QUERY, GENERATED_AT);
    expect(changes.changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.changes.some((change) => change.thesisId === "RUBBER-TH-01")).toBe(true);

    const category = await readModels.category("shipping", GENERATED_AT);
    expect(category?.theses).toHaveLength(2);

    const brief = await new D1PublicDailyBriefRepository(new SqliteD1(database).asDatabase())
      .findPublished("2026-09-11");
    expect(brief).toMatchObject({
      briefDate: "2026-09-11",
      methodologyVersion: "evaluation-v1-demo",
      headline: "合成演示：ENSO 风险仍待实物与市场层确认",
    });
    expect(brief?.theses).toHaveLength(6);
  });

  /**
   * Every public read path is executed against real SQLite. A statement typo (for example a missing
   * table alias) otherwise survives canned-result tests and the demo middleware, which is exactly how
   * the overview projection shipped broken once.
   */
  it("exercises every public and admin read path against the real schema", async () => {
    const database = seededDatabase();
    const d1 = new SqliteD1(database).asDatabase();
    const readModels = new D1PublicReadModelRepository(d1);

    await expect(readModels.methodology(GENERATED_AT)).resolves.toMatchObject({
      methodologyVersion: expect.any(String),
    });
    await expect(readModels.thesis("thailand-natural-rubber", GENERATED_AT)).resolves.toMatchObject({
      thesis: { id: "RUBBER-TH-01" },
    });
    await expect(readModels.thesis("asia-europe", GENERATED_AT)).resolves.toMatchObject({
      thesis: { id: "SHIP-EU-01" },
    });
    for (const category of ["rubber", "agriculture", "shipping"]) {
      const page = await readModels.category(category, GENERATED_AT);
      expect(page?.theses.length, category).toBeGreaterThan(0);
    }
    await expect(readModels.theses("rubber", GENERATED_AT)).resolves.toHaveLength(1);
    await expect(readModels.dataHealth(GENERATED_AT)).resolves.toMatchObject({
      sources: expect.arrayContaining([expect.objectContaining({ sourceId: "noaa_cpc_roni" })]),
    });

    // The filtered change list must stay filter-correct against the real schema too.
    const filtered = await readModels.changes(null, {
      category: "rubber",
      thesisId: "RUBBER-TH-01",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-30T00:00:00.000Z",
    }, GENERATED_AT);
    expect(filtered.changes.map((change) => change.thesisId)).toEqual(["RUBBER-TH-01"]);
    const excluded = await readModels.changes(null, {
      category: "shipping",
      thesisId: null,
      from: null,
      to: null,
    }, GENERATED_AT);
    expect(excluded.changes).toEqual([]);

    // 评估输入装载与发布目标解析是两条复杂查询，此前从未在真实 schema 上执行过。
    const schedule = new D1DailyScheduleRepository(d1);
    const inputs = await schedule.loadEvaluationInputs([approvedPublicationSeed()], "2026-09-10T22:30:00.000Z");
    expect(Array.isArray(inputs)).toBe(true);

    const targets = await new DailyPublicationTargetModule(
      new D1DailyPublicationTargetRepository(d1),
    ).resolve("2026-09-10T22:30:00.000Z");
    expect(targets.targets).toHaveLength(6);
    expect(targets.blockers).toEqual([]);

    const feed = await new D1AtomFeedRepository(d1).feed(GENERATED_AT);
    expect(feed.changes.length).toBeGreaterThan(0);
    expect(feed.dailyBriefs.map((brief) => brief.briefDate)).toContain("2026-09-11");

    const admin = new D1AdminReadModelRepository(d1);
    const actor = { email: "researcher@example.test", roles: ["viewer", "editor", "publisher"] };
    await expect(admin.runs(actor, null)).resolves.toMatchObject({ runs: expect.any(Array) });
    await expect(admin.draft(actor, "RUBBER-TH-01")).resolves.toMatchObject({
      thesis: { id: "RUBBER-TH-01" },
    });
  });

  it("keeps the only enabled source healthy and gives the chart real observations", async () => {
    const database = seededDatabase();
    const readModels = repository(database);

    const series = await readModels.indicatorSeries({
      indicatorId: "enso_roni_ersstv6",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T00:00:00.000Z",
      resolution: "raw",
    });
    expect(series?.points).toHaveLength(6);
    // A provisional observation and a revision are present, so the marker legend is exercised.
    expect(series?.points.some((point) => point.quality === "provisional")).toBe(true);
    expect(series?.points.some((point) => point.revision > 0)).toBe(true);

    const health = await readModels.dataHealth(GENERATED_AT);
    expect(health.sources.map((source) => source.sourceId)).toContain("noaa_cpc_roni");
  });

  it("stays empty when the demo seed is not applied", async () => {
    const readModels = repository(seededDatabase({ withDemoSeed: false }));

    expect(await readModels.theses(null, GENERATED_AT)).toEqual([]);
    expect((await readModels.overview(GENERATED_AT)).dailyBrief).toBeNull();
  });

  it("is safe to re-run: repeated application cannot duplicate or rewrite history", async () => {
    const database = seededDatabase();
    applyLocalDemoSeed(database);
    applyLocalDemoSeed(database);

    const count = (sql) => database.prepare(sql).get().count;
    expect(count("SELECT COUNT(*) AS count FROM thesis_versions WHERE id LIKE 'local-demo-%'")).toBe(6);
    expect(count("SELECT COUNT(*) AS count FROM daily_brief_attempts WHERE id LIKE 'local-demo-%'")).toBe(1);
    expect(count("SELECT COUNT(*) AS count FROM daily_brief_theses WHERE brief_date = '2026-09-11'")).toBe(6);
    expect(count("SELECT COUNT(*) AS count FROM daily_brief_gate_results WHERE attempt_id = 'local-demo-attempt-1'")).toBe(4);
    expect(count("SELECT COUNT(*) AS count FROM observations WHERE id LIKE 'local-demo-%'")).toBe(6);
    expect(count("SELECT COUNT(*) AS count FROM changes WHERE id LIKE 'local-demo-%'")).toBe(2);
    expect(database.prepare("SELECT status FROM daily_briefs WHERE brief_date = '2026-09-11'").get().status)
      .toBe("published");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("never touches the production research seeds", () => {
    const database = seededDatabase();

    // The six production seeds stay pending, so a real evaluation still refuses to draft.
    const pending = database.prepare(
      `SELECT COUNT(*) AS count FROM thesis_versions WHERE created_by = 'local-demo-seed'`,
    ).get().count;
    expect(pending).toBe(6);
    expect(database.prepare("SELECT COUNT(*) AS count FROM theses").get().count).toBe(6);
     // The 2026-09-20/21 licence unlock turned ON World Bank + JPX + EIA + USDA×2
     // in base seeds (NOAA was already enabled); NASA×4 stay disabled pending
     // the remaining product/research + publication sign-offs.
     expect(database.prepare("SELECT COUNT(*) AS count FROM sources WHERE enabled = 1").get().count).toBe(12);
     expect(database.prepare("SELECT COUNT(*) AS count FROM sources WHERE id LIKE 'eia_%' AND enabled = 1").get().count).toBe(1);
     expect(database.prepare("SELECT COUNT(*) AS count FROM sources WHERE id LIKE 'usda_psd_%' AND enabled = 1").get().count).toBe(2);
     expect(database.prepare("SELECT COUNT(*) AS count FROM sources WHERE id LIKE 'world_bank%' AND enabled = 1").get().count).toBe(1);
     expect(database.prepare("SELECT COUNT(*) AS count FROM sources WHERE id LIKE 'unctad%' AND enabled = 1").get().count).toBe(1);
     expect(database.prepare("SELECT COUNT(*) AS count FROM sources WHERE id LIKE 'jpx_ose%' AND enabled = 1").get().count).toBe(1);
  });
});
