ALTER TABLE thesis_versions
  ADD COLUMN status_transition_id TEXT CHECK (
    status_transition_id IS NULL OR (
      length(status_transition_id) BETWEEN 1 AND 128
      AND length(trim(status_transition_id)) > 0
    )
  );

CREATE UNIQUE INDEX idx_thesis_versions_status_transition
  ON thesis_versions(status_transition_id)
  WHERE status_transition_id IS NOT NULL;

-- A version ID is globally unique, but publication pointers also need to prove
-- that the referenced version belongs to the same thesis as the pointer row.
CREATE UNIQUE INDEX idx_thesis_versions_thesis_identity
  ON thesis_versions(thesis_id, id);

CREATE TABLE thesis_publications (
  thesis_id TEXT PRIMARY KEY REFERENCES theses(id),
  current_version_id TEXT,
  previous_version_id TEXT,
  cache_token TEXT NOT NULL UNIQUE CHECK (
    length(cache_token) BETWEEN 1 AND 128
    AND length(trim(cache_token)) > 0
  ),
  last_transition_id TEXT NOT NULL UNIQUE CHECK (
    length(last_transition_id) BETWEEN 1 AND 128
    AND length(trim(last_transition_id)) > 0
  ),
  updated_at TEXT NOT NULL,
  CHECK (current_version_id IS NULL OR current_version_id <> previous_version_id),
  FOREIGN KEY (thesis_id, current_version_id)
    REFERENCES thesis_versions(thesis_id, id),
  FOREIGN KEY (thesis_id, previous_version_id)
    REFERENCES thesis_versions(thesis_id, id)
);

CREATE INDEX idx_thesis_publications_current
  ON thesis_publications(current_version_id);

-- Preserve the public projection when upgrading a database that already contains
-- published thesis versions. Future transitions own this pointer explicitly; the
-- migration only establishes the most recent historical published version.
INSERT INTO thesis_publications (
  thesis_id,
  current_version_id,
  previous_version_id,
  cache_token,
  last_transition_id,
  updated_at
)
SELECT
  current.thesis_id,
  current.id,
  (
    SELECT previous.id
      FROM thesis_versions previous
     WHERE previous.thesis_id = current.thesis_id
       AND previous.status = 'published'
       AND previous.version < current.version
     ORDER BY previous.version DESC
     LIMIT 1
  ),
  'migration-0004-cache-' || lower(hex(randomblob(16))),
  'migration-0004-transition-' || lower(hex(randomblob(16))),
  COALESCE(current.published_at, current.created_at)
FROM thesis_versions current
WHERE current.status = 'published'
  AND current.version = (
    SELECT MAX(candidate.version)
      FROM thesis_versions candidate
     WHERE candidate.thesis_id = current.thesis_id
       AND candidate.status = 'published'
  );
