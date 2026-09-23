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

describe("D1ThesisChangeReviewRepository", () => {
  it("resolves the previous version from the most recent published daily brief", async () => {
    const database = readyDatabase();
    const repository = new D1ThesisChangeReviewRepository(new SqliteD1(database).asDatabase());

    await expect(repository.findPreviousFrozenVersion("ENSO-CORE-01")).resolves.toBeNull();

    await publish(database, "2026-09-09T22:30:00.000Z", 1);

    await expect(repository.findPreviousFrozenVersion("ENSO-CORE-01")).resolves.toBe("current-1-1");
    await expect(repository.findPreviousFrozenVersion("SHIP-EU-01")).resolves.toBe("current-1-6");
    await expect(repository.findPreviousFrozenVersion("UNKNOWN-01")).resolves.toBeNull();
  });

  it("refuses to review a transition before any daily brief has been published", async () => {
    const database = readyDatabase();
    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z");
    const review = new ThesisChangeReviewModule(
      new D1ThesisChangeReviewRepository(new SqliteD1(database).asDatabase()),
    );

    await expect(review.record({
      thesisId: "ENSO-CORE-01",
      afterVersionId: "current-2-1",
      beforeVersionId: "current-1-1",
      decision: "approved",
      reason: "方向变化已复核",
      actor: "publisher@example.com",
      occurredAt: "2026-09-10T23:00:00.000Z",
    })).rejects.toMatchObject({ code: "NO_PREVIOUS_BRIEF" });
  });

  it("stores an exact approval idempotently and refuses a conflicting decision", async () => {
    const database = readyDatabase();
    await publish(database, "2026-09-09T22:30:00.000Z", 1);
    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z");
    const review = new ThesisChangeReviewModule(
      new D1ThesisChangeReviewRepository(new SqliteD1(database).asDatabase()),
    );
    const command = {
      thesisId: "ENSO-CORE-01",
      afterVersionId: "current-2-1",
      beforeVersionId: "current-1-1",
      decision: "approved",
      reason: "方向变化已复核",
      actor: "publisher@example.com",
      occurredAt: "2026-09-10T23:00:00.000Z",
    };

    const stored = await review.record(command);
    expect(stored.decision).toBe("approved");
    await expect(review.record({ ...command, occurredAt: "2026-09-10T23:30:00.000Z" }))
      .resolves.toEqual(stored);
    await expect(review.record({ ...command, decision: "rejected" }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(review.record({ ...command, beforeVersionId: "current-1-2" }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM thesis_change_reviews WHERE after_version_id = 'current-2-1'",
    ).get().count).toBe(1);
    expect(database.prepare(
      `SELECT status, reviewed_by, reviewed_at, reason FROM thesis_change_reviews
        WHERE after_version_id = 'current-2-1'`,
    ).get()).toEqual({
      status: "approved",
      reviewed_by: "publisher@example.com",
      reviewed_at: "2026-09-10T23:00:00.000Z",
      reason: "方向变化已复核",
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps the identity trigger as the last line of defence", () => {
    const database = readyDatabase();
    applyMigration007(database);

    expect(() => database.exec(
      `INSERT INTO thesis_change_reviews (
         after_version_id, thesis_id, before_version_id, status, reviewed_by, reviewed_at, reason
       ) VALUES (
         'current-2-1', 'ENSO-CORE-01', 'current-2-2', 'approved',
         'publisher@example.com', '2026-09-10T23:00:00.000Z', '跨论点审核'
       );`,
    )).toThrow(/change review version identity mismatch/);
  });
});

describe("high-risk daily brief review gate", () => {
  it("clears HIGH_RISK_REVIEW only with a recorded, exactly bound approval", async () => {
    const database = readyDatabase();
    const sqlite = new SqliteD1(database);
    const briefs = new D1DailyBriefRepository(sqlite.asDatabase());
    const review = new ThesisChangeReviewModule(new D1ThesisChangeReviewRepository(sqlite.asDatabase()));
    const dailyBrief = new DailyBriefModule(briefs, idFactory());

    await publish(database, "2026-09-09T22:30:00.000Z", 1);

    // Version 2 changes direction for one thesis, which is a high-risk transition.
    insertVersionSet(database, 2, "2026-09-10T22:30:00.000Z");
    database.exec("UPDATE thesis_versions SET direction = 'bearish' WHERE id = 'current-2-1'");

    const blocked = await dailyBrief.freezeAndPublish(dailyCommand("2026-09-10T22:30:00.000Z", 2, null));
    expect(blocked.status).toBe("delayed");
    expect(blocked.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "HIGH_RISK_REVIEW",
        status: "failed",
        reasons: expect.arrayContaining(["UNREVIEWED_DIRECTION_CHANGE:ENSO-CORE-01"]),
      }),
    ]));
    await expect(briefs.findPublished("2026-09-11")).resolves.toBeNull();

    await review.record({
      thesisId: "ENSO-CORE-01",
      afterVersionId: "current-2-1",
      beforeVersionId: "current-1-1",
      decision: "approved",
      reason: "研究负责人已复核方向变化",
      actor: "publisher@example.com",
      occurredAt: "2026-09-10T23:00:00.000Z",
    });

    // A real approval changes the freeze key, so the retry must echo the pending attempt's key.
    const pendingKey = await briefs.findCurrentFreezeKey("2026-09-11");
    expect(pendingKey).not.toBeNull();

    const published = await dailyBrief.freezeAndPublish(dailyCommand("2026-09-10T22:30:00.000Z", 2, pendingKey));
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();
    expect(published.gates.every((gate) => gate.status === "passed")).toBe(true);

    await expect(briefs.findPublished("2026-09-11")).resolves.toMatchObject({
      status: "published",
      versions: expect.arrayContaining([
        expect.objectContaining({ thesisId: "ENSO-CORE-01", thesisVersionId: "current-2-1" }),
      ]),
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

let generatedIds = 0;

/** Attempt ids must stay unique across every module instance in a test, exactly as in production. */
function idFactory() {
  return () => `sqlite-daily-${++generatedIds}`;
}

async function publish(database, cutoff, version) {
  const briefs = new D1DailyBriefRepository(new SqliteD1(database).asDatabase());
  const dailyBrief = new DailyBriefModule(briefs, idFactory());
  const result = await dailyBrief.freezeAndPublish(dailyCommand(cutoff, version, null));
  expect(result.status).toBe("published");
  return result;
}

function readyDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  for (const migration of [
    "0001_initial.sql",
    "0002_source_retry_health.sql",
    "0003_thesis_draft_idempotency.sql",
    "0004_thesis_publication_state.sql",
    "0005_daily_brief_freeze.sql",
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
  insertVersionSet(database, 1, "2026-09-09T22:30:00.000Z");
  return database;
}

function insertVersionSet(database, version, cutoff) {
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

function dailyCommand(cutoff, version, expectedFreezeKey) {
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
    expectedFreezeKey,
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

function applyMigration007(database) {
  applyMigration(database, "0007_admin_runs_projection.sql");
}

function readFile(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}
