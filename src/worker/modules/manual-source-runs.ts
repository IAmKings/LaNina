import type { AccessActor } from "./access-auth";
import type { SourceAdapter, PersistedSourceRun } from "../../domain/ingestion";
import type { RunSourceOutcome, RunSourceRequest } from "../ingestion/run-source";
import type { CodeOwnedSourceTarget } from "../ingestion/live-smoke-targets";

export interface ManualSourceRunInput {
  readonly sourceId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly actor: AccessActor;
  readonly occurredAt: string;
  readonly operationId: string;
}

export interface EnabledManualSource {
  readonly id: string;
  readonly adapterKey: string;
}

export interface ManualSourceRunOperation {
  readonly id: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly status: "dispatching" | "completed" | "failed";
  readonly run: PersistedSourceRun | null;
}

export interface ManualSourceRunRepository {
  findEnabledSource(sourceId: string): Promise<EnabledManualSource | null>;
  begin(operation: Omit<ManualSourceRunInput, "actor"> & { readonly actor: string }): Promise<{
    readonly operation: ManualSourceRunOperation;
    readonly created: boolean;
  }>;
  complete(
    operationId: string,
    actor: string,
    reason: string,
    occurredAt: string,
    outcome: RunSourceOutcome,
  ): Promise<ManualSourceRunOperation>;
}

export type ManualSourceRunner = (
  request: RunSourceRequest,
  adapter: SourceAdapter,
) => Promise<RunSourceOutcome>;

export interface ManualSourceRunResult {
  readonly operationId: string;
  readonly sourceId: string;
  readonly status: "dispatching" | "completed" | "failed";
  readonly run: SafeManualRun | null;
  readonly replayed: boolean;
}

export interface SafeManualRun {
  readonly id: string;
  readonly collectionStatus: RunSourceOutcome["collectionStatus"];
  readonly status: PersistedSourceRun["status"];
  readonly observationsInserted: number;
  readonly observationsRevised: number;
  readonly errorCode: PersistedSourceRun["errorCode"];
}

export class ManualSourceRunError extends Error {
  constructor(readonly code: "SOURCE_UNAVAILABLE" | "SOURCE_CONFIGURATION" | "DATABASE") {
    super(code);
    this.name = "ManualSourceRunError";
  }
}

/**
 * This command owns the manual-run state machine. It deliberately receives a
 * code-owned target instead of accepting any operator-provided URL.
 */
export class ManualSourceRunModule {
  constructor(
    private readonly repository: ManualSourceRunRepository,
    private readonly targetForSource: (sourceId: string) => CodeOwnedSourceTarget | null,
    private readonly adapters: ReadonlyMap<string, SourceAdapter>,
    private readonly runner: ManualSourceRunner,
  ) {}

  async run(input: ManualSourceRunInput): Promise<ManualSourceRunResult> {
    const source = await this.repository.findEnabledSource(input.sourceId);
    if (source === null) throw new ManualSourceRunError("SOURCE_UNAVAILABLE");

    const target = this.targetForSource(source.id);
    const adapter = target === null ? undefined : this.adapters.get(target.adapterKey);
    if (
      target === null ||
      source.adapterKey !== target.adapterKey ||
      adapter === undefined ||
      adapter.key !== target.adapterKey
    ) {
      throw new ManualSourceRunError("SOURCE_CONFIGURATION");
    }

    const actor = input.actor.email ?? "verified-access-member";
    const started = await this.repository.begin({ ...input, actor });
    if (!started.created) return result(started.operation, null, true);

    let outcome: RunSourceOutcome;
    try {
      outcome = await this.runner({
        sourceId: source.id,
        sourceUrl: target.sourceUrl,
        scheduledAt: input.occurredAt,
      }, adapter);
    } catch {
      // No unclassified dispatch failure may be reported as a successful operation.
      throw new ManualSourceRunError("DATABASE");
    }

    const completed = await this.repository.complete(
      started.operation.id,
      actor,
      input.reason,
      input.occurredAt,
      outcome,
    );
    return result(completed, outcome, false);
  }
}

function result(
  operation: ManualSourceRunOperation,
  outcome: RunSourceOutcome | null,
  replayed: boolean,
): ManualSourceRunResult {
  return {
    operationId: operation.id,
    sourceId: operation.sourceId,
    status: operation.status,
    run: operation.run === null ? null : safeRun(operation.run, outcome?.collectionStatus),
    replayed,
  };
}

function safeRun(
  run: PersistedSourceRun,
  collectionStatus: RunSourceOutcome["collectionStatus"] | undefined,
): SafeManualRun {
  return {
    id: run.id,
    collectionStatus: collectionStatus ?? (run.status === "failed" ? "failed" : "already_processed"),
    status: run.status,
    observationsInserted: run.observationsInserted,
    observationsRevised: run.observationsRevised,
    errorCode: run.errorCode,
  };
}
