/**
 * Local pipeline trigger — runs the real scheduled handler against the local D1 file.
 *
 * This is the missing "how do I trigger collection and evaluation locally" entry point:
 * the Vite dev server does not expose a scheduled endpoint, and `wrangler dev --test-scheduled`
 * cannot boot this Worker (its named constant exports are not handler exports). So the three
 * scheduled jobs are invoked here through the same `handleScheduled` the Cron Triggers call, with
 * the real repositories, adapters and fetch, but against the local database file.
 *
 * Usage (stop `npm run dev` first — SQLite takes a file lock):
 *   npm run local:collect    # 17 * * * *     due sources
 *   npm run local:evaluate   # 30 22 * * *    daily evaluation (06:30 CST)
 *   npm run local:publish    # 0 23 * * *     publication decision (07:00 CST)
 *
 * Nothing here is a production path: `ENABLE_CRON` is forced on for this process only, automatic
 * publication stays off unless `LOCAL_PIPELINE_AUTO_PUBLISH=true`, and the raw snapshot bucket is
 * an in-memory stub so no R2 object is written.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { handleScheduled } from "./index";
import { SqliteD1 } from "./adapters/storage/testing/sqlite-d1.mjs";

const LOCAL_D1_DIR = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";

const CRON_JOBS = {
  "17 * * * *": "采集：派发到期来源",
  "30 22 * * *": "评估：生成每日草稿（北京时间 06:30）",
  "0 23 * * *": "发布：每日判定决策（北京时间 07:00）",
};

/** The local Miniflare database file; `metadata.sqlite` is wrangler's own bookkeeping. */
function localDatabasePath() {
  const override = process.env.LOCAL_PIPELINE_DB;
  if (override !== undefined && override.length > 0) return override;
  const candidates = readdirSync(LOCAL_D1_DIR)
    .filter((entry) => entry.endsWith(".sqlite") && entry !== "metadata.sqlite")
    .map((entry) => join(LOCAL_D1_DIR, entry));
  if (candidates.length !== 1) {
    throw new Error(`期望恰好一个本地 D1 文件，实际 ${candidates.length} 个；请先 npm run db:reset:local`);
  }
  return candidates[0];
}

/** In-memory stand-in for the private raw-snapshot bucket. */
function memoryBucket() {
  const objects = [];
  return {
    objects,
    async put(key, body, options) {
      objects.push({ key, body, options });
      return { key, etag: `local-${objects.length}`, size: body?.byteLength ?? 0 };
    },
  };
}

/**
 * Consistent with the Cron Trigger contract: fixed slots fire at their own UTC time today, and an
 * hour-wildcard slot (the hourly dispatch) fires in the current UTC hour.
 */
function scheduledTimeFor(cron, now = new Date()) {
  const [minute, hour] = cron.split(" ");
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour === "*" ? now.getUTCHours() : Number(hour),
    Number(minute),
    0,
    0,
  );
}

const cron = process.env.LOCAL_PIPELINE_CRON;
const enabled = process.env.LOCAL_PIPELINE === "1" && typeof cron === "string" && cron in CRON_JOBS;

describe.skipIf(!enabled)("local pipeline trigger", () => {
  it(`${cron} — ${enabled ? CRON_JOBS[cron] : "未启用"}`, async () => {
    const databasePath = localDatabasePath();
    const database = new DatabaseSync(databasePath);
    const bucket = memoryBucket();
    const env = {
      APP_ENV: "local",
      APP_VERSION: "0.0.0-local-pipeline",
      // API keys come from the developer shell (.dev.vars / environment), never from the repo.
      USDA_FAS_API_KEY: process.env.USDA_FAS_API_KEY || undefined,
      EIA_API_KEY: process.env.EIA_API_KEY || undefined,
      CENSUS_API_KEY: process.env.CENSUS_API_KEY || undefined,
      UNCTAD_CLIENT_ID: process.env.UNCTAD_CLIENT_ID || undefined,
      UNCTAD_API_KEY: process.env.UNCTAD_API_KEY || undefined,
      ENABLE_CRON: "true",
      ENABLE_AUTO_PUBLICATION: process.env.LOCAL_PIPELINE_AUTO_PUBLISH === "true" ? "true" : "false",
      DB: new SqliteD1(database).asDatabase(),
      RAW: bucket,
      ACCESS_JWT_ISSUER: undefined,
      ACCESS_JWT_AUDIENCE: undefined,
      ACCESS_JWKS_URL: undefined,
    };

    try {
      const scheduledTime = scheduledTimeFor(cron);
      console.log(`\n[local-pipeline] ${cron} → ${new Date(scheduledTime).toISOString()}`);
      const outcome = await handleScheduled(
        { cron, scheduledTime, type: "scheduled", noRetry() {} },
        env,
      );
      console.log("[local-pipeline] 结果:", JSON.stringify(outcome, null, 2));
      console.log(`[local-pipeline] 原始快照写入（内存）: ${bucket.objects.length} 个`);
      expect(outcome).toHaveProperty("job");
    } finally {
      database.close();
    }
    // A real dispatch performs network I/O, so this is not a unit-test-sized budget.
  }, 120_000);
});
