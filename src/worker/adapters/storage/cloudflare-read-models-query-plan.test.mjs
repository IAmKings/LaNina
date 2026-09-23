import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_PUBLISHED_THESES_QUERY,
  CURRENT_PUBLISHED_THESIS_QUERY,
  OVERVIEW_PUBLISHED_THESES_QUERY,
  PUBLIC_INDICATOR_SERIES_QUERY,
  publicChangesQueryForPlan,
} from "./cloudflare-read-models";
import { adminDraftReviewQueryForPlan, adminRunsQueryForPlan } from "./cloudflare-admin-read-models";

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

      const query = publicChangesQueryForPlan();
      const details = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map((row) => row.detail);

      expect(details.join("\n")).toMatch(/SCAN change USING INDEX idx_changes_detected/);
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

function readFile(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}
