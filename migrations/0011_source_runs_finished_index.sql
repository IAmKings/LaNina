-- 0011: source_runs 按 (source_id, status, finished_at) 的finished_at 有序索引
--
-- 背景：source_runs 此前只有 started_at 维度的索引（0001 的
-- idx_source_runs_source_started / idx_source_runs_status_started）。
-- 所有「最近一次成功/失败」判定都按 finished_at 取最新一行，随着运行历史增长，
-- 这些查询退化为对单个来源全部运行历史的排序（EXPLAIN QUERY PLAN 出现
-- USE TEMP B-TREE FOR ORDER BY）。
--
-- 受益查询（均以 source_id 等值 + status 过滤 + finished_at 排序/范围过滤）：
-- - 采集 cursor：cloudflare-ingestion.ts findSourceCursor
--   （status IN ('success','unchanged') ORDER BY finished_at DESC LIMIT 1）
-- - 每来源健康子查询（last_success / consecutive_failures / last_error）：
--   cloudflare-daily-briefs.ts、cloudflare-daily-schedule.ts
-- - 7 天成功率：cloudflare-read-models.ts dataHealth（source_id 等值 + finished_at >= ?）
--
-- 查询计划回归：cloudflare-read-models-query-plan.test.mjs 对上述查询固化
-- SEARCH ... USING INDEX idx_source_runs_source_status_finished 断言。
-- 本迁移只新增索引，不修改既有索引或表结构。

CREATE INDEX idx_source_runs_source_status_finished
  ON source_runs (source_id, status, finished_at DESC);
