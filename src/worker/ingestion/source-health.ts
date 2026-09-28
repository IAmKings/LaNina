import type { SourceHealth, SourceHealthInput, SourceHealthStatus } from "../../domain/ingestion";
import { SourceCollectionError } from "../../domain/ingestion";
import { parseCanonicalUtc } from "./time";

/**
 * D4:B（2026-09-26）：degraded 三分态的派生输入。`lastRunIsPartial` 表示该来源
 * 「最新一次完结采集（source_runs 中 finished_at 最晚的一行）是 partial」——由各读路径
 * 以 MAX(partial.finished_at) > MAX(success|unchanged|failed.finished_at) 的索引查找派生，
 * 不引入存储列。平局（同一毫秒完结两种状态）按非 degraded 处理（保守）。
 */
export interface SourceHealthDerivationInput extends SourceHealthInput {
  readonly lastRunIsPartial: boolean;
}

/**
 * 状态优先级（判定顺序）与理由：
 * 1. broken：SCHEMA_DRIFT 或连续失败 ≥3 —— 结构性故障压过一切质量细节；
 * 2. stale：从无成功记录，或数据年龄超过 stale_after_minutes ——「真没数据」必须压过
 *    「数据质量降级」，否则长期 partial 断供的源会被 degraded 掩盖；
 * 3. degraded：最新完结采集为 partial 且仍在 stale 窗口内 —— 数据确实在到达，报
 *    「延迟/过期」名不副实，报「正常」掩盖覆盖不足，因此占用 healthy/delayed 的判定带；
 * 4. healthy / delayed：按年龄与 late_after_minutes 的既有判定。
 *
 * 恢复路径：degraded 之后一次 success/unchanged（lastRunIsPartial=false）→ healthy，
 * 并沿用既有 recovered 逻辑记录 source_health 变化；degraded 之后的失败按既有失败
 * 逻辑累计 consecutive_failures（partial 不清零也不累加该计数）。
 */
export function calculateSourceHealth(input: SourceHealthDerivationInput): SourceHealth {
  const checkedAt = parseCanonicalUtc(input.checkedAt, "checkedAt");
  if (
    !Number.isInteger(input.lateAfterMinutes) ||
    !Number.isInteger(input.staleAfterMinutes) ||
    input.lateAfterMinutes < 0 ||
    input.staleAfterMinutes < input.lateAfterMinutes ||
    !Number.isInteger(input.consecutiveFailures) ||
    input.consecutiveFailures < 0
  ) {
    throw new SourceCollectionError("VALIDATION", "来源健康阈值无效");
  }

  let status: SourceHealthStatus;
  if (input.lastErrorCode === "SCHEMA_DRIFT" || input.consecutiveFailures >= 3) {
    status = "broken";
  } else if (input.lastSuccessAt === null) {
    status = "stale";
  } else {
    const lastSuccessAt = parseCanonicalUtc(input.lastSuccessAt, "lastSuccessAt");
    const ageMinutes = Math.max(0, checkedAt.valueOf() - lastSuccessAt.valueOf()) / 60_000;
    status =
      ageMinutes > input.staleAfterMinutes
        ? "stale"
        : input.lastRunIsPartial
          ? "degraded"
          : ageMinutes <= input.lateAfterMinutes
            ? "healthy"
            : "delayed";
  }

  return {
    sourceId: input.sourceId,
    status,
    checkedAt: input.checkedAt,
    lastSuccessAt: input.lastSuccessAt,
    consecutiveFailures: input.consecutiveFailures,
  };
}

/**
 * 各读路径共用的「最新完结采集是否为 partial」SQL 片段（source 别名由调用处注入）。
 * `bounded = true` 时以 `finished_at <= ?` 限定到截止时刻（冻结快照/每日评估的
 * as-of 重建），此时调用处必须为该片段追加两个截止时刻绑定参数。
 * 两次定位查找都走 idx_source_runs_source_status_finished 的 (source_id, status) 前缀，
 * 不产生排序。canonical UTC 时间戳按字典序比较；两侧均为空（''）时结果为 0。
 */
export function lastRunIsPartialExpression(sourceAlias: string, bounded = false): string {
  const bound = (alias: string): string => (bounded ? ` AND ${alias}.finished_at <= ?` : "");
  return `(COALESCE((
        SELECT MAX(partial_run.finished_at) FROM source_runs partial_run
         WHERE partial_run.source_id = ${sourceAlias}.id
           AND partial_run.status = 'partial'
           AND partial_run.finished_at IS NOT NULL${bound("partial_run")}
      ), '') > COALESCE((
        SELECT MAX(other_run.finished_at) FROM source_runs other_run
         WHERE other_run.source_id = ${sourceAlias}.id
           AND other_run.status IN ('success', 'unchanged', 'failed')
           AND other_run.finished_at IS NOT NULL${bound("other_run")}
      ), ''))`;
}
