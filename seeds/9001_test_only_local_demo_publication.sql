-- =====================================================================================
-- TEST ONLY — 本地演示发布种子（local D1 only）
--
-- 目的：让 `npm run dev` 在本地看到一个"真的发布过"的站点（六条论点 + 已发布日报 +
--       变化 + 指标观测 + 健康来源），从而真实走通 审核 → 发布 → 公开读取 → 历史不变。
--
-- 这不是研究结论，也不是可公开内容：
--   * 只允许对本地库执行：`npm run db:seed:local-demo`
--     （脚本固定使用 `enso-monitor-local`，不可能命中 staging/production 名称）
--   * 所有写入行的 id 以 `local-demo-` 开头；文案统一带「合成演示：」前缀
--   * 六条生产种子仍保持 `reviewStatus=pending`；本脚本不修改种子，只插入已发布版本行
--   * 严禁对 staging/production 执行本文件
--
-- 可重复执行：所有写入使用 INSERT OR IGNORE + 固定 id；日报只在 `status='draft'` 时被
--   提升为 published，因此重跑是 no-op，也不会触碰不可变历史。
--   若需要彻底重建，先执行 `npm run db:reset:local`（仅删除 .wrangler 下的本地状态）。
--
-- 固定时间口径：cutoff = 2026-09-10T22:30:00.000Z（北京 2026-09-11 06:30）→ brief = 2026-09-11
-- =====================================================================================

-- ---------------------------------------------------------------------------------------
-- 1. 来源运行：主来源在 cutoff 之前成功完成（否则 PRIMARY_SOURCE_HEALTH 门禁会失败）
-- ---------------------------------------------------------------------------------------
INSERT OR IGNORE INTO source_runs (
  id, source_id, scheduled_at, started_at, finished_at, status, content_hash,
  observations_inserted, observations_revised, retry_count
) VALUES (
  'local-demo-run-1', 'noaa_cpc_roni', '2026-09-10T21:00:00.000Z',
  '2026-09-10T21:00:00.000Z', '2026-09-10T21:01:00.000Z', 'success', 'local-demo-hash-1',
  6, 0, 0
);

UPDATE sources
   SET last_success_at = '2026-09-10T21:01:00.000Z',
       consecutive_failures = 0,
       last_error_code = NULL
 WHERE id = 'noaa_cpc_roni';

-- ---------------------------------------------------------------------------------------
-- 2. 六条论点的已发布版本（cutoff 必须与冻结 cutoff 完全一致）
--    每条都有：最新版本、published、calculation_json 带 methodology/rule 版本、证据引用
-- ---------------------------------------------------------------------------------------
INSERT OR IGNORE INTO thesis_versions (
  id, thesis_id, version, status, direction, stage, confidence, summary, invalidation,
  calculation_json, based_on_cutoff, created_by, published_by, created_at, published_at,
  change_reason, draft_key, status_transition_id
) VALUES
  ('local-demo-version-enso', 'ENSO-CORE-01', 1, 'published', 'neutral', 'watch', 58,
   '合成演示：ENSO 信号仍处观察阶段，等待区域天气与实物层交叉确认。',
   '合成演示：ONI/RONI 回到中性区间且区域观测恢复正常。',
   '{"schemaVersion":"thesis-draft-calculation-v1","thesisId":"ENSO-CORE-01","methodologyVersion":"evaluation-v1-demo","cutoff":"2026-09-10T22:30:00.000Z"}',
   '2026-09-10T22:30:00.000Z', 'local-demo-seed', 'local-demo-seed',
   '2026-09-10T22:35:00.000Z', '2026-09-10T23:00:00.000Z', NULL, NULL, 'local-demo-transition-enso'),
  ('local-demo-version-rubber', 'RUBBER-TH-01', 1, 'published', 'bullish', 'physical_pressure', 71,
   '合成演示：泰南降水异常压缩割胶窗口，原料端承压。',
   '合成演示：主产区降水恢复且库存连续两期上升。',
   '{"schemaVersion":"thesis-draft-calculation-v1","thesisId":"RUBBER-TH-01","methodologyVersion":"evaluation-v1-demo","cutoff":"2026-09-10T22:30:00.000Z"}',
   '2026-09-10T22:30:00.000Z', 'local-demo-seed', 'local-demo-seed',
   '2026-09-10T22:35:00.000Z', '2026-09-10T23:00:00.000Z', NULL, NULL, 'local-demo-transition-rubber'),
  ('local-demo-version-palm', 'PALM-SEA-01', 1, 'published', 'bullish', 'weather_realized', 57,
   '合成演示：产区水分压力已被区域观测证实，实物产量尚未确认。',
   '合成演示：产区降水恢复正常且出口配额未收紧。',
   '{"schemaVersion":"thesis-draft-calculation-v1","thesisId":"PALM-SEA-01","methodologyVersion":"evaluation-v1-demo","cutoff":"2026-09-10T22:30:00.000Z"}',
   '2026-09-10T22:30:00.000Z', 'local-demo-seed', 'local-demo-seed',
   '2026-09-10T22:35:00.000Z', '2026-09-10T23:00:00.000Z', NULL, NULL, 'local-demo-transition-palm'),
  ('local-demo-version-maize', 'MAIZE-SA-01', 1, 'published', 'mixed', 'watch', 43,
   '合成演示：种植季前信号不足以支持方向判断。',
   '合成演示：种植季降水回到常年区间。',
   '{"schemaVersion":"thesis-draft-calculation-v1","thesisId":"MAIZE-SA-01","methodologyVersion":"evaluation-v1-demo","cutoff":"2026-09-10T22:30:00.000Z"}',
   '2026-09-10T22:30:00.000Z', 'local-demo-seed', 'local-demo-seed',
   '2026-09-10T22:35:00.000Z', '2026-09-10T23:00:00.000Z', NULL, NULL, 'local-demo-transition-maize'),
  ('local-demo-version-usec', 'SHIP-USEC-01', 1, 'published', 'bearish', 'balance_tightening', 65,
   '合成演示：通行槽位受限叠加可用运力下降，供需正在收紧。',
   '合成演示：通行槽位恢复且等待时间回到常态。',
   '{"schemaVersion":"thesis-draft-calculation-v1","thesisId":"SHIP-USEC-01","methodologyVersion":"evaluation-v1-demo","cutoff":"2026-09-10T22:30:00.000Z"}',
   '2026-09-10T22:30:00.000Z', 'local-demo-seed', 'local-demo-seed',
   '2026-09-10T22:35:00.000Z', '2026-09-10T23:00:00.000Z', NULL, NULL, 'local-demo-transition-usec'),
  ('local-demo-version-eu', 'SHIP-EU-01', 1, 'published', 'mixed', 'watch', 44,
   '合成演示：绕行比例上升，但气候因素与其他扰动无法分离。',
   '合成演示：绕行比例回落且运价回到事件前区间。',
   '{"schemaVersion":"thesis-draft-calculation-v1","thesisId":"SHIP-EU-01","methodologyVersion":"evaluation-v1-demo","cutoff":"2026-09-10T22:30:00.000Z"}',
   '2026-09-10T22:30:00.000Z', 'local-demo-seed', 'local-demo-seed',
   '2026-09-10T22:35:00.000Z', '2026-09-10T23:00:00.000Z', NULL, NULL, 'local-demo-transition-eu');

-- 证据引用：CITATION_COMPLETENESS 门禁要求每个冻结版本至少一条带 citation_url 的证据
-- ---------------------------------------------------------------------------------------
-- 2b. 观察观测（必须先于引用它们的 evidence 插入）：让详情页的指标图有真实数值（RONI 是唯一 public=1 的指标）
-- ---------------------------------------------------------------------------------------
INSERT OR IGNORE INTO observations (
  id, indicator_id, observed_at, value_num, value_text, unit, published_at, fetched_at,
  revision, supersedes_id, quality, source_run_id, citation_url
) VALUES
  ('local-demo-obs-1', 'enso_roni_ersstv6', '2026-04-01T00:00:00.000Z', 0.42, NULL, '°C', '2026-04-05T00:00:00.000Z', '2026-09-10T21:01:00.000Z', 0, NULL, 'verified', 'local-demo-run-1', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/'),
  ('local-demo-obs-2', 'enso_roni_ersstv6', '2026-05-01T00:00:00.000Z', 0.18, NULL, '°C', '2026-05-05T00:00:00.000Z', '2026-09-10T21:01:00.000Z', 0, NULL, 'verified', 'local-demo-run-1', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/'),
  ('local-demo-obs-3', 'enso_roni_ersstv6', '2026-06-01T00:00:00.000Z', -0.11, NULL, '°C', '2026-06-05T00:00:00.000Z', '2026-09-10T21:01:00.000Z', 0, NULL, 'verified', 'local-demo-run-1', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/'),
  ('local-demo-obs-4', 'enso_roni_ersstv6', '2026-07-01T00:00:00.000Z', -0.35, NULL, '°C', '2026-07-05T00:00:00.000Z', '2026-09-10T21:01:00.000Z', 0, NULL, 'verified', 'local-demo-run-1', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/'),
  ('local-demo-obs-5', 'enso_roni_ersstv6', '2026-08-01T00:00:00.000Z', -0.48, NULL, '°C', '2026-08-05T00:00:00.000Z', '2026-09-10T21:01:00.000Z', 0, NULL, 'provisional', 'local-demo-run-1', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/'),
  ('local-demo-obs-6', 'enso_roni_ersstv6', '2026-09-01T00:00:00.000Z', -0.52, NULL, '°C', '2026-09-05T00:00:00.000Z', '2026-09-10T21:01:00.000Z', 1, 'local-demo-obs-5', 'provisional', 'local-demo-run-1', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/');

-- 详情页的指标序列来自 evidence 关联的 observation（`evidence.observation_id`），
-- 因此 ENSO 论点用多条证据指向同一指标的多个观测，图表才有多点与修订/暂定标记。
INSERT OR IGNORE INTO evidence (
  id, thesis_version_id, source_run_id, observation_id, stance, layer, weight, summary, citation_url, sort_order
) VALUES
  ('local-demo-evidence-enso', 'local-demo-version-enso', 'local-demo-run-1', 'local-demo-obs-6', 'supports', 'forecast', 60,
   '合成演示：主来源月度诊断维持中性。', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/', 0),
  ('local-demo-evidence-enso-2', 'local-demo-version-enso', 'local-demo-run-1', 'local-demo-obs-5', 'supports', 'forecast', 58,
   '合成演示：上一个月度为暂定值。', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/news_current/', 1),
  ('local-demo-evidence-enso-3', 'local-demo-version-enso', 'local-demo-run-1', 'local-demo-obs-4', 'supports', 'forecast', 56,
   '合成演示：观测维持负距平。', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_update.shtml', 2),
  ('local-demo-evidence-enso-4', 'local-demo-version-enso', 'local-demo-run-1', 'local-demo-obs-3', 'context', 'forecast', 40,
   '合成演示：更早月份接近中性。', 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/ond.html', 3),
  ('local-demo-evidence-enso-5', 'local-demo-version-enso', 'local-demo-run-1', 'local-demo-obs-2', 'context', 'forecast', 38,
   '合成演示：更早月份为弱正距平。', 'https://www.noaa.gov/elnino/index.html', 4),
  ('local-demo-evidence-enso-6', 'local-demo-version-enso', 'local-demo-run-1', 'local-demo-obs-1', 'context', 'forecast', 36,
   '合成演示：最早月份为弱正距平。', 'https://iri.columbia.edu/our-expertise/climate/ensos/', 5),
  ('local-demo-evidence-rubber', 'local-demo-version-rubber', 'local-demo-run-1', NULL, 'supports', 'weather', 70,
   '合成演示：区域降水低于同期均值。', 'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx', 0),
  ('local-demo-evidence-palm', 'local-demo-version-palm', 'local-demo-run-1', NULL, 'supports', 'weather', 55,
   '合成演示：产区水分压力已被观测证实。', 'https://apps.fas.usda.gov/psdonline/app/index.html#/app/home', 0),
  ('local-demo-evidence-maize', 'local-demo-version-maize', 'local-demo-run-1', NULL, 'context', 'forecast', 40,
   '合成演示：月度估计维持不变。', 'https://apps.fas.usda.gov/psdonline/app/index.html#/app/advQuery', 0),
  ('local-demo-evidence-usec', 'local-demo-version-usec', 'local-demo-run-1', NULL, 'supports', 'physical', 62,
   '合成演示：每日通行槽位维持低位。', 'https://www.drewry.co.uk/container-insight/world-container-index-assessment-for-week', 0),
  ('local-demo-evidence-eu', 'local-demo-version-eu', 'local-demo-run-1', NULL, 'refutes', 'market', 45,
   '合成演示：需求走弱同时压制运价。', 'https://xsi.xeneta.com/', 0);

-- 公开指针：公开列表与详情只投影 thesis_publications 指向的已发布版本
INSERT OR IGNORE INTO thesis_publications (
  thesis_id, current_version_id, previous_version_id, cache_token, last_transition_id, updated_at
) VALUES
  ('ENSO-CORE-01', 'local-demo-version-enso', NULL, 'local-demo-cache-enso', 'local-demo-transition-enso', '2026-09-10T23:00:00.000Z'),
  ('RUBBER-TH-01', 'local-demo-version-rubber', NULL, 'local-demo-cache-rubber', 'local-demo-transition-rubber', '2026-09-10T23:00:00.000Z'),
  ('PALM-SEA-01', 'local-demo-version-palm', NULL, 'local-demo-cache-palm', 'local-demo-transition-palm', '2026-09-10T23:00:00.000Z'),
  ('MAIZE-SA-01', 'local-demo-version-maize', NULL, 'local-demo-cache-maize', 'local-demo-transition-maize', '2026-09-10T23:00:00.000Z'),
  ('SHIP-USEC-01', 'local-demo-version-usec', NULL, 'local-demo-cache-usec', 'local-demo-transition-usec', '2026-09-10T23:00:00.000Z'),
  ('SHIP-EU-01', 'local-demo-version-eu', NULL, 'local-demo-cache-eu', 'local-demo-transition-eu', '2026-09-10T23:00:00.000Z');

-- ---------------------------------------------------------------------------------------
-- 4. 变化记录：一条论点变化 + 一条许可合规的事实变化
-- ---------------------------------------------------------------------------------------
INSERT OR IGNORE INTO changes (
  id, change_type, thesis_id, indicator_id, before_json, after_json, importance,
  detected_at, published_version_id, source_id
) VALUES
  ('local-demo-change-thesis', 'thesis', 'RUBBER-TH-01', NULL,
   '{"stage":"weather_realized","confidence":64}', '{"stage":"physical_pressure","confidence":71}',
   4, '2026-09-10T22:20:00.000Z', 'local-demo-version-rubber', NULL),
  ('local-demo-change-fact', 'revision', NULL, 'enso_roni_ersstv6',
   '{"value":-0.48}', '{"value":-0.52}',
   3, '2026-09-10T21:05:00.000Z', NULL, 'noaa_cpc_roni');

-- ---------------------------------------------------------------------------------------
-- 5. 日报冻结：先建 draft + 链接，再写 attempt 与四类门禁，最后提升为 published
--    触发器要求 published 只能由 UPDATE 产生，且冻结元数据必须齐全
-- ---------------------------------------------------------------------------------------
INSERT OR IGNORE INTO daily_briefs (
  brief_date, status, headline, summary, top_changes_json, data_cutoff
) VALUES (
  '2026-09-11', 'draft',
  '合成演示：ENSO 风险仍待实物与市场层确认',
  '合成演示：今日保留支持与反向证据，未把单一价格变化视为市场确认。',
  '["local-demo-change-thesis"]', '2026-09-10T22:30:00.000Z'
);

-- 链接必须在父日报仍是 draft 时写入：published 链接的 BEFORE INSERT 触发器会 RAISE(ABORT)，
-- 而 `OR IGNORE` 无法抑制触发器错误，所以用 WHERE 守卫实现重跑安全。
INSERT INTO daily_brief_theses (
  brief_date, thesis_id, thesis_version_id, methodology_version, rule_version, sort_order
)
SELECT column1, column2, column3, column4, column5, column6
  FROM (VALUES
    ('2026-09-11', 'ENSO-CORE-01', 'local-demo-version-enso', 'evaluation-v1-demo', 'thesis-draft-calculation-v1', 0),
    ('2026-09-11', 'RUBBER-TH-01', 'local-demo-version-rubber', 'evaluation-v1-demo', 'thesis-draft-calculation-v1', 1),
    ('2026-09-11', 'PALM-SEA-01', 'local-demo-version-palm', 'evaluation-v1-demo', 'thesis-draft-calculation-v1', 2),
    ('2026-09-11', 'MAIZE-SA-01', 'local-demo-version-maize', 'evaluation-v1-demo', 'thesis-draft-calculation-v1', 3),
    ('2026-09-11', 'SHIP-USEC-01', 'local-demo-version-usec', 'evaluation-v1-demo', 'thesis-draft-calculation-v1', 4),
    ('2026-09-11', 'SHIP-EU-01', 'local-demo-version-eu', 'evaluation-v1-demo', 'thesis-draft-calculation-v1', 5)
  )
 WHERE (SELECT status FROM daily_briefs WHERE brief_date = '2026-09-11') = 'draft';

INSERT OR IGNORE INTO daily_brief_attempts (
  id, brief_date, freeze_key, outcome, data_cutoff, headline, summary, top_changes_json,
  target_snapshot_json, methodology_snapshot_json, rule_snapshot_json,
  source_health_snapshot_json, actor, reason, created_at
) VALUES (
  'local-demo-attempt-1', '2026-09-11', 'local-demo-freeze-2026-09-11', 'published',
  '2026-09-10T22:30:00.000Z',
  '合成演示：ENSO 风险仍待实物与市场层确认',
  '合成演示：今日保留支持与反向证据，未把单一价格变化视为市场确认。',
  '["local-demo-change-thesis"]',
  '[{"thesisId":"ENSO-CORE-01","thesisVersionId":"local-demo-version-enso","version":1,"sortOrder":0},{"thesisId":"RUBBER-TH-01","thesisVersionId":"local-demo-version-rubber","version":1,"sortOrder":1},{"thesisId":"PALM-SEA-01","thesisVersionId":"local-demo-version-palm","version":1,"sortOrder":2},{"thesisId":"MAIZE-SA-01","thesisVersionId":"local-demo-version-maize","version":1,"sortOrder":3},{"thesisId":"SHIP-USEC-01","thesisVersionId":"local-demo-version-usec","version":1,"sortOrder":4},{"thesisId":"SHIP-EU-01","thesisVersionId":"local-demo-version-eu","version":1,"sortOrder":5}]',
  '[{"thesisId":"ENSO-CORE-01","methodologyVersion":"evaluation-v1-demo"},{"thesisId":"RUBBER-TH-01","methodologyVersion":"evaluation-v1-demo"},{"thesisId":"PALM-SEA-01","methodologyVersion":"evaluation-v1-demo"},{"thesisId":"MAIZE-SA-01","methodologyVersion":"evaluation-v1-demo"},{"thesisId":"SHIP-USEC-01","methodologyVersion":"evaluation-v1-demo"},{"thesisId":"SHIP-EU-01","methodologyVersion":"evaluation-v1-demo"}]',
  '[{"thesisId":"ENSO-CORE-01","ruleVersion":"thesis-draft-calculation-v1"},{"thesisId":"RUBBER-TH-01","ruleVersion":"thesis-draft-calculation-v1"},{"thesisId":"PALM-SEA-01","ruleVersion":"thesis-draft-calculation-v1"},{"thesisId":"MAIZE-SA-01","ruleVersion":"thesis-draft-calculation-v1"},{"thesisId":"SHIP-USEC-01","ruleVersion":"thesis-draft-calculation-v1"},{"thesisId":"SHIP-EU-01","ruleVersion":"thesis-draft-calculation-v1"}]',
  '[{"sourceId":"noaa_cpc_roni","status":"healthy","checkedAt":"2026-09-10T22:30:00.000Z","lastSuccessAt":"2026-09-10T21:01:00.000Z","consecutiveFailures":0}]',
  'local-demo-seed', '合成演示：本地发布流程演练', '2026-09-10T23:00:00.000Z'
);

INSERT OR IGNORE INTO daily_brief_gate_results (attempt_id, gate_code, status, explanation, reasons_json) VALUES
  ('local-demo-attempt-1', 'PRIMARY_SOURCE_HEALTH', 'passed', 'ENSO 权威主来源健康：通过', '[]'),
  ('local-demo-attempt-1', 'FREEZE_COMPLETENESS', 'passed', '六论点与冻结元数据完整：通过', '[]'),
  ('local-demo-attempt-1', 'CITATION_COMPLETENESS', 'passed', '冻结证据引用完整：通过', '[]'),
  ('local-demo-attempt-1', 'HIGH_RISK_REVIEW', 'passed', '高风险变化均已人工审核：通过', '[]');

-- 只在仍是 draft 时提升；重跑时 WHERE 不匹配任何行，从而不触发不可变触发器
UPDATE daily_briefs
   SET status = 'published',
       freeze_key = 'local-demo-freeze-2026-09-11',
       publication_attempt_id = 'local-demo-attempt-1',
       methodology_snapshot_json = (SELECT methodology_snapshot_json FROM daily_brief_attempts WHERE id = 'local-demo-attempt-1'),
       rule_snapshot_json = (SELECT rule_snapshot_json FROM daily_brief_attempts WHERE id = 'local-demo-attempt-1'),
       source_health_snapshot_json = (SELECT source_health_snapshot_json FROM daily_brief_attempts WHERE id = 'local-demo-attempt-1'),
       published_at = '2026-09-10T23:00:00.000Z',
       published_by = 'local-demo-seed'
 WHERE brief_date = '2026-09-11' AND status = 'draft';
