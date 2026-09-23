ALTER TABLE thesis_versions
  ADD COLUMN draft_key TEXT CHECK (
    draft_key IS NULL OR (
      length(draft_key) = 87
      AND substr(draft_key, 1, 23) = 'thesis-draft-v1:sha256:'
      AND substr(draft_key, 24) NOT GLOB '*[^0-9a-f]*'
    )
  );

CREATE UNIQUE INDEX idx_thesis_versions_draft_key
  ON thesis_versions(draft_key)
  WHERE draft_key IS NOT NULL;
