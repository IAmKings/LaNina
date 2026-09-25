import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { INITIAL_THESIS_SEEDS } from "../../../domain/initial-thesis-seeds";
import { DailyBriefModule } from "../../modules/daily-briefs";
import { ThesisChangeReviewModule } from "../../modules/thesis-change-reviews";
import { ThesisPublicationModule } from "../../modules/thesis-publications";
import { D1DailyBriefRepository } from "./cloudflare-daily-briefs";
import { D1PublicDailyBriefRepository, D1PublicReadModelRepository } from "./cloudflare-read-models";
import { D1ThesisChangeReviewRepository } from "./cloudflare-thesis-change-reviews";
import { D1ThesisPublicationRepository } from "./cloudflare-thesis-publications";
import {
  applyBaseSeeds,
  applyLocalDemoSeed,
  applyMigrations,
  readRepoFile,
  SqliteD1,
} from "./testing/sqlite-d1.mjs";

/**
 * 清理 staging 上的 TEST ONLY 演示数据（scripts/cleanup-staging-demo-rows.sql）。
 *
 * 夹具刻意复刻 staging 的真实形状：
 *   迁移 0001-0010 + 基础种子 + seeds/9001 演示种子（2026-09-11 合成日报与合成公开指针）
 *   → 真实评估草稿（v2）发布 5 条 → 撤回 SHIP-EU-01 的演示指针 → 记录 3 条高风险审核
 *   → 冻结并发布 2026-09-25 判定（5 条已发布 + 1 条豁免）。
 * 断言清理后：演示行 0 残留、真实判定链路完好、删除保护触发器已恢复、外键完整。
 */
const CUTOFF = "2026-09-24T22:30:00.000Z";
const BRIEF_DATE = "2026-09-25";
const EXEMPTED = "SHIP-EU-01";
const ANCHOR_GAP = "eu-route-market-unlicensed";
const PUBLISHED = ["ENSO-CORE-01", "RUBBER-TH-01", "PALM-SEA-01", "MAIZE-SA-01", "SHIP-USEC-01"];
const NO_DELETE_TRIGGERS = [
  "daily_briefs_published_no_delete",
  "daily_brief_theses_published_no_delete",
  "daily_brief_attempts_no_delete",
  "daily_brief_gate_results_no_delete",
];
const databases = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("staging demo-row cleanup", () => {
  it("removes only the TEST ONLY demo rows and leaves the real brief intact", async () => {
    const database = await stagingLikeDatabase();
    const count = (sql) => database.prepare(sql).get().n;

    // 清理前：演示行存在
    expect(count("SELECT COUNT(*) AS n FROM daily_briefs WHERE brief_date = '2026-09-11'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM thesis_versions WHERE id LIKE 'local-demo-%'")).toBeGreaterThan(0);

    database.exec(readRepoFile("scripts/cleanup-staging-demo-rows.sql"));

    // 演示行全部清零
    expect(count("SELECT COUNT(*) AS n FROM thesis_versions WHERE id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM observations WHERE id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM evidence WHERE id LIKE 'local-demo-%' OR source_run_id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM changes WHERE id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM source_runs WHERE id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM thesis_change_reviews WHERE before_version_id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM thesis_publications WHERE current_version_id LIKE 'local-demo-%' OR previous_version_id LIKE 'local-demo-%'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM daily_briefs WHERE brief_date = '2026-09-11'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM daily_brief_theses WHERE brief_date = '2026-09-11'")).toBe(0);

    // 真实判定链路完好
    expect(count("SELECT COUNT(*) AS n FROM daily_briefs WHERE brief_date = '2026-09-25' AND status = 'published'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM daily_brief_theses WHERE brief_date = '2026-09-25'")).toBe(5);
    expect(count("SELECT COUNT(*) AS n FROM daily_brief_exemptions WHERE brief_date = '2026-09-25'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM thesis_publications WHERE current_version_id LIKE 'real-v2-%'")).toBe(5);
    expect(count(`SELECT COUNT(*) AS n FROM daily_brief_gate_results
                    WHERE attempt_id = (SELECT publication_attempt_id FROM daily_briefs WHERE brief_date = '2026-09-25')`))
      .toBe(4);

    // 删除保护触发器已恢复，且真的再次生效
    expect(count(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'
                    AND name IN (${NO_DELETE_TRIGGERS.map((name) => `'${name}'`).join(", ")})`)).toBe(4);
    expect(() => database.exec("DELETE FROM daily_briefs WHERE brief_date = '2026-09-25'")).toThrow(/immutable/);
    expect(() => database.exec("DELETE FROM daily_brief_theses WHERE brief_date = '2026-09-25'")).toThrow(/immutable/);

    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("stops exposing the synthetic brief and observations on the public surface", async () => {
    const database = await stagingLikeDatabase();
    const sqlite = new SqliteD1(database);
    database.exec(readRepoFile("scripts/cleanup-staging-demo-rows.sql"));

    await expect(new D1PublicDailyBriefRepository(sqlite.asDatabase()).findPublished("2026-09-11"))
      .resolves.toBeNull();
    await expect(new D1PublicDailyBriefRepository(sqlite.asDatabase()).findPublished(BRIEF_DATE))
      .resolves.toMatchObject({
        briefDate: BRIEF_DATE,
        theses: expect.arrayContaining([expect.objectContaining({ thesisId: "ENSO-CORE-01" })]),
        coverageGaps: [{
          thesisId: EXEMPTED,
          title: expect.any(String),
          gapDescription: expect.stringContaining("欧线运价"),
        }],
      });
    const exemptedBrief = await new D1PublicDailyBriefRepository(sqlite.asDatabase()).findPublished(BRIEF_DATE);
    expect(exemptedBrief?.theses).toHaveLength(5);
    expect(exemptedBrief?.theses.map((thesis) => thesis.thesisId)).not.toContain(EXEMPTED);

    const overview = await new D1PublicReadModelRepository(sqlite.asDatabase())
      .overview("2026-09-24T23:30:00.000Z");
    expect(overview.dailyBrief).toMatchObject({ briefDate: BRIEF_DATE });
    expect(overview.theses).toHaveLength(5);
    expect(overview.coverageGaps).toEqual([{
      thesisId: EXEMPTED,
      title: expect.any(String),
      gapDescription: expect.stringContaining("欧线运价"),
    }]);
    // 合成 RONI 观测不再进入公开指标序列
    const roni = await new D1PublicReadModelRepository(sqlite.asDatabase())
      .indicatorSeries({ indicatorId: "enso_roni_ersstv6", from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z", resolution: "raw" });
    expect(roni?.points ?? []).toHaveLength(0);
  });

  it("is idempotent: a second run is a no-op", async () => {
    const database = await stagingLikeDatabase();
    const sql = readRepoFile("scripts/cleanup-staging-demo-rows.sql");
    database.exec(sql);
    const before = database.prepare("SELECT COUNT(*) AS n FROM daily_briefs WHERE brief_date = '2026-09-25'").get().n;
    database.exec(sql);
    expect(database.prepare("SELECT COUNT(*) AS n FROM daily_briefs WHERE brief_date = '2026-09-25'").get().n).toBe(before);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

/** 复刻 staging：演示种子在前，真实 2026-09-25 发布在后。 */
async function stagingLikeDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  applyMigrations(database);
  applyBaseSeeds(database);
  applyLocalDemoSeed(database);

  // 真实来源运行（在 cutoff 之前成功），与演示运行并存
  database.exec(
    `INSERT INTO source_runs (
       id, source_id, scheduled_at, started_at, finished_at, status, content_hash
     ) VALUES (
       'real-run-1', 'noaa_cpc_roni', '2026-09-24T21:00:00.000Z',
       '2026-09-24T21:00:00.000Z', '2026-09-24T21:01:00.000Z', 'success', 'real-hash'
     );
     UPDATE sources
        SET last_success_at = '2026-09-24T21:01:00.000Z', consecutive_failures = 0, last_error_code = NULL
      WHERE id = 'noaa_cpc_roni';`,
  );

  // 真实评估草稿（v2：演示种子已占用 v1）。方向/阶段/置信度刻意复刻 staging 的高风险触发：
  // ENSO 方向变化 + 阶段跨 3 级；MAIZE 方向变化 + 置信度 Δ26；SHIP-USEC 方向变化 + 阶段跨 2 级；
  // RUBBER/PALM 无触发。
  const realValues = {
    "ENSO-CORE-01": { direction: "bearish", stage: "balance_tightening", confidence: 50 },
    "RUBBER-TH-01": { direction: "bullish", stage: "weather_realized", confidence: 71 },
    "PALM-SEA-01": { direction: "bullish", stage: "weather_realized", confidence: 57 },
    "MAIZE-SA-01": { direction: "bearish", stage: "watch", confidence: 69 },
    "SHIP-USEC-01": { direction: "bullish", stage: "weather_realized", confidence: 65 },
  };
  const insertVersion = database.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, published_by,
       created_at, published_at, change_reason
     ) VALUES (?, ?, 2, 'draft', ?, ?, ?, '路径① 摘要', '路径① 失效条件',
       ?, ?, 'system:daily-evaluation', NULL, ?, NULL, NULL)`,
  );
  const insertEvidence = database.prepare(
    `INSERT INTO evidence (
       id, thesis_version_id, source_run_id, stance, layer, weight, summary,
       citation_url, sort_order
     ) VALUES (?, ?, 'real-run-1', 'supports', 'forecast', 50, '路径① 证据', ?, 0)`,
  );
  PUBLISHED.forEach((thesisId, index) => {
    const versionId = `real-v2-${index + 1}`;
    const values = realValues[thesisId];
    insertVersion.run(
      versionId,
      thesisId,
      values.direction,
      values.stage,
      values.confidence,
      JSON.stringify({
        schemaVersion: "thesis-draft-calculation-v1",
        thesisId,
        methodologyVersion: "evaluation-v1",
        cutoff: CUTOFF,
      }),
      CUTOFF,
      CUTOFF,
    );
    insertEvidence.run(`real-evidence-${index + 1}`, versionId, `https://source.example/${index + 1}`);
  });

  const sqlite = new SqliteD1(database);
  const publication = new ThesisPublicationModule(
    new D1ThesisPublicationRepository(sqlite.asDatabase()),
    (thesisId) => INITIAL_THESIS_SEEDS.find((seed) => seed.id === thesisId) ?? null,
  );
  for (const [index, thesisId] of PUBLISHED.entries()) {
    await publication.publish({
      versionId: `real-v2-${index + 1}`,
      thesisId,
      expectedVersion: 2,
      actor: "publisher@example.com",
      reason: "研究负责人审核通过",
      occurredAt: "2026-09-24T22:00:00.000Z",
    });
  }
  // 撤回 SHIP-EU-01 的演示公开指针（与 staging 操作一致）
  await publication.withdraw({
    versionId: "local-demo-version-eu",
    thesisId: EXEMPTED,
    expectedVersion: 1,
    actor: "publisher@example.com",
    reason: "移除 staging 演示数据",
    occurredAt: "2026-09-24T22:05:00.000Z",
  });

  const reviews = new ThesisChangeReviewModule(new D1ThesisChangeReviewRepository(sqlite.asDatabase()));
  for (const [index, thesisId] of ["ENSO-CORE-01", "MAIZE-SA-01", "SHIP-USEC-01"].entries()) {
    const demoId = { "ENSO-CORE-01": "enso", "MAIZE-SA-01": "maize", "SHIP-USEC-01": "usec" }[thesisId];
    await reviews.record({
      thesisId,
      afterVersionId: `real-v2-${PUBLISHED.indexOf(thesisId) + 1}`,
      beforeVersionId: `local-demo-version-${demoId}`,
      decision: "approved",
      reason: `转场确认 ${index + 1}`,
      actor: "publisher@example.com",
      occurredAt: "2026-09-24T22:10:00.000Z",
    });
  }

  let id = 0;
  const dailyBrief = new DailyBriefModule(
    new D1DailyBriefRepository(sqlite.asDatabase()),
    () => `real-daily-${++id}`,
  );
  await dailyBrief.freezeAndPublish({
    cutoff: CUTOFF,
    targets: PUBLISHED.map((thesisId, index) => ({
      thesisId,
      thesisVersionId: `real-v2-${index + 1}`,
    })),
    headline: "路径① 验收判定",
    summary: "五条论点已发布，欧线按覆盖缺口豁免。",
    topChanges: [],
    actor: "publisher@example.com",
    reason: "路径① 验收",
    occurredAt: "2026-09-24T23:00:00.000Z",
    expectedFreezeKey: null,
    exemptions: [{ thesisId: EXEMPTED, gapId: ANCHOR_GAP }],
  });
  return database;
}
