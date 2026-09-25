import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DailyBriefModule } from "../../modules/daily-briefs";
import { ThesisChangeReviewModule } from "../../modules/thesis-change-reviews";
import { D1DailyBriefRepository } from "./cloudflare-daily-briefs";
import { D1ThesisChangeReviewRepository } from "./cloudflare-thesis-change-reviews";

const ROOT = new URL("../../../../", import.meta.url);
const databases = [];
const thesisIds = [
  "ENSO-CORE-01",
  "RUBBER-TH-01",
  "PALM-SEA-01",
  "MAIZE-SA-01",
  "SHIP-USEC-01",
  "SHIP-EU-01",
];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("0005 daily brief freeze migration", () => {
  it("backfills a legacy published brief without hiding its frozen versions", async () => {
    const database = legacyDatabase();
    applyMigration(database, "0005_daily_brief_freeze.sql");

    expect(database.prepare(
      `SELECT freeze_key, publication_attempt_id, source_health_snapshot_json
         FROM daily_briefs WHERE brief_date = '2026-09-10'`,
    ).get()).toEqual({
      freeze_key: "daily-brief-freeze-legacy-v1:2026-09-10",
      publication_attempt_id: "migration-0005-attempt:2026-09-10",
      source_health_snapshot_json: "[]",
    });
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM daily_brief_attempts
        WHERE id = 'migration-0005-attempt:2026-09-10' AND outcome = 'published'`,
    ).get().count).toBe(1);
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM daily_brief_gate_results
        WHERE attempt_id = 'migration-0005-attempt:2026-09-10' AND status = 'passed'`,
    ).get().count).toBe(4);
    expect(database.prepare(
      `SELECT methodology_version, rule_version, sort_order
         FROM daily_brief_theses
        WHERE brief_date = '2026-09-10'
        ORDER BY sort_order`,
    ).all()).toEqual(thesisIds.map((_thesisId, sortOrder) => ({
      methodology_version: "legacy-unavailable",
      rule_version: "legacy-unavailable",
      sort_order: sortOrder,
    })));
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const repository = new D1DailyBriefRepository(new SqliteD1(database).asDatabase());
    await expect(repository.findPublished("2026-09-10")).resolves.toMatchObject({
      briefDate: "2026-09-10",
      freezeKey: "daily-brief-freeze-legacy-v1:2026-09-10",
      sourceHealth: [],
      versions: expect.arrayContaining([
        expect.objectContaining({ methodologyVersion: "legacy-unavailable" }),
      ]),
    });
  });

  it("blocks link identity rewrites and moving a draft link into a published parent", () => {
    const identityDatabase = legacyDatabase();
    applyMigration(identityDatabase, "0005_daily_brief_freeze.sql");
    identityDatabase.exec(
      `INSERT INTO daily_briefs (
         brief_date, status, headline, summary, top_changes_json, data_cutoff
       ) VALUES (
         '2026-09-11', 'draft', '草稿', '草稿', '[]', '2026-09-10T22:30:00.000Z'
       );
       INSERT INTO daily_brief_theses (
         brief_date, thesis_id, thesis_version_id, methodology_version, rule_version, sort_order
       ) VALUES (
         '2026-09-11', 'ENSO-CORE-01', 'version-1', 'legacy-unavailable', 'legacy-unavailable', 0
       );`,
    );
    expect(() => identityDatabase.exec(
      `UPDATE daily_brief_theses
          SET thesis_version_id = 'version-2'
        WHERE brief_date = '2026-09-11' AND thesis_id = 'ENSO-CORE-01';`,
    )).toThrow(/daily brief thesis identity mismatch/);

    const parentDatabase = legacyDatabase(5);
    applyMigration(parentDatabase, "0005_daily_brief_freeze.sql");
    parentDatabase.exec(
      `INSERT INTO daily_briefs (
         brief_date, status, headline, summary, top_changes_json, data_cutoff
       ) VALUES (
         '2026-09-11', 'draft', '草稿', '草稿', '[]', '2026-09-10T22:30:00.000Z'
       );
       INSERT INTO daily_brief_theses (
         brief_date, thesis_id, thesis_version_id, methodology_version, rule_version, sort_order
       ) VALUES (
         '2026-09-11', 'SHIP-EU-01', 'version-6', 'legacy-unavailable', 'legacy-unavailable', 5
       );`,
    );
    expect(() => parentDatabase.exec(
      `UPDATE daily_brief_theses
          SET brief_date = '2026-09-10'
        WHERE brief_date = '2026-09-11' AND thesis_id = 'SHIP-EU-01';`,
    )).toThrow(/published daily brief links are immutable/);
  });

  it("executes the guarded publication SQL against SQLite and preserves withdrawn history", async () => {
    const database = readyDatabase();
    const sqlite = new SqliteD1(database);
    const repository = new D1DailyBriefRepository(sqlite.asDatabase());
    let id = 0;
    const dailyBrief = new DailyBriefModule(repository, () => `sqlite-daily-${++id}`);

    await expect(dailyBrief.freezeAndPublish(dailyCommand(
      "2026-09-09T22:30:00.000Z",
      1,
    ))).resolves.toMatchObject({
      briefDate: "2026-09-10",
      status: "published",
      sourceHealth: [{
        sourceId: "noaa_cpc_roni",
        status: "healthy",
        lastSuccessAt: "2026-09-09T21:01:00.000Z",
      }],
    });

    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z");
    await expect(dailyBrief.freezeAndPublish(dailyCommand(
      "2026-09-10T22:30:00.000Z",
      2,
    ))).resolves.toMatchObject({ briefDate: "2026-09-11", status: "published" });

    database.exec("UPDATE thesis_versions SET status = 'withdrawn' WHERE id = 'current-1-1'");
    await expect(repository.findPublished("2026-09-10")).resolves.toMatchObject({
      briefDate: "2026-09-10",
      status: "published",
      versions: expect.arrayContaining([expect.objectContaining({ thesisVersionId: "current-1-1" })]),
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("publishes a covered gap exemption and records it in the same freeze", async () => {
    // SHIP-EU-01 has no published version at this cutoff; the other five do.
    const database = readyDatabase(["SHIP-EU-01"]);
    const sqlite = new SqliteD1(database);
    const repository = new D1DailyBriefRepository(sqlite.asDatabase());
    let id = 0;
    const dailyBrief = new DailyBriefModule(repository, () => `sqlite-daily-${++id}`);

    const command = dailyCommand("2026-09-09T22:30:00.000Z", 1);
    command.targets = command.targets.filter((target) => target.thesisId !== "SHIP-EU-01");
    command.exemptions = [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }];

    await expect(dailyBrief.freezeAndPublish(command)).resolves.toMatchObject({
      briefDate: "2026-09-10",
      status: "published",
      exemptions: [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }],
    });

    expect(database.prepare(
      `SELECT thesis_id, gap_id, acknowledged_by, acknowledged_at
         FROM daily_brief_exemptions
        WHERE brief_date = '2026-09-10'`,
    ).all()).toEqual([{
      thesis_id: "SHIP-EU-01",
      gap_id: "eu-route-market-unlicensed",
      acknowledged_by: "publisher@example.com",
      acknowledged_at: "2026-09-09T23:00:00.000Z",
    }]);
    expect(database.prepare(
      `SELECT COUNT(*) AS count FROM daily_brief_theses WHERE brief_date = '2026-09-10'`,
    ).get().count).toBe(5);
    const audit = database.prepare(
      `SELECT after_json FROM audit_log
        WHERE entity_type = 'daily_brief' AND action = 'publish'`,
    ).get();
    expect(JSON.parse(audit.after_json).exemptions).toEqual([
      { thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // 已发布的豁免 brief 仍可整页读回，且不把豁免伪装成第六条已发布版本。
    await expect(repository.findPublished("2026-09-10")).resolves.toMatchObject({
      status: "published",
      versions: expect.not.arrayContaining([expect.objectContaining({ thesisId: "SHIP-EU-01" })]),
      exemptions: [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }],
    });
  });

  it("publishes the next day against an exempted baseline", async () => {
    const database = readyDatabase(["SHIP-EU-01"]);
    const sqlite = new SqliteD1(database);
    const repository = new D1DailyBriefRepository(sqlite.asDatabase());
    let id = 0;
    const dailyBrief = new DailyBriefModule(repository, () => `sqlite-daily-${++id}`);
    const exempt = (command) => {
      command.targets = command.targets.filter((target) => target.thesisId !== "SHIP-EU-01");
      command.exemptions = [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }];
      return command;
    };

    await expect(dailyBrief.freezeAndPublish(exempt(dailyCommand("2026-09-09T22:30:00.000Z", 1))))
      .resolves.toMatchObject({ briefDate: "2026-09-10", status: "published" });

    // 第二天同样只有五条已发布版本：上一份 brief 的基线是 5 条 link + 1 条豁免。
    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z", ["SHIP-EU-01"]);
    await expect(dailyBrief.freezeAndPublish(exempt(dailyCommand("2026-09-10T22:30:00.000Z", 2))))
      .resolves.toMatchObject({ briefDate: "2026-09-11", status: "published" });

    expect(database.prepare("SELECT COUNT(*) AS count FROM daily_brief_exemptions").get().count).toBe(2);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("publishes a five-link exempted brief after a six-link baseline", async () => {
    // staging 的确切形状：上一版 6 条 link（SHIP-EU-01 事后被撤回），本版 5 条 link + 1 条豁免，
    // 且 ENSO 存在需要审核的高风险转场。
    const database = readyDatabase();
    const sqlite = new SqliteD1(database);
    const repository = new D1DailyBriefRepository(sqlite.asDatabase());
    let id = 0;
    const dailyBrief = new DailyBriefModule(repository, () => `sqlite-daily-${++id}`);

    await expect(dailyBrief.freezeAndPublish(dailyCommand("2026-09-09T22:30:00.000Z", 1)))
      .resolves.toMatchObject({ briefDate: "2026-09-10", status: "published" });

    database.exec("UPDATE thesis_versions SET status = 'withdrawn' WHERE id = 'current-1-6'");
    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z", ["SHIP-EU-01"]);
    database.exec(
      `UPDATE thesis_versions
          SET direction = 'bearish', stage = 'market_confirmed', confidence = 80
        WHERE version = 2 AND thesis_id = 'ENSO-CORE-01'`,
    );
    const reviews = new ThesisChangeReviewModule(new D1ThesisChangeReviewRepository(sqlite.asDatabase()));
    await reviews.record({
      thesisId: "ENSO-CORE-01",
      afterVersionId: "current-2-1",
      beforeVersionId: "current-1-1",
      decision: "approved",
      reason: "转场已人工确认",
      actor: "publisher@example.com",
      occurredAt: "2026-09-10T23:00:00.000Z",
    });

    const day2 = dailyCommand("2026-09-10T22:30:00.000Z", 2);
    day2.targets = day2.targets.filter((target) => target.thesisId !== "SHIP-EU-01");
    day2.exemptions = [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }];

    await expect(dailyBrief.freezeAndPublish(day2)).resolves.toMatchObject({
      briefDate: "2026-09-11",
      status: "published",
      exemptions: [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }],
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("reports high-risk transitions that still need an exact review", async () => {
    const database = readyDatabase(["SHIP-EU-01"]);
    const sqlite = new SqliteD1(database);
    const repository = new D1DailyBriefRepository(sqlite.asDatabase());
    let id = 0;
    const dailyBrief = new DailyBriefModule(repository, () => `sqlite-daily-${++id}`);
    const exempt = (command) => {
      command.targets = command.targets.filter((target) => target.thesisId !== "SHIP-EU-01");
      command.exemptions = [{ thesisId: "SHIP-EU-01", gapId: "eu-route-market-unlicensed" }];
      return command;
    };

    await expect(dailyBrief.freezeAndPublish(exempt(dailyCommand("2026-09-09T22:30:00.000Z", 1))))
      .resolves.toMatchObject({ briefDate: "2026-09-10", status: "published" });

    // 次日：ENSO 方向反转、阶段跨 4 级、置信度 +30 → 三项高风险触发。
    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z", ["SHIP-EU-01"]);
    database.exec(
      `UPDATE thesis_versions
          SET direction = 'bearish', stage = 'market_confirmed', confidence = 80
        WHERE version = 2 AND thesis_id = 'ENSO-CORE-01'`,
    );
    const nextTargets = ["current-2-1", "current-2-2", "current-2-3", "current-2-4", "current-2-5"];

    await expect(repository.findPendingReviewObligations("2026-09-11", nextTargets)).resolves.toEqual([{
      thesisId: "ENSO-CORE-01",
      afterVersionId: "current-2-1",
      beforeVersionId: "current-1-1",
      triggers: ["CONFIDENCE_DELTA_30", "DIRECTION_CHANGE", "STAGE_DELTA_4"],
    }]);

    // 记录精确绑定的 approved 审核后，待办清空。
    const reviews = new ThesisChangeReviewModule(new D1ThesisChangeReviewRepository(sqlite.asDatabase()));
    await expect(reviews.record({
      thesisId: "ENSO-CORE-01",
      afterVersionId: "current-2-1",
      beforeVersionId: "current-1-1",
      decision: "approved",
      reason: "转场已人工确认",
      actor: "publisher@example.com",
      occurredAt: "2026-09-10T23:00:00.000Z",
    })).resolves.toMatchObject({ thesisId: "ENSO-CORE-01", decision: "approved" });
    await expect(repository.findPendingReviewObligations("2026-09-11", nextTargets)).resolves.toEqual([]);
  });
});

function legacyDatabase(linkCount = 6) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  applyMigration(database, "0001_initial.sql");
  applyMigration(database, "0002_source_retry_health.sql");
  applyMigration(database, "0003_thesis_draft_idempotency.sql");
  database.exec(readFile("seeds/0001_theses.sql"));
  const insertVersion = database.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, published_by,
       created_at, published_at, change_reason
     ) VALUES (?, ?, 1, 'published', 'bullish', 'watch', 50, '摘要', '失效条件',
       '{}', '2026-09-01T00:00:00.000Z', 'legacy', 'legacy',
       '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', NULL)`,
  );
  for (const [index, thesisId] of thesisIds.entries()) {
    insertVersion.run(`version-${index + 1}`, thesisId);
  }
  database.exec(
    `INSERT INTO daily_briefs (
       brief_date, status, headline, summary, top_changes_json, data_cutoff,
       published_at, published_by
     ) VALUES (
       '2026-09-10', 'published', '历史判定', '历史摘要', '[]',
       '2026-09-09T22:30:00.000Z', '2026-09-09T23:00:00.000Z', 'legacy'
     );`,
  );
  const insertLink = database.prepare(
    `INSERT INTO daily_brief_theses (brief_date, thesis_id, thesis_version_id)
     VALUES ('2026-09-10', ?, ?)`,
  );
  for (const [index, thesisId] of thesisIds.slice(0, linkCount).entries()) {
    insertLink.run(thesisId, `version-${index + 1}`);
  }
  applyMigration(database, "0004_thesis_publication_state.sql");
  applyMigration(database, "0009_daily_brief_exemptions.sql");
  return database;
}

function readyDatabase(skipThesisIds = []) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  for (const migration of [
    "0001_initial.sql",
    "0002_source_retry_health.sql",
    "0003_thesis_draft_idempotency.sql",
    "0004_thesis_publication_state.sql",
    "0005_daily_brief_freeze.sql",
    "0009_daily_brief_exemptions.sql",
    "0010_daily_brief_exemptions_trigger.sql",
  ]) applyMigration(database, migration);
  database.exec(readFile("seeds/0001_theses.sql"));
  database.exec(
    `INSERT INTO sources (
       id, name, organization, tier, homepage_url, adapter_key, cadence_minutes,
       late_after_minutes, stale_after_minutes, last_success_at, consecutive_failures,
       enabled, redistribution, created_at, updated_at
     ) VALUES (
       'noaa_cpc_roni', 'NOAA RONI', 'NOAA', 'A', 'https://example.com', 'noaa',
       60, 1440, 10080, '2026-09-01T00:00:00.000Z', 0, 1, 'allowed',
       '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
     );
     INSERT INTO source_runs (
       id, source_id, scheduled_at, started_at, finished_at, status, content_hash
     ) VALUES (
       'source-run-1', 'noaa_cpc_roni', '2026-09-09T21:00:00.000Z',
       '2026-09-09T21:00:00.000Z', '2026-09-09T21:01:00.000Z', 'success', 'hash'
     );`,
  );
  insertVersionSet(database, 1, "2026-09-09T22:30:00.000Z", skipThesisIds);
  return database;
}

function insertVersionSet(database, version, cutoff, skipThesisIds = []) {
  const insertVersion = database.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, published_by,
       created_at, published_at, change_reason
     ) VALUES (?, ?, ?, 'published', 'bullish', 'watch', 50, '摘要', '失效条件',
       ?, ?, 'researcher', 'publisher', ?, ?, ?)`,
  );
  const insertEvidence = database.prepare(
    `INSERT INTO evidence (
       id, thesis_version_id, source_run_id, stance, layer, weight, summary,
       citation_url, sort_order
     ) VALUES (?, ?, 'source-run-1', 'supports', 'forecast', 50, '证据', ?, 0)`,
  );
  for (const [index, thesisId] of thesisIds.entries()) {
    if (skipThesisIds.includes(thesisId)) continue;
    const versionId = `current-${version}-${index + 1}`;
    insertVersion.run(
      versionId,
      thesisId,
      version,
      JSON.stringify({
        schemaVersion: "thesis-draft-calculation-v1",
        thesisId,
        methodologyVersion: "evaluation-v1",
        cutoff,
      }),
      cutoff,
      cutoff,
      cutoff,
      version === 1 ? null : "每日更新",
    );
    insertEvidence.run(
      `evidence-${version}-${index + 1}`,
      versionId,
      `https://source.example/${version}/${index + 1}`,
    );
  }
}

function dailyCommand(cutoff, version) {
  return {
    cutoff,
    targets: thesisIds.map((thesisId, index) => ({
      thesisId,
      thesisVersionId: `current-${version}-${index + 1}`,
    })),
    headline: "今日影响判定",
    summary: "六论点冻结完成",
    topChanges: [],
    actor: "publisher@example.com",
    reason: "四类门禁通过",
    occurredAt: cutoff.replace("22:30:00.000Z", "23:00:00.000Z"),
    expectedFreezeKey: null,
  };
}

class SqliteD1 {
  constructor(database) {
    this.database = database;
  }

  asDatabase() {
    return {
      prepare: (sql) => this.statement(sql, []),
      batch: async (statements) => {
        this.database.exec("BEGIN");
        try {
          const results = statements.map(({ sql, values }) => {
            const statement = this.database.prepare(sql);
            if (/^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql)) {
              return { success: true, results: statement.all(...values) };
            }
            const write = statement.run(...values);
            return { success: true, meta: { changes: Number(write.changes) } };
          });
          this.database.exec("COMMIT");
          return results;
        } catch (error) {
          this.database.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  statement(sql, values) {
    return {
      sql,
      values,
      bind: (...next) => this.statement(sql, next),
      first: async () => {
        const row = this.database.prepare(sql).get(...values);
        return row === undefined ? null : row;
      },
      all: async () => ({
        success: true,
        results: this.database.prepare(sql).all(...values),
      }),
      run: async () => {
        const info = this.database.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
  }
}

function applyMigration(database, name) {
  database.exec(readFile(`migrations/${name}`));
}

function readFile(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}
