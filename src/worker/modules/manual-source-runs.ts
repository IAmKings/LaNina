import type { SourceAdapter, PersistedSourceRun } from "../../domain/ingestion";
import type { RunSourceOutcome, RunSourceRequest } from "../ingestion/run-source";
import type { CodeOwnedSourceTarget } from "../ingestion/live-smoke-targets";

export interface ManualSourceRunInput {
  /** 强制重新解析（忽略内容哈希游标）——解析器修复后让同一页面重新入库。 */
  readonly forceReparse?: boolean;
  readonly sourceId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  /**
   * 已由路由层 `administrativeActor` 解析的真实 Access 成员身份（email）。只读视图允许
   * 泛化的「已验证成员」标签，但追加型审计行必须落在真实身份上——无 email claim 的
   * 执行者在进入本模块前即被拒绝，因此这里没有占位身份回退。
   */
  readonly actor: string;
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
  /** 手动触发页的来源选择清单：全部 enabled 来源，稳定排序。 */
  findEnabledSourceIds(): Promise<readonly string[]>;
  begin(operation: ManualSourceRunInput): Promise<{
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

  /** 手动触发页的来源选择清单（透传仓储）。 */
  findEnabledSourceIds(): Promise<readonly string[]> {
    return this.repository.findEnabledSourceIds();
  }

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

    const started = await this.repository.begin(input);
    if (!started.created) return result(started.operation, null, true);

    let outcome: RunSourceOutcome;
    try {
      outcome = await this.runner({
        sourceId: source.id,
        sourceUrl: target.sourceUrl,
        scheduledAt: input.occurredAt,
        forceReparse: input.forceReparse === true,
      }, adapter);
    } catch {
      // No unclassified dispatch failure may be reported as a successful operation.
      throw new ManualSourceRunError("DATABASE");
    }

    const completed = await this.repository.complete(
      started.operation.id,
      input.actor,
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
