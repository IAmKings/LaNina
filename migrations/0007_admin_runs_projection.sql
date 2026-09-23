-- The admin run list is ordered by its immutable schedule key. This index keeps
-- its cursor pagination bounded without reading every historical source run.
CREATE INDEX idx_source_runs_scheduled_id
  ON source_runs(scheduled_at DESC, id DESC);
