-- 清理 staging 上的「仅限本地」测试演示数据（seeds/9001_test_only_local_demo_publication.sql）
--
-- 背景：该种子明确标注 TEST ONLY（只允许 enso-monitor-local），但 staging 的 D1 里被应用过，
-- 导致 2026-09-11 的合成日报、合成论点版本/公开指针、合成 RONI 观测与变化记录进入了公开面。
--
-- 本脚本：
--   1. 临时摘下「已发布内容不可删除」的四个触发器（删完立即恢复）；
--   2. 只删除以 `local-demo-` 标识的行，以及与该演示日报（brief_date = '2026-09-11'）相关的行；
--   3. 允许重跑（DROP IF EXISTS + 幂等 DELETE）；未命中的环境为 no-op。
--   4. 不碰真实数据：2026-09-25 及以后发布的日报、真实论点版本、真实观测与来源运行都不受影响。
--
-- 用法（务必先备份）：
--   npx wrangler d1 export enso-monitor-staging --remote --output .local-evidence/backups/staging-<ts>.sql
--   npx wrangler d1 execute enso-monitor-staging --remote --env staging \
--     --file scripts/cleanup-staging-demo-rows.sql

-- 1) 摘下四个删除保护触发器 ---------------------------------------------------------------
DROP TRIGGER IF EXISTS daily_brief_gate_results_no_delete;
DROP TRIGGER IF EXISTS daily_brief_attempts_no_delete;
DROP TRIGGER IF EXISTS daily_brief_theses_published_no_delete;
DROP TRIGGER IF EXISTS daily_briefs_published_no_delete;

-- 2) 按外键顺序删除演示数据 ---------------------------------------------------------------
-- 演示日报的门禁结果 → 链接 → 日报 → 尝试
DELETE FROM daily_brief_gate_results
 WHERE attempt_id IN (SELECT id FROM daily_brief_attempts WHERE id LIKE 'local-demo-%');
DELETE FROM daily_brief_theses WHERE brief_date = '2026-09-11';
DELETE FROM daily_briefs WHERE brief_date = '2026-09-11';
DELETE FROM daily_brief_attempts WHERE id LIKE 'local-demo-%';

-- 指向演示版本的转场审核（这些审核只因演示基线而存在）
DELETE FROM thesis_change_reviews
 WHERE after_version_id LIKE 'local-demo-%' OR before_version_id LIKE 'local-demo-%';

-- 演示证据（引用演示版本 / 演示观测 / 演示来源运行）
DELETE FROM evidence
 WHERE thesis_version_id LIKE 'local-demo-%'
    OR observation_id LIKE 'local-demo-%'
    OR source_run_id LIKE 'local-demo-%';

-- 演示变化记录
DELETE FROM changes
 WHERE id LIKE 'local-demo-%' OR published_version_id LIKE 'local-demo-%' OR source_id LIKE 'local-demo-%';

-- 演示观测（先断开自引用，再删）
UPDATE observations SET supersedes_id = NULL WHERE supersedes_id LIKE 'local-demo-%';
DELETE FROM observations WHERE id LIKE 'local-demo-%';

-- 公开指针不再引用演示版本（真实指针的 current 保持不变，只清掉指向演示版的 previous）
UPDATE thesis_publications SET previous_version_id = NULL WHERE previous_version_id LIKE 'local-demo-%';
UPDATE thesis_publications SET previous_version_id = NULL WHERE current_version_id LIKE 'local-demo-%';

-- 演示论点版本与演示来源运行
DELETE FROM thesis_versions WHERE id LIKE 'local-demo-%';
DELETE FROM source_runs WHERE id LIKE 'local-demo-%';

-- 3) 恢复四个删除保护触发器 ---------------------------------------------------------------
CREATE TRIGGER daily_briefs_published_no_delete
BEFORE DELETE ON daily_briefs
WHEN OLD.status = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published daily brief is immutable');
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

CREATE TRIGGER daily_brief_attempts_no_delete
BEFORE DELETE ON daily_brief_attempts
BEGIN
  SELECT RAISE(ABORT, 'daily brief attempts are append-only');
END;

CREATE TRIGGER daily_brief_gate_results_no_delete
BEFORE DELETE ON daily_brief_gate_results
BEGIN
  SELECT RAISE(ABORT, 'daily brief gate results are append-only');
END;

-- 4) 核对：残留演示行应为 0；触发器应为 4 ------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM thesis_versions    WHERE id LIKE 'local-demo-%') AS demo_versions,
  (SELECT COUNT(*) FROM observations       WHERE id LIKE 'local-demo-%') AS demo_observations,
  (SELECT COUNT(*) FROM evidence           WHERE id LIKE 'local-demo-%') AS demo_evidence,
  (SELECT COUNT(*) FROM changes            WHERE id LIKE 'local-demo-%') AS demo_changes,
  (SELECT COUNT(*) FROM source_runs        WHERE id LIKE 'local-demo-%') AS demo_runs,
  (SELECT COUNT(*) FROM thesis_publications WHERE current_version_id LIKE 'local-demo-%'
                                               OR previous_version_id LIKE 'local-demo-%') AS demo_pointers,
  (SELECT COUNT(*) FROM daily_briefs       WHERE brief_date = '2026-09-11') AS demo_brief,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND name IN ('daily_briefs_published_no_delete',
      'daily_brief_theses_published_no_delete', 'daily_brief_attempts_no_delete',
      'daily_brief_gate_results_no_delete')) AS restored_triggers;
