// 采集写路径真实 SQLite 回归：观测 revision 此前由 JS 先读 latest.revision 再写 +1，
// 计划期读取与写入 batch 之间存在竞态窗口（并发批次抢先落库会触发 UNIQUE 整批回滚）；
// 重试失败写入的来源健康守卫此前依赖 changes() 的跨语句语义。本文件把两条改写后的写路径
// 纳入可执行断言（建库/造数方式与 write-paths-real-sqlite 一致）。
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { SqliteD1, applyMigrations, applyBaseSeeds } from "./testing/sqlite-d1.mjs";
import { D1IngestionRepository } from "./cloudflare-ingestion";
import { D1PublicReadModelRepository } from "./cloudflare-read-models";

const SOURCE_ID = "noaa_cpc_roni";
const INDICATOR_ID = "enso_roni_ersstv6";
const OBSERVED_AT = "2026-09-01T00:00:00.000Z";
const CITED = "https://fixture.test/noaa";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  applyBaseSeeds(db);
  return db;
}

function observation(value) {
  return {
    indicatorId: INDICATOR_ID,
    observedAt: OBSERVED_AT,
    periodStart: null,
    value,
    unit: "°C",
    publishedAt: null,
    fetchedAt: "2026-09-10T21:05:00.000Z",
    quality: "estimated",
    citationUrl: CITED,
    metadata: { datasetVersion: "ERSSTv6" },
  };
}

function collectedInput({ runId, scheduledAt }, observations, status = "changed") {
  return {
    runId,
    sourceId: SOURCE_ID,
    scheduledAt,
    startedAt: "2026-09-10T21:04:00.000Z",
    finishedAt: "2026-09-10T21:06:00.000Z",
    result: {
      sourceId: SOURCE_ID,
      fetchedAt: "2026-09-10T21:05:00.000Z",
      sourcePublishedAt: null,
      etag: '"current"',
      lastModified: "Sun, 06 Sep 2026 00:00:00 GMT",
      contentType: "text/html",
      contentHash: "a".repeat(64),
      rawBody: null,
      observations,
      warnings: [],
      status,
    },
    snapshotKey: null,
    retryCount: 0,
    expectedRetryCount: null,
    retryClaimToken: null,
    nextDueAt: null,
  };
}

function failedInput({ runId, retryCount, expectedRetryCount, retryClaimToken }) {
  return {
    runId,
    sourceId: SOURCE_ID,
    scheduledAt: "2026-09-10T21:00:00.000Z",
    startedAt: "2026-09-10T21:04:00.000Z",
    finishedAt: "2026-09-10T21:06:00.000Z",
    errorCode: "NETWORK",
    errorMessage: "fixture failure",
    httpStatus: 503,
    retryable: true,
    retryCount,
    expectedRetryCount,
    retryClaimToken,
    nextRetryAt: "2026-09-10T21:11:00.000Z",
    nextDueAt: "2026-09-10T22:00:00.000Z",
  };
}

function insertSourceRunRow(db, runId) {
  db.prepare(
    `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status, content_hash)
     VALUES (?, ?, '2026-09-10T20:00:00.000Z', '2026-09-10T21:04:00.000Z',
             '2026-09-10T21:06:00.000Z', 'success', 'fixture-hash')`,
  ).run(runId, SOURCE_ID);
}

function insertFailedRunRow(db, { runId, retryCount, retryClaimToken }) {
  db.prepare(
    `INSERT INTO source_runs (
       id, source_id, scheduled_at, started_at, finished_at, status, error_code,
       retry_count, next_retry_at, retry_claim_token, retry_claim_expires_at
     ) VALUES (?, ?, '2026-09-10T21:00:00.000Z', '2026-09-10T21:04:00.000Z',
               '2026-09-10T21:06:00.000Z', 'failed', 'NETWORK', ?, ?, ?, '2099-01-01T00:00:00.000Z')`,
  ).run(runId, SOURCE_ID, retryCount, "2026-09-10T21:01:00.000Z", retryClaimToken);
}

function sourceConsecutiveFailures(db) {
  return db.prepare("SELECT consecutive_failures AS value FROM sources WHERE id = ?")
    .get(SOURCE_ID).value;
}

function revisionsForKey(db) {
  return db.prepare(
    `SELECT revision FROM observations
      WHERE indicator_id = ? AND observed_at = ? ORDER BY revision`,
  ).all(INDICATOR_ID, OBSERVED_AT).map((row) => row.revision);
}

/**
 * 在「计划期读取」与「写入 batch」之间插入钩子的 D1 包装：钩子在首个写入 batch
 * 执行前触发，用于模拟并发批次抢先落库。
 */
function d1WithWriteHook(db, onWriteBatch) {
  const inner = new SqliteD1(db).asDatabase();
  return {
    prepare: (sql) => inner.prepare(sql),
    batch: async (statements) => {
      if (onWriteBatch && statements.some((statement) => !/^\s*SELECT/i.test(statement.sql))) {
        const hook = onWriteBatch;
        onWriteBatch = null;
        hook();
      }
      return inner.batch(statements);
    },
  };
}

describe("观测 revision 内联子查询（真实 SQLite）", () => {
  it("并发批次在计划读取与写入之间抢先落库时仍连续递增，不再整批回滚", async () => {
    const db = freshDb();
    insertSourceRunRow(db, "race-run-prior");
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());

    const initial = await repository.persistCollected(
      collectedInput({ runId: "race-run-0", scheduledAt: "2026-09-10T21:00:00.000Z" }, [observation(1.4)]),
    );
    expect(initial).toMatchObject({ status: "success", observationsInserted: 1, observationsRevised: 0 });

    // 模拟并发赢家：在本批计划读取（看到 revision 0）之后、写入 batch 执行之前，
    // 先行插入 revision 1。旧实现按计划期读数写 revision 1，会撞
    // UNIQUE (indicator_id, observed_at, revision) 并整批回滚。
    const raced = new D1IngestionRepository(d1WithWriteHook(db, () => {
      db.prepare(
        `INSERT INTO observations (
           id, indicator_id, observed_at, period_start, value_num, value_text, unit,
           published_at, fetched_at, revision, supersedes_id, quality, source_run_id,
           citation_url, metadata_json
         ) VALUES ('race-observation-1', ?, ?, NULL, 1.2, NULL, '°C', NULL,
                   '2026-09-10T21:07:00.000Z', 1, NULL, 'estimated', 'race-run-prior', ?, '{}')`,
      ).run(INDICATOR_ID, OBSERVED_AT, CITED);
    }));

    await expect(raced.persistCollected(
      collectedInput({ runId: "race-run-2", scheduledAt: "2026-09-10T22:00:00.000Z" }, [observation(1.6)]),
    )).resolves.toMatchObject({ status: "success", observationsInserted: 0, observationsRevised: 1 });

    expect(revisionsForKey(db)).toEqual([0, 1, 2]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("重复提交完全相同的观测仍被去重（sameObservation 语义保留）", async () => {
    const db = freshDb();
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());

    await repository.persistCollected(
      collectedInput({ runId: "dedup-run-1", scheduledAt: "2026-09-10T21:00:00.000Z" }, [observation(1.4)]),
    );
    const repeated = await repository.persistCollected(
      collectedInput({ runId: "dedup-run-2", scheduledAt: "2026-09-10T22:00:00.000Z" }, [observation(1.4)]),
    );

    expect(repeated).toMatchObject({ status: "success", observationsInserted: 0, observationsRevised: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM observations").get().count).toBe(1);
    expect(revisionsForKey(db)).toEqual([0]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("顺序修订时 revision 由写入语句内计算并回填 supersedes_id", async () => {
    const db = freshDb();
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());

    await repository.persistCollected(
      collectedInput({ runId: "revise-run-1", scheduledAt: "2026-09-10T21:00:00.000Z" }, [observation(1.4)]),
    );
    await repository.persistCollected(
      collectedInput({ runId: "revise-run-2", scheduledAt: "2026-09-10T22:00:00.000Z" }, [observation(1.6)]),
    );

    expect(revisionsForKey(db)).toEqual([0, 1]);
    const rows = db.prepare(
      `SELECT id, revision, supersedes_id, value_num FROM observations
        WHERE indicator_id = ? AND observed_at = ? ORDER BY revision`,
    ).all(INDICATOR_ID, OBSERVED_AT);
    expect(rows[1]).toMatchObject({
      revision: 1,
      supersedes_id: rows[0].id,
      value_num: 1.6,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("重试失败写入的 claim token 守卫（真实 SQLite）", () => {
  it("合法持有 claim 的失败写入推进来源健康并清空 token", async () => {
    const db = freshDb();
    insertFailedRunRow(db, { runId: "guard-run-1", retryCount: 1, retryClaimToken: "holder-a" });
    const before = sourceConsecutiveFailures(db);
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());

    const result = await repository.persistFailed(
      failedInput({ runId: "guard-run-1", retryCount: 1, expectedRetryCount: 0, retryClaimToken: "holder-a" }),
    );

    expect(result).toMatchObject({ id: "guard-run-1", status: "failed", retryCount: 1 });
    expect(sourceConsecutiveFailures(db)).toBe(before + 1);
    const run = db.prepare("SELECT error_code, next_retry_at, retry_claim_token FROM source_runs WHERE id = ?")
      .get("guard-run-1");
    expect(run).toEqual({ error_code: "NETWORK", next_retry_at: "2026-09-10T21:11:00.000Z", retry_claim_token: null });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("丢失 claim 的过期 worker 失败写入不再推进来源健康", async () => {
    const db = freshDb();
    insertFailedRunRow(db, { runId: "guard-run-2", retryCount: 2, retryClaimToken: "current-holder" });
    const before = sourceConsecutiveFailures(db);
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());

    const result = await repository.persistFailed(
      failedInput({
        runId: "guard-run-2",
        retryCount: 2,
        expectedRetryCount: 1,
        retryClaimToken: "stale-worker",
      }),
    );

    // 过期 worker 的写入未生效：失败计数不动、原 claim 未被覆写，返回库内已有 run。
    expect(result).toMatchObject({ id: "guard-run-2", status: "failed", retryCount: 2 });
    expect(sourceConsecutiveFailures(db)).toBe(before);
    const run = db.prepare(
      "SELECT error_code, retry_claim_token, retry_count FROM source_runs WHERE id = ?",
    ).get("guard-run-2");
    expect(run).toEqual({ error_code: "NETWORK", retry_claim_token: "current-holder", retry_count: 2 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

// D4:B（2026-09-26）：partial 采集的 degraded 三分态端到端回归（真实 SQLite）。
// partial 刷新 sources.last_success_at（数据确实到达），不清零/不累加失败计数与错误码；
// 读取端由「最新完结 run 为 partial」派生 degraded；一次全成功恢复 healthy 并记录
// source_health 变化（before.status = degraded）。
describe("partial 采集的 degraded 健康态（真实 SQLite）", () => {
  it("partial 刷新 last_success_at 并派生 degraded，失败计数与错误码保持", async () => {
    const db = freshDb();
    db.prepare(
      `UPDATE sources SET last_success_at = '2026-09-01T00:00:00.000Z',
              consecutive_failures = 1, last_error_code = 'NETWORK' WHERE id = ?`,
    ).run(SOURCE_ID);
    db.prepare(
      `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status, content_hash)
       VALUES (?, ?, '2026-09-10T20:00:00.000Z', '2026-09-10T20:04:00.000Z',
               '2026-09-10T20:06:00.000Z', 'success', 'fixture-hash')`,
    ).run("partial-history-1", SOURCE_ID);
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());

    const result = await repository.persistCollected(
      collectedInput({ runId: "partial-run-1", scheduledAt: "2026-09-10T21:00:00.000Z" }, [observation(1.4)], "partial"),
    );

    expect(result).toMatchObject({ status: "partial", observationsInserted: 1 });
    const source = db.prepare(
      "SELECT last_success_at, consecutive_failures, last_error_code FROM sources WHERE id = ?",
    ).get(SOURCE_ID);
    // partial 刷新数据到达时刻；失败计数与错误码保持（不清零、不累加）。
    expect(source).toEqual({
      last_success_at: "2026-09-10T21:06:00.000Z",
      consecutive_failures: 1,
      last_error_code: "NETWORK",
    });
    const readModels = new D1PublicReadModelRepository(new SqliteD1(db).asDatabase());
    const health = await readModels.dataHealth("2026-09-10T21:07:00.000Z");
    expect(health.sources.find((entry) => entry.sourceId === SOURCE_ID)?.status).toBe("degraded");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("partial 之后一次全成功恢复 healthy 并记录 degraded 来源健康变化", async () => {
    const db = freshDb();
    db.prepare(
      `UPDATE sources SET last_success_at = '2026-09-01T00:00:00.000Z',
              consecutive_failures = 1, last_error_code = 'NETWORK' WHERE id = ?`,
    ).run(SOURCE_ID);
    db.prepare(
      `INSERT INTO source_runs (id, source_id, scheduled_at, started_at, finished_at, status, content_hash)
       VALUES (?, ?, '2026-09-10T20:00:00.000Z', '2026-09-10T20:04:00.000Z',
               '2026-09-10T20:06:00.000Z', 'success', 'fixture-hash')`,
    ).run("partial-history-2", SOURCE_ID);
    const repository = new D1IngestionRepository(new SqliteD1(db).asDatabase());
    await repository.persistCollected(
      collectedInput({ runId: "partial-run-2", scheduledAt: "2026-09-10T21:00:00.000Z" }, [observation(1.4)], "partial"),
    );

    const recovered = await repository.persistCollected(
      collectedInput({ runId: "success-run-2", scheduledAt: "2026-09-10T22:00:00.000Z" }, [observation(1.6)], "changed"),
    );

    expect(recovered).toMatchObject({ status: "success", recovered: true });
    const source = db.prepare(
      "SELECT consecutive_failures, last_error_code FROM sources WHERE id = ?",
    ).get(SOURCE_ID);
    expect(source).toEqual({ consecutive_failures: 0, last_error_code: null });
    const change = db.prepare(
      "SELECT id, change_type, before_json, after_json FROM changes WHERE change_type = 'source_health'",
    ).get();
    expect(change).toMatchObject({ change_type: "source_health" });
    expect(JSON.parse(change.before_json)).toMatchObject({
      status: "degraded",
      consecutiveFailures: 1,
      lastErrorCode: "NETWORK",
    });
    expect(JSON.parse(change.after_json)).toMatchObject({ status: "healthy", consecutiveFailures: 0 });
    const readModels = new D1PublicReadModelRepository(new SqliteD1(db).asDatabase());
    const health = await readModels.dataHealth("2026-09-10T22:07:00.000Z");
    expect(health.sources.find((entry) => entry.sourceId === SOURCE_ID)?.status).toBe("healthy");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
