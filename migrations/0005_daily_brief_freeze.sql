ALTER TABLE daily_briefs ADD COLUMN freeze_key TEXT CHECK (
  freeze_key IS NULL OR (
    length(freeze_key) BETWEEN 1 AND 160
    AND length(trim(freeze_key)) > 0
  )
);
ALTER TABLE daily_briefs ADD COLUMN methodology_snapshot_json TEXT;
ALTER TABLE daily_briefs ADD COLUMN rule_snapshot_json TEXT;
ALTER TABLE daily_briefs ADD COLUMN source_health_snapshot_json TEXT;
ALTER TABLE daily_briefs ADD COLUMN publication_attempt_id TEXT;

ALTER TABLE daily_brief_theses ADD COLUMN methodology_version TEXT;
ALTER TABLE daily_brief_theses ADD COLUMN rule_version TEXT;
ALTER TABLE daily_brief_theses ADD COLUMN sort_order INTEGER CHECK (
  sort_order IS NULL OR sort_order BETWEEN 0 AND 5
);

CREATE UNIQUE INDEX idx_daily_briefs_freeze_key
  ON daily_briefs(freeze_key)
  WHERE freeze_key IS NOT NULL;
CREATE UNIQUE INDEX idx_daily_brief_theses_order
  ON daily_brief_theses(brief_date, sort_order)
  WHERE sort_order IS NOT NULL;
CREATE INDEX idx_daily_briefs_public_date
  ON daily_briefs(status, brief_date DESC);

-- A review only authorizes one exact before/after thesis transition. The adapter
-- still derives direction/stage/confidence risk from immutable version facts.
CREATE TABLE thesis_change_reviews (
  after_version_id TEXT PRIMARY KEY REFERENCES thesis_versions(id),
  thesis_id TEXT NOT NULL,
  before_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  reason TEXT,
  CHECK (
    (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reason IS NOT NULL)
    OR status <> 'approved'
  ),
  FOREIGN KEY (thesis_id, before_version_id)
    REFERENCES thesis_versions(thesis_id, id),
  FOREIGN KEY (thesis_id, after_version_id)
    REFERENCES thesis_versions(thesis_id, id)
);

CREATE TABLE daily_brief_attempts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128 AND length(trim(id)) > 0),
  brief_date TEXT NOT NULL,
  freeze_key TEXT NOT NULL UNIQUE CHECK (
    length(freeze_key) BETWEEN 1 AND 160 AND length(trim(freeze_key)) > 0
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('published', 'delayed')),
  data_cutoff TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  top_changes_json TEXT NOT NULL,
  target_snapshot_json TEXT NOT NULL,
  methodology_snapshot_json TEXT NOT NULL,
  rule_snapshot_json TEXT NOT NULL,
  source_health_snapshot_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE daily_brief_gate_results (
  attempt_id TEXT NOT NULL REFERENCES daily_brief_attempts(id),
  gate_code TEXT NOT NULL CHECK (gate_code IN (
    'PRIMARY_SOURCE_HEALTH',
    'FREEZE_COMPLETENESS',
    'CITATION_COMPLETENESS',
    'HIGH_RISK_REVIEW'
  )),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  explanation TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  PRIMARY KEY (attempt_id, gate_code)
);

CREATE INDEX idx_daily_brief_attempts_date_created
  ON daily_brief_attempts(brief_date, created_at DESC);

-- Preserve valid daily briefs that were already public before the strict freeze
-- contract existed. Their exact thesis-version links remain authoritative; facts
-- unavailable in the old schema are marked explicitly instead of fabricated.
UPDATE daily_brief_theses
   SET methodology_version = COALESCE(
         methodology_version,
         (
           SELECT COALESCE(
             NULLIF(trim(CASE
               WHEN json_valid(version.calculation_json) = 1
               THEN json_extract(version.calculation_json, '$.methodologyVersion')
               ELSE NULL
             END), ''),
             'legacy-unavailable'
           )
             FROM thesis_versions version
            WHERE version.id = daily_brief_theses.thesis_version_id
              AND version.thesis_id = daily_brief_theses.thesis_id
         )
       ),
       rule_version = COALESCE(
         rule_version,
         (
           SELECT COALESCE(
             NULLIF(trim(CASE
               WHEN json_valid(version.calculation_json) = 1
               THEN json_extract(version.calculation_json, '$.schemaVersion')
               ELSE NULL
             END), ''),
             'legacy-unavailable'
           )
             FROM thesis_versions version
            WHERE version.id = daily_brief_theses.thesis_version_id
              AND version.thesis_id = daily_brief_theses.thesis_id
         )
       ),
       sort_order = COALESCE(sort_order, CASE thesis_id
         WHEN 'ENSO-CORE-01' THEN 0
         WHEN 'RUBBER-TH-01' THEN 1
         WHEN 'PALM-SEA-01' THEN 2
         WHEN 'MAIZE-SA-01' THEN 3
         WHEN 'SHIP-USEC-01' THEN 4
         WHEN 'SHIP-EU-01' THEN 5
         ELSE NULL
       END)
 WHERE EXISTS (
   SELECT 1 FROM daily_briefs brief
    WHERE brief.brief_date = daily_brief_theses.brief_date
      AND brief.status = 'published'
 );

UPDATE daily_briefs
   SET published_at = COALESCE(published_at, data_cutoff),
       published_by = COALESCE(NULLIF(trim(published_by), ''), 'migration-0005')
 WHERE status = 'published';

INSERT INTO daily_brief_attempts (
  id, brief_date, freeze_key, outcome, data_cutoff, headline, summary,
  top_changes_json, target_snapshot_json, methodology_snapshot_json,
  rule_snapshot_json, source_health_snapshot_json, actor, reason, created_at
)
SELECT
  'migration-0005-attempt:' || brief.brief_date,
  brief.brief_date,
  'daily-brief-freeze-legacy-v1:' || brief.brief_date,
  'published',
  brief.data_cutoff,
  brief.headline,
  brief.summary,
  brief.top_changes_json,
  (
    SELECT json_group_array(json(snapshot.value))
      FROM (
        SELECT json_object(
          'thesisId', links.thesis_id,
          'thesisVersionId', links.thesis_version_id,
          'version', version.version,
          'sortOrder', links.sort_order
        ) AS value
          FROM daily_brief_theses links
          JOIN thesis_versions version
            ON version.id = links.thesis_version_id
           AND version.thesis_id = links.thesis_id
         WHERE links.brief_date = brief.brief_date
         ORDER BY links.sort_order
      ) snapshot
  ),
  (
    SELECT json_group_array(json(snapshot.value))
      FROM (
        SELECT json_object(
          'thesisId', links.thesis_id,
          'methodologyVersion', links.methodology_version
        ) AS value
          FROM daily_brief_theses links
         WHERE links.brief_date = brief.brief_date
         ORDER BY links.sort_order
      ) snapshot
  ),
  (
    SELECT json_group_array(json(snapshot.value))
      FROM (
        SELECT json_object(
          'thesisId', links.thesis_id,
          'ruleVersion', links.rule_version
        ) AS value
          FROM daily_brief_theses links
         WHERE links.brief_date = brief.brief_date
         ORDER BY links.sort_order
      ) snapshot
  ),
  json('[]'),
  brief.published_by,
  '迁移前已发布历史内容兼容回填',
  brief.published_at
FROM daily_briefs brief
WHERE brief.status = 'published';

INSERT INTO daily_brief_gate_results (
  attempt_id, gate_code, status, explanation, reasons_json
)
SELECT
  attempt.id,
  gate.code,
  'passed',
  '迁移前已发布历史内容：新门禁上线前的兼容记录',
  json('[]')
FROM daily_brief_attempts attempt
CROSS JOIN (
  SELECT 'PRIMARY_SOURCE_HEALTH' AS code
  UNION ALL SELECT 'FREEZE_COMPLETENESS'
  UNION ALL SELECT 'CITATION_COMPLETENESS'
  UNION ALL SELECT 'HIGH_RISK_REVIEW'
) gate
WHERE attempt.id LIKE 'migration-0005-attempt:%';

UPDATE daily_briefs
   SET freeze_key = 'daily-brief-freeze-legacy-v1:' || brief_date,
       methodology_snapshot_json = (
         SELECT attempt.methodology_snapshot_json
           FROM daily_brief_attempts attempt
          WHERE attempt.id = 'migration-0005-attempt:' || daily_briefs.brief_date
       ),
       rule_snapshot_json = (
         SELECT attempt.rule_snapshot_json
           FROM daily_brief_attempts attempt
          WHERE attempt.id = 'migration-0005-attempt:' || daily_briefs.brief_date
       ),
       source_health_snapshot_json = json('[]'),
       publication_attempt_id = 'migration-0005-attempt:' || brief_date
 WHERE status = 'published';

INSERT INTO audit_log (
  id, entity_type, entity_id, action, actor, reason, before_json, after_json, created_at
)
SELECT
  'migration-0005-audit:' || brief.brief_date,
  'daily_brief',
  brief.brief_date,
  'freeze_backfill',
  brief.published_by,
  '迁移前已发布历史内容兼容回填',
  NULL,
  json_object('freezeKey', brief.freeze_key, 'attemptId', brief.publication_attempt_id),
  brief.published_at
FROM daily_briefs brief
WHERE brief.status = 'published';

CREATE TRIGGER thesis_change_reviews_identity_insert
BEFORE INSERT ON thesis_change_reviews
WHEN NOT EXISTS (
  SELECT 1
    FROM thesis_versions before_version
    JOIN thesis_versions after_version
      ON after_version.id = NEW.after_version_id
     AND after_version.thesis_id = NEW.thesis_id
   WHERE before_version.id = NEW.before_version_id
     AND before_version.thesis_id = NEW.thesis_id
)
BEGIN
  SELECT RAISE(ABORT, 'change review version identity mismatch');
END;

CREATE TRIGGER daily_brief_theses_identity_insert
BEFORE INSERT ON daily_brief_theses
WHEN NOT EXISTS (
  SELECT 1 FROM thesis_versions version
   WHERE version.id = NEW.thesis_version_id
     AND version.thesis_id = NEW.thesis_id
)
BEGIN
  SELECT RAISE(ABORT, 'daily brief thesis identity mismatch');
END;

CREATE TRIGGER daily_brief_theses_identity_update
BEFORE UPDATE ON daily_brief_theses
WHEN NOT EXISTS (
  SELECT 1 FROM thesis_versions version
   WHERE version.id = NEW.thesis_version_id
     AND version.thesis_id = NEW.thesis_id
)
BEGIN
  SELECT RAISE(ABORT, 'daily brief thesis identity mismatch');
END;

CREATE TRIGGER daily_brief_theses_published_insert
BEFORE INSERT ON daily_brief_theses
WHEN EXISTS (
  SELECT 1 FROM daily_briefs brief
   WHERE brief.brief_date = NEW.brief_date AND brief.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published daily brief links are immutable');
END;

CREATE TRIGGER daily_brief_publish_validate
BEFORE UPDATE OF status ON daily_briefs
WHEN OLD.status = 'draft' AND NEW.status = 'published'
BEGIN
  SELECT CASE WHEN
    NEW.freeze_key IS NULL
    OR NEW.publication_attempt_id IS NULL
    OR NEW.methodology_snapshot_json IS NULL
    OR NEW.rule_snapshot_json IS NULL
    OR NEW.source_health_snapshot_json IS NULL
    OR NEW.published_at IS NULL
    OR NEW.published_by IS NULL
    OR json_valid(NEW.methodology_snapshot_json) <> 1
    OR json_valid(NEW.rule_snapshot_json) <> 1
    OR json_valid(NEW.source_health_snapshot_json) <> 1
  THEN RAISE(ABORT, 'daily brief freeze metadata missing') END;

  SELECT CASE WHEN (
    SELECT COUNT(*) FROM daily_brief_theses links
     WHERE links.brief_date = NEW.brief_date
       AND links.methodology_version IS NOT NULL
       AND length(trim(links.methodology_version)) > 0
       AND links.rule_version IS NOT NULL
       AND length(trim(links.rule_version)) > 0
       AND links.sort_order BETWEEN 0 AND 5
       AND EXISTS (
         SELECT 1 FROM thesis_versions version
          WHERE version.id = links.thesis_version_id
            AND version.thesis_id = links.thesis_id
            AND version.status = 'published'
       )
  ) <> 6 THEN RAISE(ABORT, 'daily brief requires six published versions') END;

  SELECT CASE WHEN (
    SELECT COUNT(*) FROM daily_brief_theses links
     WHERE links.brief_date = NEW.brief_date
       AND links.thesis_id IN (
         'ENSO-CORE-01', 'RUBBER-TH-01', 'PALM-SEA-01',
         'MAIZE-SA-01', 'SHIP-USEC-01', 'SHIP-EU-01'
       )
  ) <> 6 THEN RAISE(ABORT, 'daily brief required thesis set incomplete') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM daily_brief_attempts attempt
     WHERE attempt.id = NEW.publication_attempt_id
       AND attempt.brief_date = NEW.brief_date
       AND attempt.freeze_key = NEW.freeze_key
       AND attempt.outcome = 'published'
       AND (
         SELECT COUNT(*) FROM daily_brief_gate_results gate_result
          WHERE gate_result.attempt_id = attempt.id
            AND gate_result.status = 'passed'
       ) = 4
  ) THEN RAISE(ABORT, 'daily brief publication attempt invalid') END;
END;

CREATE TRIGGER daily_briefs_no_direct_published_insert
BEFORE INSERT ON daily_briefs
WHEN NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published daily brief requires finalize transition');
END;

CREATE TRIGGER daily_briefs_published_no_update
BEFORE UPDATE ON daily_briefs
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published daily brief is immutable');
END;

CREATE TRIGGER daily_briefs_published_no_delete
BEFORE DELETE ON daily_briefs
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published daily brief is immutable');
END;

CREATE TRIGGER daily_brief_theses_published_no_update
BEFORE UPDATE ON daily_brief_theses
WHEN EXISTS (
  SELECT 1 FROM daily_briefs brief
   WHERE brief.status = 'published'
     AND brief.brief_date IN (OLD.brief_date, NEW.brief_date)
)
BEGIN
  SELECT RAISE(ABORT, 'published daily brief links are immutable');
END;

CREATE TRIGGER daily_brief_theses_published_no_delete
BEFORE DELETE ON daily_brief_theses
WHEN EXISTS (
  SELECT 1 FROM daily_briefs brief
   WHERE brief.brief_date = OLD.brief_date AND brief.status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'published daily brief links are immutable');
END;

CREATE TRIGGER daily_brief_attempts_no_update
BEFORE UPDATE ON daily_brief_attempts
BEGIN
  SELECT RAISE(ABORT, 'daily brief attempts are append-only');
END;

CREATE TRIGGER daily_brief_attempts_no_delete
BEFORE DELETE ON daily_brief_attempts
BEGIN
  SELECT RAISE(ABORT, 'daily brief attempts are append-only');
END;

CREATE TRIGGER daily_brief_gate_results_no_update
BEFORE UPDATE ON daily_brief_gate_results
BEGIN
  SELECT RAISE(ABORT, 'daily brief gate results are append-only');
END;

CREATE TRIGGER daily_brief_gate_results_no_delete
BEFORE DELETE ON daily_brief_gate_results
BEGIN
  SELECT RAISE(ABORT, 'daily brief gate results are append-only');
END;
