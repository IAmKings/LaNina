PRAGMA defer_foreign_keys = ON;

ALTER TABLE source_runs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3);

ALTER TABLE source_runs
  ADD COLUMN next_retry_at TEXT;

ALTER TABLE source_runs
  ADD COLUMN retry_claim_token TEXT;

ALTER TABLE source_runs
  ADD COLUMN retry_claim_expires_at TEXT;

ALTER TABLE sources
  ADD COLUMN last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'NETWORK', 'RATE_LIMIT', 'AUTH', 'NOT_FOUND', 'SCHEMA_DRIFT',
      'VALIDATION', 'STORAGE', 'DATABASE'
    )
  );

CREATE INDEX idx_sources_enabled_due
  ON sources(enabled, next_due_at);

CREATE INDEX idx_source_runs_retry_due
  ON source_runs(status, next_retry_at, source_id);

ALTER TABLE changes RENAME TO changes_before_source_health;

CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  change_type TEXT NOT NULL CHECK (change_type IN ('observation', 'revision', 'threshold', 'thesis', 'source_health', 'manual')),
  thesis_id TEXT REFERENCES theses(id),
  indicator_id TEXT REFERENCES indicators(id),
  source_id TEXT REFERENCES sources(id),
  before_json TEXT,
  after_json TEXT NOT NULL,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  detected_at TEXT NOT NULL,
  published_version_id TEXT REFERENCES thesis_versions(id),
  CHECK (thesis_id IS NOT NULL OR indicator_id IS NOT NULL OR source_id IS NOT NULL)
);

INSERT INTO changes (
  id, change_type, thesis_id, indicator_id, source_id, before_json,
  after_json, importance, detected_at, published_version_id
)
SELECT
  id, change_type, thesis_id, indicator_id, NULL, before_json,
  after_json, importance, detected_at, published_version_id
FROM changes_before_source_health;

DROP TABLE changes_before_source_health;

CREATE INDEX idx_changes_detected ON changes(detected_at DESC);
CREATE INDEX idx_changes_thesis_detected ON changes(thesis_id, detected_at DESC);
CREATE INDEX idx_changes_source_detected ON changes(source_id, detected_at DESC);

PRAGMA defer_foreign_keys = OFF;
