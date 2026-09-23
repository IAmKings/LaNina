import { reportStorageFailure } from "./storage-logging";
import type { PersistedSourceRun, SourceErrorCode } from "../../../domain/ingestion";
import type { RunSourceOutcome } from "../../ingestion/run-source";
import type {
  EnabledManualSource,
  ManualSourceRunOperation,
  ManualSourceRunRepository,
} from "../../modules/manual-source-runs";

interface SourceRow {
  id: string;
  adapter_key: string;
}

interface OperationRow {
  id: string;
  source_id: string;
  idempotency_key: string;
  status: "dispatching" | "completed" | "failed";
  run_id: string | null;
  collection_status: RunSourceOutcome["collectionStatus"] | null;
  run_status: PersistedSourceRun["status"] | null;
  observations_inserted: number | null;
  observations_revised: number | null;
  error_code: SourceErrorCode | null;
}

/** D1 persistence for a private, append-only manual-source operation. */
export class D1ManualSourceRunRepository implements ManualSourceRunRepository {
  constructor(private readonly database: D1Database) {}

  async findEnabledSource(sourceId: string): Promise<EnabledManualSource | null> {
    try {
      const row = await this.database.prepare(
        "SELECT id, adapter_key FROM sources WHERE id = ? AND enabled = 1",
      ).bind(sourceId).first<SourceRow>();
      return row === null ? null : { id: row.id, adapterKey: row.adapter_key };
    } catch {
      reportStorageFailure("manual-source-runs.findEnabledSource");
      throw databaseError();
    }
  }

  async begin(input: {
    readonly sourceId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
    readonly actor: string;
    readonly occurredAt: string;
    readonly operationId: string;
  }): Promise<{ readonly operation: ManualSourceRunOperation; readonly created: boolean }> {
    const existing = await this.find(input.sourceId, input.idempotencyKey);
    if (existing !== null) return { operation: existing, created: false };
    try {
      await this.database.batch([
        this.database.prepare(
          `INSERT INTO admin_source_run_operations (
             id, source_id, idempotency_key, actor, reason, status, created_at
           ) VALUES (?, ?, ?, ?, ?, 'dispatching', ?)`,
        ).bind(input.operationId, input.sourceId, input.idempotencyKey, input.actor, input.reason, input.occurredAt),
        this.database.prepare(
          `INSERT INTO audit_log (
             id, entity_type, entity_id, action, actor, reason, before_json, after_json, created_at
           ) VALUES (?, 'source', ?, 'manual_run_requested', ?, ?, NULL,
                     json_object('operationId', ?), ?)`,
        ).bind(`audit:${input.operationId}:requested`, input.sourceId, input.actor, input.reason, input.operationId, input.occurredAt),
      ]);
    } catch {
      const raced = await this.find(input.sourceId, input.idempotencyKey);
      reportStorageFailure("manual-source-runs.begin");
      if (raced !== null) return { operation: raced, created: false };
      throw databaseError();
    }
    const created = await this.find(input.sourceId, input.idempotencyKey);
    if (created === null || created.id !== input.operationId) throw databaseError();
    return { operation: created, created: true };
  }

  async complete(
    operationId: string,
    actor: string,
    reason: string,
    occurredAt: string,
    outcome: RunSourceOutcome,
  ): Promise<ManualSourceRunOperation> {
    const status = outcome.run.status === "failed" ? "failed" : "completed";
    try {
      await this.database.batch([
        this.database.prepare(
          `UPDATE admin_source_run_operations
              SET status = ?, run_id = ?, collection_status = ?, run_status = ?,
                  observations_inserted = ?, observations_revised = ?, error_code = ?, completed_at = ?
            WHERE id = ? AND status = 'dispatching'`,
        ).bind(
          status,
          outcome.run.id,
          outcome.collectionStatus,
          outcome.run.status,
          outcome.run.observationsInserted,
          outcome.run.observationsRevised,
          outcome.run.errorCode,
          occurredAt,
          operationId,
        ),
        this.database.prepare(
          `INSERT INTO audit_log (
             id, entity_type, entity_id, action, actor, reason, before_json, after_json, created_at
           ) SELECT ?, 'source', source_id, ?, ?, ?,
                    json_object('operationId', ?),
                    json_object('operationId', ?, 'runId', ?, 'status', ?, 'errorCode', ?), ?
               FROM admin_source_run_operations
              WHERE id = ? AND status = ?`,
        ).bind(
          `audit:${operationId}:completed`,
          status === "completed" ? "manual_run_completed" : "manual_run_failed",
          actor,
          reason,
          operationId,
          operationId,
          outcome.run.id,
          status,
          outcome.run.errorCode,
          occurredAt,
          operationId,
          status,
        ),
      ]);
    } catch {
      reportStorageFailure("manual-source-runs.complete");
      throw databaseError();
    }
    const completed = await this.findById(operationId);
    if (completed === null || completed.status === "dispatching") throw databaseError();
    return completed;
  }

  private async find(sourceId: string, idempotencyKey: string): Promise<ManualSourceRunOperation | null> {
    try {
      const row = await this.database.prepare(`${operationSelect()} WHERE source_id = ? AND idempotency_key = ?`)
        .bind(sourceId, idempotencyKey).first<OperationRow>();
      return row === null ? null : decodeOperation(row);
    } catch {
      reportStorageFailure("manual-source-runs.find");
      throw databaseError();
    }
  }

  private async findById(operationId: string): Promise<ManualSourceRunOperation | null> {
    try {
      const row = await this.database.prepare(`${operationSelect()} WHERE id = ?`)
        .bind(operationId).first<OperationRow>();
      return row === null ? null : decodeOperation(row);
    } catch {
      reportStorageFailure("manual-source-runs.findById");
      throw databaseError();
    }
  }
}

function operationSelect(): string {
  return `SELECT id, source_id, idempotency_key, status, run_id, collection_status,
                 run_status, observations_inserted, observations_revised, error_code
            FROM admin_source_run_operations`;
}

function decodeOperation(row: OperationRow): ManualSourceRunOperation {
  const run = row.run_id === null ? null : persistedRun(row);
  if ((row.status === "dispatching") !== (run === null)) throw databaseError();
  return { id: row.id, sourceId: row.source_id, idempotencyKey: row.idempotency_key, status: row.status, run };
}

function persistedRun(row: OperationRow): PersistedSourceRun {
  if (
    row.run_id === null || row.run_status === null || row.observations_inserted === null ||
    row.observations_revised === null || row.collection_status === null
  ) throw databaseError();
  return {
    id: row.run_id,
    sourceId: row.source_id,
    scheduledAt: "1970-01-01T00:00:00.000Z",
    status: row.run_status,
    snapshotKey: null,
    observationsInserted: row.observations_inserted,
    observationsRevised: row.observations_revised,
    errorCode: row.error_code,
    retryCount: 0,
    nextRetryAt: null,
    recovered: false,
  };
}

function databaseError(): Error {
  return new Error("manual source operation storage failed");
}
