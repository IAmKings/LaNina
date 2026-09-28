import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_PUBLISHED_THESES_QUERY,
  CURRENT_PUBLISHED_THESIS_QUERY,
  CURRENT_THESIS_INDICATOR_SERIES_QUERY,
  OVERVIEW_PUBLISHED_THESES_QUERY,
  PUBLIC_INDICATOR_SERIES_QUERY,
  dataHealthQuery,
  feedChangesQueryForPlan,
  publicChangesQueryForPlan,
} from "./cloudflare-read-models";
import { adminDraftReviewQueryForPlan, adminRunsQueryForPlan } from "./cloudflare-admin-read-models";
import { SOURCE_CURSOR_QUERY } from "./cloudflare-ingestion";
import { SOURCE_HEALTH_SNAPSHOT_QUERY } from "./cloudflare-daily-briefs";
import { evaluationInputsQueryForPlan } from "./cloudflare-daily-schedule";

const ROOT = new URL("../../../../", import.meta.url);

describe("overview published-thesis query plan", () => {
  it("uses the public pointer and primary version identity instead of scanning versions per card", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));

      const details = database.prepare(`EXPLAIN QUERY PLAN ${OVERVIEW_PUBLISHED_THESES_QUERY}`)
        .all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SEARCH publication USING INDEX sqlite_autoindex_thesis_publications_1/);
      expect(details.join("\n")).toMatch(/SEARCH version USING INDEX idx_thesis_versions_thesis_identity/);
      expect(details.join("\n")).not.toMatch(/SCAN version/);
    } finally {
      database.close();
    }
  });
});

describe("market category query plan", () => {
  it("uses the category-active index before following published pointers", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));
      database.exec(readFile("migrations/0006_public_category_projection.sql"));

      const details = database.prepare(
        `EXPLAIN QUERY PLAN ${CATEGORY_PUBLISHED_THESES_QUERY.replace("?", "'rubber'")}`,
      ).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SEARCH thesis USING INDEX idx_theses_category_active/);
      expect(details.join("\n")).toMatch(/SEARCH publication USING INDEX sqlite_autoindex_thesis_publications_1/);
      expect(details.join("\n")).toMatch(/SEARCH version USING INDEX idx_thesis_versions_thesis_identity/);
      expect(details.join("\n")).not.toMatch(/SCAN thesis/);
    } finally {
      database.close();
    }
  });
});

describe("thesis detail query plan", () => {
  it("starts from the unique public slug, then follows the publication pointer", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));

      const details = database.prepare(
        `EXPLAIN QUERY PLAN ${CURRENT_PUBLISHED_THESIS_QUERY.replace("?", "'enso-core'")}`,
      ).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SEARCH thesis USING INDEX sqlite_autoindex_theses_2/);
      expect(details.join("\n")).toMatch(/SEARCH publication USING INDEX sqlite_autoindex_thesis_publications_1/);
      expect(details.join("\n")).toMatch(/SEARCH version USING INDEX idx_thesis_versions_thesis_identity/);
      expect(details.join("\n")).not.toMatch(/SCAN version/);
    } finally {
      database.close();
    }
  });
});

describe("public indicator-series query plan", () => {
  it("uses the indicator/time index for the bounded raw observation range", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));

      const details = database.prepare(`EXPLAIN QUERY PLAN ${PUBLIC_INDICATOR_SERIES_QUERY}`)
        .all(
          "2026-09-01T00:00:00.000Z",
          "2026-09-10T00:00:00.000Z",
          "enso_roni_ersstv6",
          1001,
        )
        .map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SEARCH indicator USING INDEX sqlite_autoindex_indicators_1/);
      expect(details.join("\n")).toMatch(
        /SEARCH observation USING INDEX idx_observations_indicator_observed \(indicator_id=\? AND observed_at>\? AND observed_at<\?\)/,
      );
      expect(details.join("\n")).not.toMatch(/SCAN observation/);
    } finally {
      database.close();
    }
  });
});

describe("public changes query plan", () => {
  it("walks the chronological changes index rather than materializing private payloads", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0002_source_retry_health.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));
      database.exec(readFile("migrations/0013_changes_query_indexes.sql"));

      const query = publicChangesQueryForPlan();
      const details = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SCAN change USING INDEX idx_changes_detected_id/);
      // 0013 的 (detected_at DESC, id DESC) 复合索引吸收了 id 平局裁决：
      // 分页排序不得再退化出 TEMP B-TREE（旧 idx_changes_detected 单列索引会）。
      expect(details.join("\n")).not.toMatch(/USE TEMP B-TREE/);
      expect(details.join("\n")).not.toMatch(/SCAN change(?!\s+USING)/);
      expect(query).not.toMatch(/before_json|after_json|snapshot_key|metadata_json/i);
    } finally {
      database.close();
    }
  });

  it("serves the Atom feed from an index walk without an order-by sort", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0002_source_retry_health.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));
      database.exec(readFile("migrations/0013_changes_query_indexes.sql"));

      const query = feedChangesQueryForPlan();
      const details = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SCAN change USING INDEX idx_changes_detected_id/);
      expect(details.join("\n")).not.toMatch(/USE TEMP B-TREE/);
      expect(query).toContain("change.importance >= ?");
      expect(query).not.toMatch(/before_json|after_json|snapshot_key|metadata_json/i);
    } finally {
      database.close();
    }
  });
});

describe("admin runs query plan", () => {
  it("walks the schedule cursor index and does not project private run internals", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0007_admin_runs_projection.sql"));

      const query = adminRunsQueryForPlan();
      const details = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SCAN run USING INDEX idx_source_runs_scheduled_id/);
      expect(query).not.toMatch(/error_message|snapshot_key|content_hash|etag|last_modified|metadata_json/i);
    } finally {
      database.close();
    }
  });
});

describe("admin draft review query plan", () => {
  it("starts from the thesis primary key and follows only current publication and draft-version indexes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));

      const query = adminDraftReviewQueryForPlan();
      const details = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SEARCH thesis USING INDEX sqlite_autoindex_theses_1/);
      expect(details.join("\n")).toMatch(/SEARCH publication USING INDEX sqlite_autoindex_thesis_publications_1/);
      expect(query).not.toMatch(/calculation_json|evidence|observation|source_run|snapshot|audit/i);
    } finally {
      database.close();
    }
  });
});

describe("source cursor query plan", () => {
  it("finds the latest successful run through the finished_at index instead of sorting run history", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0011_source_runs_finished_index.sql"));

      const details = database.prepare(`EXPLAIN QUERY PLAN ${SOURCE_CURSOR_QUERY}`)
        .all("noaa_cpc_roni").map((row) => row.detail);

      expect(details.join("\n")).toMatch(
        /SEARCH source_runs USING INDEX idx_source_runs_source_status_finished \(source_id=\? AND status=\?\)/,
      );
      expect(details.join("\n")).not.toMatch(/SCAN source_runs/);
    } finally {
      database.close();
    }
  });
});

describe("daily brief source-health snapshot query plan", () => {
  it("resolves per-source last success and failure streaks through the finished_at index", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0002_source_retry_health.sql"));
      database.exec(readFile("migrations/0011_source_runs_finished_index.sql"));

      const details = database.prepare(`EXPLAIN QUERY PLAN ${SOURCE_HEALTH_SNAPSHOT_QUERY}`)
        .all(
          "2026-09-09T22:30:00.000Z",
          "2026-09-09T22:30:00.000Z",
          "2026-09-09T22:30:00.000Z",
          "2026-09-09T22:30:00.000Z",
        ).map((row) => row.detail);

      expect(details.join("\n")).toMatch(
        /SEARCH successful USING INDEX idx_source_runs_source_status_finished \(source_id=\? AND status=\? AND finished_at>\? AND finished_at<\?\)/,
      );
      expect(details.join("\n")).toMatch(
        /SEARCH failed USING INDEX idx_source_runs_source_status_finished/,
      );
      expect(details.join("\n")).not.toMatch(/SCAN source_runs/);
    } finally {
      database.close();
    }
  });
});

describe("daily evaluation inputs query plan", () => {
  it("deduplicates revisions on the observation index and keeps the structural row guard", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));

      const query = evaluationInputsQueryForPlan(3);
      const details = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all(
        "enso_roni_ersstv6",
        "eia_europe_brent_spot_usd_per_bbl_daily",
        "regional_rainfall_southern_africa_maize_v1",
        "2026-09-09T22:30:00.000Z",
      ).map((row) => row.detail);

      expect(details.join("\n")).toMatch(
        /SEARCH latest_rows USING COVERING INDEX idx_observations_indicator_observed \(indicator_id=\?\)/,
      );
      expect(details.join("\n")).toMatch(
        /SEARCH observation USING INDEX sqlite_autoindex_observations_2 \(indicator_id=\? AND observed_at=\? AND revision=\?\)/,
      );
      expect(details.join("\n")).not.toMatch(/SCAN latest_rows|SCAN observation/);
      expect(query).toContain("LIMIT 50000");
      // 语义红线：NOAA（1950 起）、World Bank 年度序列等多年历史观测是合法评估输入，
      // 禁止为收敛规模加 observed_at 下界。
      expect(query).not.toMatch(/observed_at >=|observed_at >/);
    } finally {
      database.close();
    }
  });
});

describe("data health query plan", () => {
  it("aggregates the seven-day success rate from the covering finished_at index", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0002_source_retry_health.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));
      database.exec(readFile("migrations/0011_source_runs_finished_index.sql"));

      const details = database.prepare(`EXPLAIN QUERY PLAN ${dataHealthQuery()}`)
        .all("2026-09-02T23:00:00.000Z").map((row) => row.detail);

      expect(details.join("\n")).toMatch(
        /SEARCH run USING COVERING INDEX idx_source_runs_source_status_finished \(source_id=\?\)/,
      );
      expect(details.join("\n")).not.toMatch(/SCAN run/);
    } finally {
      database.close();
    }
  });
});

describe("thesis detail indicator-series query plan", () => {
  it("ranks the bounded observation window through the indicator/time index", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFile("migrations/0001_initial.sql"));
      database.exec(readFile("migrations/0004_thesis_publication_state.sql"));

      const details = database.prepare(`EXPLAIN QUERY PLAN ${CURRENT_THESIS_INDICATOR_SERIES_QUERY}`)
        .all("enso-core").map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SEARCH thesis USING INDEX sqlite_autoindex_theses_2 \(slug=\?\)/);
      expect(details.join("\n")).toMatch(
        /SEARCH observation USING INDEX idx_observations_indicator_observed \(indicator_id=\?\)/,
      );
      expect(details.join("\n")).not.toMatch(/SCAN observation/);
    } finally {
      database.close();
    }
  });
});

function readFile(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}
