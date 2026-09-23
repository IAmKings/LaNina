-- Category Read Models begin with an active market category, then follow its
-- explicit public-version pointer. This avoids scanning all thesis rows as the
-- research catalog grows.
CREATE INDEX idx_theses_category_active
  ON theses(category, active, id);
