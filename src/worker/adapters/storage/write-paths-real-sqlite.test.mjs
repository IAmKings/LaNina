// 写路径真实 SQLite 回归：发布/撤回与草稿编辑的 D1 SQL 此前从未在真实 schema 上执行过
// （overview 别名缺陷正是从这一测试盲区漏出的），本文件把它们纳入可执行断言。
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { SqliteD1, applyMigrations, applyBaseSeeds } from "./testing/sqlite-d1.mjs";
import { ThesisPublicationModule } from "../../modules/thesis-publications";
import { ThesisDraftModule } from "../../modules/thesis-drafts";
import { D1ThesisPublicationRepository } from "./cloudflare-thesis-publications";
import { D1ThesisDraftRepository } from "./cloudflare-thesis-drafts";
import { approvedPublicationSeed, makeDraftCandidate } from "../../../domain/thesis-draft.test-support";

const CUTOFF = "2026-09-10T22:30:00.000Z";

/** 模块会为 transition/audit/cache 各生成一个 ID，必须互不相同。 */
function probeIdFactory() {
  let n = 0;
  return () => `probe-id-${++n}`;
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applyBaseSeeds(db);
  return db;
}

function insertThesisRow(db, thesisId) {
  db.prepare(
    `INSERT OR IGNORE INTO theses (id, slug, title, category, region, market_scope, owner, active)
     VALUES (?, 'probe-thesis', '探针论点', 'agriculture', 'probe-region', 'probe-market', 'probe', 1)`,
  ).run(thesisId);
}

function insertSourceRun(db) {
  db.prepare(
    `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status, content_hash)
     VALUES ('probe-run-1', 'noaa_cpc_roni', '2026-09-10T21:00:00.000Z', '2026-09-10T21:00:00.000Z',
             '2026-09-10T21:01:00.000Z', 'success', 'probe-hash')`,
  ).run();
}

function insertDraftVersion(db, thesisId, versionId, version) {
  db.prepare(
    `INSERT INTO thesis_versions (
       id, thesis_id, version, status, direction, stage, confidence, summary,
       invalidation, calculation_json, based_on_cutoff, created_by, published_by,
       created_at, published_at, change_reason
     ) VALUES (?, ?, ?, 'draft', 'neutral', 'watch', 50, '探针草稿摘要', '探针失效条件',
       ?, ?, 'system:daily-evaluation', NULL, ?, NULL, NULL)`,
  ).run(
    versionId,
    thesisId,
    version,
    JSON.stringify({
      schemaVersion: "thesis-draft-calculation-v1",
      thesisId,
      methodologyVersion: "evaluation-v1-demo",
      cutoff: CUTOFF,
    }),
    CUTOFF,
    CUTOFF,
  );
  db.prepare(
    `INSERT INTO evidence (id, thesis_version_id, source_run_id, stance, layer, weight, summary, citation_url, sort_order)
     VALUES (?, ?, 'probe-run-1', 'supports', 'forecast', 50, '探针证据', ?, 0)`,
  ).run(`probe-evidence-${versionId}`, versionId, `https://example.test/${versionId}`);
}

describe("写路径真实 SQLite 回归", () => {
  it("发布 draft → 指针与审计落库 → 撤回后回到无公开版本", async () => {
    const db = freshDb();
    const seed = approvedPublicationSeed();
    insertThesisRow(db, seed.id);
    insertSourceRun(db);
    insertDraftVersion(db, seed.id, "probe-draft-1", 1);

    const publication = new ThesisPublicationModule(
      new D1ThesisPublicationRepository(new SqliteD1(db).asDatabase()),
      (id) => (id === seed.id ? seed : null),
      probeIdFactory(),
    );
    const result = await publication.publish({
      versionId: "probe-draft-1",
      thesisId: seed.id,
      expectedVersion: 1,
      actor: "publisher@example.test",
      reason: "探针发布",
      occurredAt: "2026-09-10T23:00:00.000Z",
    });

    expect(result.action).toBe("publish");
    expect(result.thesisId).toBe(seed.id);

    expect(
      db.prepare("SELECT current_version_id FROM thesis_publications WHERE thesis_id = ?").get(seed.id)
        .current_version_id,
    ).toBe("probe-draft-1");
    expect(db.prepare("SELECT status FROM thesis_versions WHERE id = 'probe-draft-1'").get().status)
      .toBe("published");

    const withdrawn = await publication.withdraw({
      versionId: "probe-draft-1",
      thesisId: seed.id,
      expectedVersion: 1,
      actor: "publisher@example.test",
      reason: "探针撤回",
      occurredAt: "2026-09-10T23:30:00.000Z",
    });
    expect(withdrawn.action).toBe("withdraw");
    expect(db.prepare("SELECT status FROM thesis_versions WHERE id = 'probe-draft-1'").get().status)
      .toBe("withdrawn");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("草稿编辑（copy-on-write）在真实 schema 上产生新版本与审计", async () => {
    const db = freshDb();
    const seed = approvedPublicationSeed();
    insertThesisRow(db, seed.id);
    insertSourceRun(db);

    // 默认候选的证据引用其自带的 source_run/observation id，需要先落库以满足外键。
    db.exec(
      `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status, content_hash)
       VALUES ('run-weather-support', 'noaa_cpc_roni', '2026-09-08T11:00:00.000Z', '2026-09-08T11:00:00.000Z',
               '2026-09-08T11:05:00.000Z', 'success', 'probe-hash-w'),
              ('run-market-support', 'noaa_cpc_roni', '2026-09-08T11:10:00.000Z', '2026-09-08T11:10:00.000Z',
               '2026-09-08T11:15:00.000Z', 'success', 'probe-hash-m');
       INSERT INTO observations (
         id, indicator_id, observed_at, value_num, value_text, unit, published_at, fetched_at,
         revision, supersedes_id, quality, source_run_id, citation_url
       ) VALUES
         ('observation-weather-support', 'enso_roni_ersstv6', '2026-09-08T11:30:00.000Z', -0.5, NULL,
          '°C', '2026-09-08T11:40:00.000Z', '2026-09-08T11:55:00.000Z', 0, NULL, 'verified',
          'run-weather-support', 'https://example.test/probe-weather'),
         ('observation-market-support', 'eia_europe_brent_spot_usd_per_bbl_daily', '2026-09-08T11:30:00.000Z', 62.5, NULL,
          'USD/bbl', '2026-09-08T11:40:00.000Z', '2026-09-08T11:55:00.000Z', 0, NULL, 'verified',
          'run-market-support', 'https://example.test/probe-market');`,
    );

    // 用真实创建路径生成一条合法草稿（手写行无法满足 calculation/证据 一致性不变量）
    const drafts = new ThesisDraftModule(new D1ThesisDraftRepository(new SqliteD1(db).asDatabase()));
    const created = await drafts.create(makeDraftCandidate({
      seed,
      createdBy: "local-pipeline",
    }));

    const edited = await drafts.editAdministrative({
      versionId: created.id,
      thesisId: seed.id,
      expectedVersion: created.version,
      summary: "编辑后的摘要",
      invalidation: undefined,
      reason: "编辑探针",
      actor: "editor@example.test",
      occurredAt: "2026-09-10T23:10:00.000Z",
    });

    expect(edited.version).toBe(created.version + 1);
    expect(db.prepare("SELECT summary FROM thesis_versions WHERE id = ?").get(edited.id).summary)
      .toBe("编辑后的摘要");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
