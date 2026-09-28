// 0012 触发器不相交真实 SQLite 回归：0010 的两处「= 6」计数会把「既挂接又豁免」的论点
// 重复计入（同时缺一条必需论点时计数仍平衡），发布放行后公开读取端按不相交解码即永久
// 500。本文件直接在真实 schema 上构造该形状，断言 0012 重建后的触发器拒绝它，且正常
// link-only / 豁免-only / 混合日（不同论点）不受影响。
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { applyMigrations, applyBaseSeeds } from "./testing/sqlite-d1.mjs";

const THESIS_IDS = [
  "ENSO-CORE-01",
  "RUBBER-TH-01",
  "PALM-SEA-01",
  "MAIZE-SA-01",
  "SHIP-USEC-01",
  "SHIP-EU-01",
];
const CUTOFF = "2026-09-10T22:30:00.000Z";
const PUBLISHED_AT = "2026-09-10T23:00:00.000Z";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applyBaseSeeds(db);
  return db;
}

function insertPublishedVersion(db, thesisId, index) {
  db.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, published_by,
       created_at, published_at, change_reason
     ) VALUES (?, ?, 1, 'published', 'bullish', 'watch', 50, '触发器探针摘要', '探针失效条件',
       '{}', ?, 'researcher', 'publisher', ?, ?, NULL)`,
  ).run(`trigger-version-${index + 1}`, thesisId, CUTOFF, CUTOFF, PUBLISHED_AT);
}

/**
 * 造一个满足 0010 全部既有校验的 draft brief：完整的冻结元数据、
 * outcome=published 且 4 条门禁通过的 attempt、指定论点的 link 与豁免。
 */
function setupDraftBrief(db, briefDate, { linkedThesisIds, exemptedThesisIds }) {
  db.prepare(
    `INSERT INTO daily_briefs (
       brief_date, status, headline, summary, top_changes_json, data_cutoff,
       freeze_key, methodology_snapshot_json, rule_snapshot_json,
       source_health_snapshot_json, publication_attempt_id
     ) VALUES (?, 'draft', '触发器探针', '触发器探针摘要', '[]', ?,
       'freeze-probe', '[]', '[]', '[]', 'attempt-probe')`,
  ).run(briefDate, CUTOFF);
  db.prepare(
    `INSERT INTO daily_brief_attempts (
       id, brief_date, freeze_key, outcome, data_cutoff, headline, summary,
       top_changes_json, target_snapshot_json, methodology_snapshot_json,
       rule_snapshot_json, source_health_snapshot_json, actor, reason, created_at
     ) VALUES ('attempt-probe', ?, 'freeze-probe', 'published', ?, '触发器探针', '触发器探针摘要',
       '[]', '[]', '[]', '[]', '[]', 'publisher', '触发器探针', ?)`,
  ).run(briefDate, CUTOFF, PUBLISHED_AT);
  db.prepare(
    `INSERT INTO daily_brief_gate_results (attempt_id, gate_code, status, explanation, reasons_json)
     SELECT 'attempt-probe', gate.code, 'passed', '探针', '[]'
       FROM (
         SELECT 'PRIMARY_SOURCE_HEALTH' AS code
         UNION ALL SELECT 'FREEZE_COMPLETENESS'
         UNION ALL SELECT 'CITATION_COMPLETENESS'
         UNION ALL SELECT 'HIGH_RISK_REVIEW'
       ) gate`,
  ).run();
  for (const thesisId of linkedThesisIds) {
    const sortOrder = THESIS_IDS.indexOf(thesisId);
    db.prepare(
      `INSERT INTO daily_brief_theses (
         brief_date, thesis_id, thesis_version_id, methodology_version, rule_version, sort_order
       ) VALUES (?, ?, ?, 'methodology-probe', 'rules-probe', ?)`,
    ).run(briefDate, thesisId, `trigger-version-${sortOrder + 1}`, sortOrder);
  }
  for (const thesisId of exemptedThesisIds) {
    db.prepare(
      `INSERT INTO daily_brief_exemptions (brief_date, thesis_id, gap_id, acknowledged_by, acknowledged_at)
       VALUES (?, ?, 'probe-gap', 'operator@example.com', ?)`,
    ).run(briefDate, thesisId, PUBLISHED_AT);
  }
}

function publish(db, briefDate) {
  db.prepare(
    `UPDATE daily_briefs
        SET status = 'published', published_at = ?, published_by = 'publisher'
      WHERE brief_date = ?`,
  ).run(PUBLISHED_AT, briefDate);
}

describe("0012 每日判定 link 与豁免不相交触发器", () => {
  it("六条 link 的正常日仍可发布（重建后的触发器接受既有合法形状）", () => {
    const db = freshDb();
    for (const [index, thesisId] of THESIS_IDS.entries()) insertPublishedVersion(db, thesisId, index);
    setupDraftBrief(db, "2026-09-10", { linkedThesisIds: THESIS_IDS, exemptedThesisIds: [] });
    expect(() => publish(db, "2026-09-10")).not.toThrow();
    expect(db.prepare("SELECT status FROM daily_briefs WHERE brief_date = '2026-09-10'").get())
      .toEqual({ status: "published" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("五条 link 加另一论点豁免的混合日仍可发布（豁免论点无 link）", () => {
    const db = freshDb();
    for (const [index, thesisId] of THESIS_IDS.entries()) insertPublishedVersion(db, thesisId, index);
    setupDraftBrief(db, "2026-09-10", {
      linkedThesisIds: THESIS_IDS.filter((thesisId) => thesisId !== "SHIP-EU-01"),
      exemptedThesisIds: ["SHIP-EU-01"],
    });
    expect(() => publish(db, "2026-09-10")).not.toThrow();
    expect(db.prepare("SELECT status FROM daily_briefs WHERE brief_date = '2026-09-10'").get())
      .toEqual({ status: "published" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("四条 link 加两条不同论点豁免的混合日仍可发布", () => {
    const db = freshDb();
    for (const [index, thesisId] of THESIS_IDS.entries()) insertPublishedVersion(db, thesisId, index);
    setupDraftBrief(db, "2026-09-10", {
      linkedThesisIds: ["ENSO-CORE-01", "RUBBER-TH-01", "PALM-SEA-01", "MAIZE-SA-01"],
      exemptedThesisIds: ["SHIP-USEC-01", "SHIP-EU-01"],
    });
    expect(() => publish(db, "2026-09-10")).not.toThrow();
    expect(db.prepare("SELECT status FROM daily_briefs WHERE brief_date = '2026-09-10'").get())
      .toEqual({ status: "published" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("拒绝同一论点既挂接又豁免、而另一必需论点两者皆缺的发布（0010 计数盲区）", () => {
    const db = freshDb();
    for (const [index, thesisId] of THESIS_IDS.entries()) insertPublishedVersion(db, thesisId, index);
    // SHIP-EU-01 既挂接又豁免，SHIP-USEC-01 两者皆缺：0010 的两处「= 6」计数
    // 仍平衡（5 link + 1 豁免），只有不相交校验能拦住它。
    setupDraftBrief(db, "2026-09-10", {
      linkedThesisIds: [
        "ENSO-CORE-01", "RUBBER-TH-01", "PALM-SEA-01", "MAIZE-SA-01", "SHIP-EU-01",
      ],
      exemptedThesisIds: ["SHIP-EU-01"],
    });
    expect(() => publish(db, "2026-09-10"))
      .toThrow(/daily brief thesis link and exemption are mutually exclusive/);
    expect(db.prepare("SELECT status FROM daily_briefs WHERE brief_date = '2026-09-10'").get())
      .toEqual({ status: "draft" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("拒绝同一论点既挂接又豁免、即使六条 link 与一条豁免并存", () => {
    const db = freshDb();
    for (const [index, thesisId] of THESIS_IDS.entries()) insertPublishedVersion(db, thesisId, index);
    setupDraftBrief(db, "2026-09-10", { linkedThesisIds: THESIS_IDS, exemptedThesisIds: ["SHIP-EU-01"] });
    expect(() => publish(db, "2026-09-10"))
      .toThrow(/daily brief thesis link and exemption are mutually exclusive/);
    expect(db.prepare("SELECT status FROM daily_briefs WHERE brief_date = '2026-09-10'").get())
      .toEqual({ status: "draft" });
  });
});
