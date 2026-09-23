// 手动来源运行真实 SQLite 回归：D1ManualSourceRunRepository 的 SQL 此前从未在真实
// schema 上执行过（模块测试用内存仓储），本文件把它纳入真实可执行断言。
// runner 注入为固定 outcome（无网络），数据库经迁移 0001-0008 + 基础种子构造。
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { SqliteD1, applyMigrations, applyBaseSeeds } from "./testing/sqlite-d1.mjs";
import { ManualSourceRunModule } from "../../modules/manual-source-runs";
import { D1ManualSourceRunRepository } from "./cloudflare-manual-source-runs";

const TARGET = {
  sourceId: "noaa_cpc_roni",
  sourceUrl: "https://code-owned.example.test/noaa",
  adapterKey: "noaa-cpc-roni-v6",
  requiredSecret: null,
};

function freshDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applyBaseSeeds(db);
  return db;
}

function outcome() {
  return {
    collectionStatus: "changed",
    run: {
      id: "run-manual-safe",
      sourceId: TARGET.sourceId,
      scheduledAt: "2026-09-10T01:00:00.000Z",
      status: "success",
      snapshotKey: "raw/private/never-returned",
      observationsInserted: 1,
      observationsRevised: 0,
      errorCode: null,
      retryCount: 0,
      nextRetryAt: null,
      recovered: false,
    },
    snapshotKey: null,
    observations: [],
  };
}

function input(overrides = {}) {
  return {
    sourceId: TARGET.sourceId,
    reason: "核对 NOAA 更新",
    idempotencyKey: "probe-idem-key-1",
    actor: { email: "editor@example.test", roles: ["editor"] },
    occurredAt: "2026-09-10T01:00:00.000Z",
    scheduledAt: "2026-09-10T01:00:00.000Z",
    operationId: "probe-operation-1",
    ...overrides,
  };
}

function preSeedRun(db) {
  db.prepare(
    `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status, content_hash)
     VALUES ('run-manual-safe', 'noaa_cpc_roni', '2026-09-10T01:00:00.000Z', '2026-09-10T01:00:00.000Z',
             '2026-09-10T01:01:00.000Z', 'success', 'manual-demo-hash')`,
  ).run();
}

function buildModule(db) {
  const runner = async () => outcome();
  return new ManualSourceRunModule(
    new D1ManualSourceRunRepository(new SqliteD1(db).asDatabase()),
    (id) => (id === TARGET.sourceId ? TARGET : null),
    new Map([[TARGET.adapterKey, { key: TARGET.adapterKey, collect: async () => { throw new Error("not used"); } }]]),
    runner,
  );
}

describe("手动来源运行真实 SQLite 回归", () => {
  it("查找到已启用来源并完成两阶段落库与审计", async () => {
    const db = freshDb();
    preSeedRun(db);
    const result = await buildModule(db).run(input());

    expect(result).toMatchObject({
      status: "completed",
      replayed: false,
      run: { id: "run-manual-safe", errorCode: null },
    });

    const operation = db.prepare(
      "SELECT status, source_id, idempotency_key FROM admin_source_run_operations WHERE id = 'probe-operation-1'",
    ).get();
    expect(operation).toMatchObject({ status: "completed", source_id: TARGET.sourceId });

    expect(
      db.prepare(
        "SELECT COUNT(*) AS count FROM audit_log WHERE action IN ('manual_run_requested', 'manual_run_completed')",
      ).get().count,
    ).toBe(2);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("幂等键重放只审计一次且不改写历史", async () => {
    const db = freshDb();
    preSeedRun(db);
    const first = await buildModule(db).run(input());
    const replay = await buildModule(db).run(input({ operationId: "probe-operation-ignored-on-replay" }));

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ status: "completed", replayed: true, operationId: "probe-operation-1" });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM admin_source_run_operations WHERE idempotency_key = ?")
        .get("probe-idem-key-1").count,
    ).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("未启用来源在访问方案映射前即被拒绝", async () => {
    const db = freshDb();
    db.prepare("UPDATE sources SET enabled = 0 WHERE id = 'noaa_cpc_roni'").run();
    await expect(buildModule(db).run(input())).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM admin_source_run_operations").get().count,
    ).toBe(0);
  });
});
