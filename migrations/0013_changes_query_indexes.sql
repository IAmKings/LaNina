-- 0013: changes 查询索引补强（只新增索引，不改既有索引或表结构）
--
-- 背景：公开变更列表、overview 顶部变更与 Atom feed 均按
-- (detected_at DESC, id DESC) 排序分页。0001/0002 的 idx_changes_detected 只有
-- detected_at 一列，排序的 id 平局裁决需要额外排序步骤；带游标的翻页
-- （detected_at < ? OR (detected_at = ? AND id < ?)）也无法完全下推到索引。
--
-- 受益查询（cloudflare-read-models.ts changesQuery / overview 顶部变更）：
-- - 公开变更分页：ORDER BY change.detected_at DESC, change.id DESC + 游标比较
-- - Atom feed：同一排序 + importance >= 4 过滤，走 importance partial 索引
--
-- 查询计划回归：cloudflare-read-models-query-plan.test.mjs 固化
-- SEARCH/SCAN ... USING INDEX idx_changes_detected_id（分页）与
-- idx_changes_importance_detected（feed partial 索引）断言。
-- 本迁移只新增索引，不修改既有索引或表结构。

CREATE INDEX idx_changes_detected_id
  ON changes (detected_at DESC, id DESC);

CREATE INDEX idx_changes_importance_detected
  ON changes (detected_at DESC) WHERE importance >= 4;
