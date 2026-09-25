-- 0010: 放宽每日判定发布触发器以支持覆盖缺口豁免（路径①，2026-09-24 负责人确认）
--
-- 变更：daily_brief_publish_validate 的「六条已发布版本」与「必需论点集合完整」两处校验，
-- 改为「已发布版本 + 已登记豁免 = 6」。豁免必须已在 daily_brief_exemptions 中登记
-- （应用层负责校验缺口真实性并记录确认人与时间），因此不存在静默放行。
--
-- 注意：豁免不改变置信度与展示规则——公开页面仍必须如实标注覆盖缺口，
-- 且被豁免的论点不显示方向/置信度（由应用层投影保证）。
--
-- 实现约束（2026-09-25）：触发器体内不要出现嵌套的条件表达式复合标记
-- （形如「选择表达式」套在触发器体内）。wrangler 的语句切分器需要识别复合语句标记，
-- 嵌套标记会让远端 `wrangler d1 migrations apply` 报
-- "incomplete input: SQLITE_ERROR [code: 7500]"。因此四处校验统一写成
-- 「抛出异常 + 条件过滤」的单层形式（见 docs/operations/path-1-exemption-implementation.md）。
-- 本触发器不修改历史 brief：它只在 draft -> published 的 UPDATE 上校验。

DROP TRIGGER IF EXISTS daily_brief_publish_validate;

CREATE TRIGGER daily_brief_publish_validate
BEFORE UPDATE OF status ON daily_briefs
WHEN OLD.status = 'draft' AND NEW.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'daily brief freeze metadata missing')
   WHERE NEW.freeze_key IS NULL
      OR NEW.publication_attempt_id IS NULL
      OR NEW.methodology_snapshot_json IS NULL
      OR NEW.rule_snapshot_json IS NULL
      OR NEW.source_health_snapshot_json IS NULL
      OR NEW.published_at IS NULL
      OR NEW.published_by IS NULL
      OR json_valid(NEW.methodology_snapshot_json) <> 1
      OR json_valid(NEW.rule_snapshot_json) <> 1
      OR json_valid(NEW.source_health_snapshot_json) <> 1;

  SELECT RAISE(ABORT, 'daily brief requires six published versions or registered exemptions')
   WHERE (
    (SELECT COUNT(*) FROM daily_brief_theses links
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
        ))
    + (SELECT COUNT(*) FROM daily_brief_exemptions exemption
        WHERE exemption.brief_date = NEW.brief_date)
  ) <> 6;

  SELECT RAISE(ABORT, 'daily brief required thesis set incomplete')
   WHERE (
    (SELECT COUNT(*) FROM daily_brief_theses links
      WHERE links.brief_date = NEW.brief_date
        AND links.thesis_id IN (
          'ENSO-CORE-01', 'RUBBER-TH-01', 'PALM-SEA-01',
          'MAIZE-SA-01', 'SHIP-USEC-01', 'SHIP-EU-01'
        ))
    + (SELECT COUNT(*) FROM daily_brief_exemptions exemption
        WHERE exemption.brief_date = NEW.brief_date
          AND exemption.thesis_id IN (
            'ENSO-CORE-01', 'RUBBER-TH-01', 'PALM-SEA-01',
            'MAIZE-SA-01', 'SHIP-USEC-01', 'SHIP-EU-01'
          ))
  ) <> 6;

  SELECT RAISE(ABORT, 'daily brief publication attempt invalid')
   WHERE NOT EXISTS (
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
  );
END;
