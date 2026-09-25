import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import { INITIAL_THESIS_SEEDS } from "../domain/initial-thesis-seeds";
import { D1DailyBriefRepository } from "./adapters/storage/cloudflare-daily-briefs";
import { D1PublicReadModelRepository } from "./adapters/storage/cloudflare-read-models";
import { D1ThesisPublicationRepository } from "./adapters/storage/cloudflare-thesis-publications";
import { applyMigrations, readRepoFile, SqliteD1 } from "./adapters/storage/testing/sqlite-d1.mjs";
import { DailyBriefModule } from "./modules/daily-briefs";
import { ThesisPublicationModule } from "./modules/thesis-publications";

/**
 * 路径① 验收闭环的真实 SQLite 回归（2026-09-25）。
 *
 * 陈列出 staging 的真实起点：五条论点只有 draft 版本、SHIP-EU-01 没有版本。本用例走完整链路：
 *   人工发布 5 条 draft（真实 ThesisPublicationModule + D1 适配器）
 *   → 冻结 brief（5 条已发布 + 1 条已登记豁免）
 *   → 公开投影显示覆盖缺口且不含方向/置信度。
 */
const CUTOFF = "2026-09-24T22:30:00.000Z";
const BRIEF_DATE = "2026-09-25";
const EXEMPTED = "SHIP-EU-01";
const ANCHOR_GAP = "eu-route-market-unlicensed";
const PUBLISHED = ["ENSO-CORE-01", "RUBBER-TH-01", "PALM-SEA-01", "MAIZE-SA-01", "SHIP-USEC-01"];
const databases = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("path-1 acceptance chain", () => {
  it("publishes five drafts and freezes the brief with one acknowledged coverage gap", async () => {
    const database = acceptanceDatabase();
    const sqlite = new SqliteD1(database);

    // 1) 人工发布五条 draft：D-A 之后 publication 闸门按 seed 逐一放行，SHIP-EU-01 仍被拒绝。
    const publication = new ThesisPublicationModule(
      new D1ThesisPublicationRepository(sqlite.asDatabase()),
      (thesisId) => INITIAL_THESIS_SEEDS.find((seed) => seed.id === thesisId) ?? null,
    );
    for (const [index, thesisId] of PUBLISHED.entries()) {
      await expect(publication.publish(publishCommand(thesisId, `path1-draft-${index + 1}`)))
        .resolves.toMatchObject({ action: "publish", thesisId });
    }
    await expect(publication.publish(publishCommand(EXEMPTED, "path1-draft-eu", "2026-09-24T22:00:00.000Z")))
      .rejects.toMatchObject({ code: "PUBLICATION_DISABLED" });

    expect(database.prepare("SELECT COUNT(*) AS count FROM thesis_publications").get().count).toBe(5);
    expect(database.prepare("SELECT COUNT(*) AS count FROM thesis_versions WHERE status = 'published'").get().count)
      .toBe(5);

    // 2) 冻结 brief：五条已发布版本 + SHIP-EU-01 显式豁免，且必须由 0010 触发器放行。
    let id = 0;
    const dailyBrief = new DailyBriefModule(
      new D1DailyBriefRepository(sqlite.asDatabase()),
      () => `path1-daily-${++id}`,
    );
    const result = await dailyBrief.freezeAndPublish({
      cutoff: CUTOFF,
      targets: PUBLISHED.map((thesisId, index) => ({
        thesisId,
        thesisVersionId: `path1-draft-${index + 1}`,
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

    expect(result).toMatchObject({
      briefDate: BRIEF_DATE,
      status: "published",
      publishedBy: "publisher@example.com",
      exemptions: [{ thesisId: EXEMPTED, gapId: ANCHOR_GAP }],
    });
    expect(result.versions.map((version) => version.thesisId)).toEqual(PUBLISHED);
    expect(result.gates.every((gate) => gate.status === "passed")).toBe(true);

    // 3) 落库证据：5 条 link + 1 条豁免 + 审计里带豁免清单。
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM daily_brief_theses WHERE brief_date = ?",
    ).get(BRIEF_DATE).count).toBe(5);
    expect(database.prepare(
      "SELECT thesis_id, gap_id, acknowledged_by FROM daily_brief_exemptions WHERE brief_date = ?",
    ).all(BRIEF_DATE)).toEqual([{
      thesis_id: EXEMPTED,
      gap_id: ANCHOR_GAP,
      acknowledged_by: "publisher@example.com",
    }]);
    const audit = database.prepare(
      "SELECT after_json FROM audit_log WHERE entity_type = 'daily_brief' AND action = 'publish'",
    ).get();
    expect(JSON.parse(audit.after_json).exemptions).toEqual([{ thesisId: EXEMPTED, gapId: ANCHOR_GAP }]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // 4) 公开投影：首页推进到 2026-09-25，显示欧线缺口，且缺口对象没有方向/置信度字段。
    const overview = await new D1PublicReadModelRepository(sqlite.asDatabase())
      .overview("2026-09-24T23:30:00.000Z");
    expect(overview.dailyBrief).toMatchObject({ briefDate: BRIEF_DATE });
    expect(overview.theses).toHaveLength(5);
    expect(overview.theses.map((thesis) => thesis.id)).not.toContain(EXEMPTED);
    expect(overview.coverageGaps).toEqual([{
      thesisId: EXEMPTED,
      title: "ENSO 相关因素对亚洲至欧洲航线是否存在可分离影响",
      gapDescription: expect.stringContaining("欧线运价"),
    }]);
    expect(Object.keys(overview.coverageGaps[0]).sort()).toEqual(["gapDescription", "thesisId", "title"]);
  });
});

function acceptanceDatabase() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  applyMigrations(database);
  database.exec(readRepoFile("seeds/0001_theses.sql"));
  database.exec(
    `INSERT INTO sources (
       id, name, organization, tier, homepage_url, adapter_key, cadence_minutes,
       late_after_minutes, stale_after_minutes, last_success_at, consecutive_failures,
       enabled, redistribution, created_at, updated_at
     ) VALUES (
       'noaa_cpc_roni', 'NOAA RONI', 'NOAA', 'A', 'https://example.com', 'noaa',
       60, 1440, 10080, '2026-09-24T21:01:00.000Z', 0, 1, 'allowed',
       '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
     );
     INSERT INTO source_runs (
       id, source_id, scheduled_at, started_at, finished_at, status, content_hash
     ) VALUES (
       'path1-run-1', 'noaa_cpc_roni', '2026-09-24T21:00:00.000Z',
       '2026-09-24T21:00:00.000Z', '2026-09-24T21:01:00.000Z', 'success', 'path1-hash'
     );`,
  );

  // 五条 draft 版本（staging 的真实起点）；SHIP-EU-01 没有任何版本。
  const insertVersion = database.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, published_by,
       created_at, published_at, change_reason
     ) VALUES (?, ?, 1, 'draft', 'bullish', 'watch', 50, '路径① 摘要', '路径① 失效条件',
       ?, ?, 'system:daily-evaluation', NULL, ?, NULL, NULL)`,
  );
  const insertEvidence = database.prepare(
    `INSERT INTO evidence (
       id, thesis_version_id, source_run_id, stance, layer, weight, summary,
       citation_url, sort_order
     ) VALUES (?, ?, 'path1-run-1', 'supports', 'forecast', 50, '路径① 证据', ?, 0)`,
  );
  for (const [index, thesisId] of PUBLISHED.entries()) {
    const versionId = `path1-draft-${index + 1}`;
    insertVersion.run(
      versionId,
      thesisId,
      JSON.stringify({
        schemaVersion: "thesis-draft-calculation-v1",
        thesisId,
        methodologyVersion: "evaluation-v1",
        cutoff: CUTOFF,
      }),
      CUTOFF,
      CUTOFF,
    );
    insertEvidence.run(`path1-evidence-${index + 1}`, versionId, `https://source.example/${index + 1}`);
  }
  return database;
}

function publishCommand(thesisId, versionId, occurredAt = "2026-09-24T23:00:00.000Z") {
  return {
    versionId,
    thesisId,
    expectedVersion: 1,
    actor: "publisher@example.com",
    reason: "研究负责人审核通过",
    occurredAt,
  };
}
