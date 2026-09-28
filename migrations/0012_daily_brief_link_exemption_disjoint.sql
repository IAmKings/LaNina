-- 0012：重建每日判定发布校验触发器，新增「同一 brief_date 内同一 thesis_id 不得同时
-- 存在 daily_brief_theses link 与 daily_brief_exemptions 豁免」的不相交校验。
--
-- 背景：0010 的「已发布版本 + 已登记豁免 = 6」与「必需论点集合完整 = 6」两处计数会把
-- 同时挂接与豁免的论点重复计入：若论点 X 既写入 link 又登记豁免，而必需论点 Y 两者皆缺，
-- 两处计数仍等于 6，发布被放行；但公开读取端按「link 与豁免不相交」解码，已发布 brief
-- 一旦因此不可读，便因已发布内容的不可变性而永久无法修复。应用层已在写入前校验不相交
-- （daily-briefs 模块），本触发器是库内兜底。
--
-- 实现约束（与 0010 相同）：触发器体保持单层简单结构，每处校验写成「条件为真即中止」的
-- 单层形式，体内不出现嵌套复合标记，注释不写 SQL 关键字——wrangler 的语句切分器按复合
-- 语句标记切分，嵌套标记会让远端迁移应用报 incomplete input。若远端仍切分失败，可按
-- docs/operations/path-1-exemption-implementation.md 的备用通道直接走 D1 HTTP API。
--
-- 本触发器不修改历史 brief：它只在 draft -> published 的状态更新上校验。

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

  SELECT RAISE(ABORT, 'daily brief thesis link and exemption are mutually exclusive')
   WHERE EXISTS (
    SELECT 1 FROM daily_brief_theses link
     WHERE link.brief_date = NEW.brief_date
       AND EXISTS (
        SELECT 1 FROM daily_brief_exemptions exemption
         WHERE exemption.brief_date = link.brief_date
           AND exemption.thesis_id = link.thesis_id
      )
  );

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
