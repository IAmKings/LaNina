-- A manual run is a private command record, not a replacement for immutable source_runs.
-- The source/key uniqueness prevents duplicate operator retries from dispatching again.
CREATE TABLE admin_source_run_operations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  idempotency_key TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('dispatching', 'completed', 'failed')),
  run_id TEXT REFERENCES source_runs(id),
  collection_status TEXT CHECK (collection_status IN ('changed', 'unchanged', 'partial', 'failed', 'already_processed', 'retry_not_due')),
  run_status TEXT CHECK (run_status IN ('success', 'unchanged', 'partial', 'failed')),
  observations_inserted INTEGER CHECK (observations_inserted >= 0),
  observations_revised INTEGER CHECK (observations_revised >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (source_id, idempotency_key),
  CHECK (
    (status = 'dispatching' AND run_id IS NULL AND collection_status IS NULL AND run_status IS NULL
      AND observations_inserted IS NULL AND observations_revised IS NULL AND completed_at IS NULL)
    OR
    (status IN ('completed', 'failed') AND run_id IS NOT NULL AND collection_status IS NOT NULL
      AND run_status IS NOT NULL AND observations_inserted IS NOT NULL AND observations_revised IS NOT NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_admin_source_run_operations_created
  ON admin_source_run_operations(created_at DESC, id DESC);
