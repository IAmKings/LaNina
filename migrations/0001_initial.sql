PRAGMA foreign_keys = ON;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  homepage_url TEXT NOT NULL,
  license_url TEXT,
  adapter_key TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL CHECK (cadence_minutes > 0),
  late_after_minutes INTEGER NOT NULL CHECK (late_after_minutes >= cadence_minutes),
  stale_after_minutes INTEGER NOT NULL CHECK (stale_after_minutes >= late_after_minutes),
  next_due_at TEXT,
  last_success_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  redistribution TEXT NOT NULL CHECK (redistribution IN ('allowed', 'derived_only', 'unknown', 'forbidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  scheduled_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'unchanged', 'partial', 'failed')),
  http_status INTEGER,
  etag TEXT,
  last_modified TEXT,
  snapshot_key TEXT,
  content_hash TEXT,
  observations_inserted INTEGER NOT NULL DEFAULT 0 CHECK (observations_inserted >= 0),
  observations_revised INTEGER NOT NULL DEFAULT 0 CHECK (observations_revised >= 0),
  error_code TEXT,
  error_message TEXT,
  UNIQUE (source_id, scheduled_at)
);

CREATE TABLE indicators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('climate', 'rubber', 'agriculture', 'shipping', 'market', 'control')),
  geography TEXT NOT NULL,
  unit TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('intraday', 'daily', 'weekly', 'monthly', 'seasonal', 'event')),
  source_id TEXT NOT NULL REFERENCES sources(id),
  definition TEXT NOT NULL,
  higher_means TEXT NOT NULL CHECK (higher_means IN ('pressure', 'relief', 'context')),
  public INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0, 1))
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  indicator_id TEXT NOT NULL REFERENCES indicators(id),
  observed_at TEXT NOT NULL,
  period_start TEXT,
  value_num REAL,
  value_text TEXT,
  unit TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  supersedes_id TEXT REFERENCES observations(id),
  quality TEXT NOT NULL CHECK (quality IN ('verified', 'provisional', 'estimated', 'manual', 'invalid')),
  source_run_id TEXT NOT NULL REFERENCES source_runs(id),
  citation_url TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  CHECK ((value_num IS NOT NULL) <> (value_text IS NOT NULL)),
  UNIQUE (indicator_id, observed_at, revision)
);

CREATE TABLE theses (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('climate', 'rubber', 'agriculture', 'shipping')),
  region TEXT NOT NULL,
  market_scope TEXT NOT NULL,
  owner TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE thesis_versions (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES theses(id),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'withdrawn')),
  direction TEXT NOT NULL CHECK (direction IN ('bullish', 'bearish', 'neutral', 'mixed')),
  stage TEXT NOT NULL CHECK (stage IN ('watch', 'weather_realized', 'physical_pressure', 'balance_tightening', 'market_confirmed', 'easing')),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  summary TEXT NOT NULL CHECK (length(summary) <= 500),
  invalidation TEXT NOT NULL,
  calculation_json TEXT NOT NULL,
  based_on_cutoff TEXT NOT NULL,
  created_by TEXT NOT NULL,
  published_by TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  change_reason TEXT,
  UNIQUE (thesis_id, version)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  thesis_version_id TEXT NOT NULL REFERENCES thesis_versions(id),
  observation_id TEXT REFERENCES observations(id),
  source_run_id TEXT REFERENCES source_runs(id),
  stance TEXT NOT NULL CHECK (stance IN ('supports', 'refutes', 'context')),
  layer TEXT NOT NULL CHECK (layer IN ('forecast', 'weather', 'physical', 'balance', 'market', 'control')),
  weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
  summary TEXT NOT NULL,
  citation_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  CHECK (observation_id IS NOT NULL OR source_run_id IS NOT NULL)
);

CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  change_type TEXT NOT NULL CHECK (change_type IN ('observation', 'revision', 'threshold', 'thesis', 'source_health', 'manual')),
  thesis_id TEXT REFERENCES theses(id),
  indicator_id TEXT REFERENCES indicators(id),
  before_json TEXT,
  after_json TEXT NOT NULL,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
  detected_at TEXT NOT NULL,
  published_version_id TEXT REFERENCES thesis_versions(id),
  CHECK (thesis_id IS NOT NULL OR indicator_id IS NOT NULL)
);

CREATE TABLE daily_briefs (
  brief_date TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'withdrawn')),
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  top_changes_json TEXT NOT NULL DEFAULT '[]',
  data_cutoff TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT
);

CREATE TABLE daily_brief_theses (
  brief_date TEXT NOT NULL REFERENCES daily_briefs(brief_date),
  thesis_id TEXT NOT NULL REFERENCES theses(id),
  thesis_version_id TEXT NOT NULL REFERENCES thesis_versions(id),
  PRIMARY KEY (brief_date, thesis_id)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE INDEX idx_source_runs_source_started ON source_runs(source_id, started_at DESC);
CREATE INDEX idx_source_runs_status_started ON source_runs(status, started_at DESC);
CREATE INDEX idx_observations_indicator_observed ON observations(indicator_id, observed_at DESC, revision DESC);
CREATE INDEX idx_observations_source_run ON observations(source_run_id);
CREATE INDEX idx_thesis_versions_status_published ON thesis_versions(thesis_id, status, published_at DESC);
CREATE INDEX idx_evidence_version_stance_order ON evidence(thesis_version_id, stance, sort_order);
CREATE INDEX idx_changes_detected ON changes(detected_at DESC);
CREATE INDEX idx_changes_thesis_detected ON changes(thesis_id, detected_at DESC);
