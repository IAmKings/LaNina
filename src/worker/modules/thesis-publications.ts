import type {
  PublishedThesisVersionReference,
  ThesisPublicationCommand,
  ThesisPublicationMutation,
  ThesisPublicationTransition,
} from "../../domain/thesis-publication";
import { decodeThesisSeed } from "../../domain/thesis-seeds";

export const THESIS_PUBLICATION_ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "NON_DRAFT",
  "NOT_PUBLISHED",
  "PUBLICATION_DISABLED",
  "DATABASE",
] as const;

export type ThesisPublicationErrorCode = (typeof THESIS_PUBLICATION_ERROR_CODES)[number];

export interface ThesisPublicationErrorDetails {
  readonly expectedVersion: number;
  readonly currentVersion: number | null;
}

export class ThesisPublicationError extends Error {
  constructor(
    readonly code: ThesisPublicationErrorCode,
    message: string,
    readonly details: Readonly<ThesisPublicationErrorDetails> | null = null,
  ) {
    super(message);
    this.name = "ThesisPublicationError";
  }
}

export interface ThesisPublicationRepository {
  publish(mutation: ThesisPublicationMutation): Promise<ThesisPublicationTransition>;
  withdrawAndRestore(mutation: ThesisPublicationMutation): Promise<ThesisPublicationTransition>;
  findCurrentPublished(thesisId: string): Promise<PublishedThesisVersionReference | null>;
}

export type ThesisSeedResolver = (thesisId: string) => unknown | Promise<unknown>;

export class ThesisPublicationModule {
  constructor(
    private readonly repository: ThesisPublicationRepository,
    private readonly resolveSeed: ThesisSeedResolver,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async publish(command: ThesisPublicationCommand): Promise<ThesisPublicationTransition> {
    const validated = validateCommand(command);
    let seed;
    try {
      seed = decodeThesisSeed(await this.resolveSeed(validated.thesisId));
    } catch {
      throw new ThesisPublicationError(
        "PUBLICATION_DISABLED",
        "论点发布配置缺失或未通过运行时校验",
      );
    }
    const hasPublicationGap = seed.coverageGaps.some((gap) => gap.blocks.includes("publication"));
    if (
      seed.id !== validated.thesisId
      || seed.readiness.reviewStatus !== "approved"
      || !seed.readiness.productionEvaluation
      || !seed.readiness.publication
      || hasPublicationGap
    ) {
      throw new ThesisPublicationError(
        "PUBLICATION_DISABLED",
        "论点尚未通过生产发布审核",
      );
    }
    return this.repository.publish(this.mutation("publish", validated));
  }

  async withdraw(command: ThesisPublicationCommand): Promise<ThesisPublicationTransition> {
    return this.repository.withdrawAndRestore(this.mutation("withdraw", validateCommand(command)));
  }

  async findCurrentPublished(thesisId: string): Promise<PublishedThesisVersionReference | null> {
    if (typeof thesisId !== "string" || thesisId.trim().length === 0) {
      throw new ThesisPublicationError("VALIDATION", "论点 ID 不能为空");
    }
    return this.repository.findCurrentPublished(thesisId);
  }

  private mutation(
    action: ThesisPublicationMutation["action"],
    command: ThesisPublicationCommand,
  ): ThesisPublicationMutation {
    return {
      ...command,
      action,
      transitionId: requiredGeneratedId(this.createId(), "发布转换 ID"),
      auditId: requiredGeneratedId(this.createId(), "审计 ID"),
      cacheToken: requiredGeneratedId(this.createId(), "缓存失效 token"),
    };
  }
}

function validateCommand(command: ThesisPublicationCommand): ThesisPublicationCommand {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new ThesisPublicationError("VALIDATION", "发布命令必须是对象");
  }
  if (Object.keys(command).some((key) => ![
    "versionId", "thesisId", "expectedVersion", "actor", "reason", "occurredAt",
  ].includes(key))) {
    throw new ThesisPublicationError("VALIDATION", "发布命令包含未知字段");
  }
  if (typeof command.thesisId !== "string" || command.thesisId.trim().length === 0) {
    throw new ThesisPublicationError("VALIDATION", "论点 ID 不能为空");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(command.versionId)) {
    throw new ThesisPublicationError("VALIDATION", "论点版本 ID 无效");
  }
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
    throw new ThesisPublicationError("VALIDATION", "expectedVersion 必须是正整数");
  }
  if (typeof command.actor !== "string" || command.actor.trim().length === 0) {
    throw new ThesisPublicationError("VALIDATION", "发布操作者不能为空");
  }
  if (typeof command.reason !== "string" || command.reason.trim().length === 0) {
    throw new ThesisPublicationError("VALIDATION", "发布原因不能为空");
  }
  assertCanonicalUtc(command.occurredAt);
  return {
    versionId: command.versionId,
    thesisId: command.thesisId,
    expectedVersion: command.expectedVersion,
    actor: command.actor,
    reason: command.reason,
    occurredAt: command.occurredAt,
  };
}

function requiredGeneratedId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new ThesisPublicationError("VALIDATION", `${label} 无效`);
  }
  return value;
}

function assertCanonicalUtc(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new ThesisPublicationError("VALIDATION", "occurredAt 必须是规范 UTC 时间");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new ThesisPublicationError("VALIDATION", "occurredAt 必须是规范 UTC 时间");
  }
}
