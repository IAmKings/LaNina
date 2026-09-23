import type {
  DispatchCandidate,
  DispatchGroup,
  SourceErrorCode,
  SourceHealth,
  SourceHealthRepository,
  SourceScheduleRepository,
} from "../../../domain/ingestion";
import { SOURCE_ERROR_CODES, SourceCollectionError } from "../../../domain/ingestion";
import { calculateSourceHealth } from "../../ingestion/source-health";
import { parseCanonicalUtc } from "../../ingestion/time";

interface DispatchRow {
  kind: DispatchCandidate["kind"];
  source_id: string;
  source_url: string;
  adapter_key: string;
  scheduled_at: string;
  cadence_minutes: number;
  retry_count: number;
}

interface HealthRow {
  source_id: string;
  last_success_at: string | null;
  late_after_minutes: number;
  stale_after_minutes: number;
  consecutive_failures: number;
  last_error_code: string | null;
}

export class D1SourceSchedulingRepository
  implements SourceScheduleRepository, SourceHealthRepository
{
  constructor(private readonly database: D1Database) {}

  async listDispatchCandidates(
    cutoff: string,
    limit: number,
    group: DispatchGroup,
  ): Promise<DispatchCandidate[]> {
    parseCanonicalUtc(cutoff, "dispatch cutoff");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new SourceCollectionError("VALIDATION", "调度批次大小必须在 1 到 20 之间");
    }
    if (group !== "quarter_hourly" && group !== "hourly") {
      throw new SourceCollectionError("VALIDATION", "来源调度组不受支持");
    }
    try {
      const result = await this.database
        .prepare(
          `SELECT kind, source_id, source_url, adapter_key, scheduled_at,
                  cadence_minutes, retry_count
             FROM (
               SELECT 'retry' AS kind, s.id AS source_id, s.homepage_url AS source_url,
                      s.adapter_key, r.scheduled_at, s.cadence_minutes, r.retry_count,
                      r.next_retry_at AS dispatch_at, 0 AS dispatch_priority
                FROM source_runs r
                 JOIN sources s ON s.id = r.source_id
                WHERE ? = 'quarter_hourly'
                  AND s.enabled = 1 AND r.status = 'failed'
                  AND r.next_retry_at IS NOT NULL AND r.next_retry_at <= ?
                  AND r.retry_count < 3
                  AND (r.retry_claim_token IS NULL OR r.retry_claim_expires_at <= ?)
               UNION ALL
               SELECT 'scheduled' AS kind, s.id AS source_id, s.homepage_url AS source_url,
                      s.adapter_key, s.next_due_at AS scheduled_at, s.cadence_minutes,
                      0 AS retry_count, s.next_due_at AS dispatch_at, 1 AS dispatch_priority
                 FROM sources s
                WHERE s.enabled = 1 AND s.next_due_at IS NOT NULL AND s.next_due_at <= ?
                  AND ((? = 'quarter_hourly' AND s.cadence_minutes < 60)
                    OR (? = 'hourly' AND s.cadence_minutes >= 60))
                  AND NOT EXISTS (
                    SELECT 1 FROM source_runs pending
                     WHERE pending.source_id = s.id AND pending.status = 'failed'
                       AND pending.next_retry_at IS NOT NULL
                  )
             ) candidates
            ORDER BY dispatch_priority, dispatch_at, source_id
            LIMIT ?`,
        )
        .bind(group, cutoff, cutoff, cutoff, group, group, limit)
        .all<DispatchRow>();
      return result.results.map((row) => ({
        kind: row.kind,
        sourceId: row.source_id,
        sourceUrl: row.source_url,
        adapterKey: row.adapter_key,
        scheduledAt: row.scheduled_at,
        cadenceMinutes: row.cadence_minutes,
        retryCount: row.retry_count,
      }));
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      throw databaseError();
    }
  }

  async getSourceHealth(sourceId: string, checkedAt: string): Promise<SourceHealth | null> {
    parseCanonicalUtc(checkedAt, "checkedAt");
    try {
      const row = await this.database
        .prepare(
          `SELECT id AS source_id, last_success_at, late_after_minutes, stale_after_minutes,
                  consecutive_failures, last_error_code
             FROM sources
            WHERE id = ?`,
        )
        .bind(sourceId)
        .first<HealthRow>();
      if (row === null) return null;
      return calculateSourceHealth({
        sourceId: row.source_id,
        checkedAt,
        lastSuccessAt: row.last_success_at,
        lateAfterMinutes: row.late_after_minutes,
        staleAfterMinutes: row.stale_after_minutes,
        consecutiveFailures: row.consecutive_failures,
        lastErrorCode: sourceErrorCode(row.last_error_code),
      });
    } catch (error) {
      if (error instanceof SourceCollectionError) throw error;
      throw databaseError();
    }
  }
}

function sourceErrorCode(value: string | null): SourceErrorCode | null {
  return SOURCE_ERROR_CODES.find((candidate) => candidate === value) ?? null;
}

function databaseError(): SourceCollectionError {
  return new SourceCollectionError("DATABASE", "D1 无法读取来源调度状态", { retryable: true });
}
