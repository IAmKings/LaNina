import { readFileSync } from "node:fs";
import { URL } from "node:url";

const ROOT = new URL("../../../../../", import.meta.url);

const MIGRATIONS = [
  "0001_initial.sql",
  "0002_source_retry_health.sql",
  "0003_thesis_draft_idempotency.sql",
  "0004_thesis_publication_state.sql",
  "0005_daily_brief_freeze.sql",
  "0006_public_category_projection.sql",
  "0007_admin_runs_projection.sql",
  "0008_admin_manual_source_runs.sql",
];

const BASE_SEEDS = [
  "seeds/0001_theses.sql",
  "seeds/0002_sources_indicators.sql",
  "seeds/0003_regional_rainfall.sql",
  "seeds/0004_usda_fas_psd.sql",
  "seeds/0005_eia_europe_brent.sql",
  "seeds/0006_world_bank_jpx.sql",
  "seeds/0007_structural_proxies.sql",
];

export function readRepoFile(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

/** Applies every migration in order; a fresh database ends up at the shipped schema. */
export function applyMigrations(database) {
  for (const migration of MIGRATIONS) database.exec(readRepoFile(`migrations/${migration}`));
}

export function applyBaseSeeds(database) {
  for (const seed of BASE_SEEDS) database.exec(readRepoFile(seed));
}

/**
 * The documented local-only test publication seed. It is exercised here exactly as the npm script
 * runs it, so a broken seed file fails in CI instead of in a developer's terminal.
 */
export function applyLocalDemoSeed(database) {
  database.exec(readRepoFile("seeds/9001_test_only_local_demo_publication.sql"));
}

/**
 * Minimal `node:sqlite` → D1 adapter for adapter tests. It implements the subset the public
 * read-model and publication adapters use: `batch`, `prepare().bind().first()/all()/run()`.
 */
export class SqliteD1 {
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
      all: async () => {
        const rows = this.database.prepare(sql).all(...values);
        return { success: true, results: rows };
      },
      run: async () => {
        const info = this.database.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
  }
}
