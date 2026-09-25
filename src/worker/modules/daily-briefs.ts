import type {
  DailyBriefExemption,
  DailyBriefFreezeCommand,
  DailyBriefResult,
  DailyBriefVersionTarget,
  RequiredDailyThesisId,
} from "../../domain/daily-brief";
import { REQUIRED_DAILY_THESIS_IDS, shanghaiBriefDate } from "../../domain/daily-brief";

export const DAILY_BRIEF_ERROR_CODES = [
  "VALIDATION",
  "VERSION_CONFLICT",
  "IMMUTABLE",
  "NOT_FOUND",
  "DATABASE",
] as const;

export type DailyBriefErrorCode = (typeof DAILY_BRIEF_ERROR_CODES)[number];

export class DailyBriefError extends Error {
  constructor(
    readonly code: DailyBriefErrorCode,
    message: string,
    /**
     * Non-prose diagnostic payload. Concurrency conflicts carry the two freeze keys; storage write
     * failures carry the stable `{ stage }` label of the statement that did not take effect. It never
     * carries SQL text or stored values.
     */
    readonly details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(message);
    this.name = "DailyBriefError";
  }
}

export interface DailyBriefMutation extends Omit<DailyBriefFreezeCommand, "targets" | "exemptions"> {
  readonly briefDate: string;
  readonly targets: readonly DailyBriefVersionTarget[];
  readonly exemptions: readonly DailyBriefExemption[];
  readonly attemptId: string;
  readonly auditId: string;
}

type ValidatedDailyBriefCommand = Omit<DailyBriefFreezeCommand, "exemptions"> & {
  readonly exemptions: readonly DailyBriefExemption[];
};

export interface DailyBriefRepository {
  freezeAndPublish(mutation: DailyBriefMutation): Promise<DailyBriefResult>;
  findPublished(briefDate: string): Promise<DailyBriefResult | null>;
  /** Freeze key of the most recent attempt for the date, or null when none exists yet. */
  findCurrentFreezeKey(briefDate: string): Promise<string | null>;
}

export class DailyBriefModule {
  constructor(
    private readonly repository: DailyBriefRepository,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async freezeAndPublish(command: DailyBriefFreezeCommand): Promise<DailyBriefResult> {
    const validated = validateCommand(command);
    return this.repository.freezeAndPublish({
      ...validated,
      briefDate: shanghaiBriefDate(validated.cutoff),
      attemptId: generatedId(this.createId(), "每日判定尝试 ID"),
      auditId: generatedId(this.createId(), "每日判定审计 ID"),
    });
  }

  async findPublished(briefDate: string): Promise<DailyBriefResult | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate) || !validCalendarDate(briefDate)) {
      throw new DailyBriefError("VALIDATION", "briefDate 必须是有效 YYYY-MM-DD");
    }
    return this.repository.findPublished(briefDate);
  }

  /**
   * Concurrency token for a manual publication retry: the key of the most recent attempt for the
   * date, which a caller must echo back so a concurrent publication cannot be overwritten.
   */
  async currentFreezeKey(briefDate: string): Promise<string | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(briefDate) || !validCalendarDate(briefDate)) {
      throw new DailyBriefError("VALIDATION", "briefDate 必须是有效 YYYY-MM-DD");
    }
    return this.repository.findCurrentFreezeKey(briefDate);
  }
}

function validateCommand(command: DailyBriefFreezeCommand): ValidatedDailyBriefCommand {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new DailyBriefError("VALIDATION", "每日判定命令必须是对象");
  }
  const expectedKeys = [
    "cutoff", "targets", "headline", "summary", "topChanges",
    "actor", "reason", "occurredAt", "expectedFreezeKey", "exemptions",
  ];
  if (Object.keys(command).some((key) => !expectedKeys.includes(key))) {
    throw new DailyBriefError("VALIDATION", "每日判定命令包含未知字段");
  }
  canonicalUtc(command.cutoff, "cutoff");
  canonicalUtc(command.occurredAt, "occurredAt");
  if (new Date(command.occurredAt).valueOf() < new Date(command.cutoff).valueOf()) {
    throw new DailyBriefError("VALIDATION", "occurredAt 不能早于 cutoff");
  }
  const exemptions = validateExemptions(command.exemptions);
  if (!Array.isArray(command.targets) || command.targets.length < 1) {
    throw new DailyBriefError("VALIDATION", "每日判定必须指定论点版本");
  }
  if (command.targets.length + exemptions.length !== REQUIRED_DAILY_THESIS_IDS.length) {
    throw new DailyBriefError("VALIDATION", "每日判定必须覆盖六条必需论点（已发布版本或已登记豁免）");
  }
  const targetKeys = new Set(REQUIRED_DAILY_THESIS_IDS);
  const seenTheses = new Set<string>();
  const seenVersions = new Set<string>();
  const targets = command.targets.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DailyBriefError("VALIDATION", "论点版本目标必须是对象");
    }
    if (Object.keys(value).some((key) => key !== "thesisId" && key !== "thesisVersionId")) {
      throw new DailyBriefError("VALIDATION", "论点版本目标包含未知字段");
    }
    if (!targetKeys.has(value.thesisId as RequiredDailyThesisId)) {
      throw new DailyBriefError("VALIDATION", "每日判定包含未知论点");
    }
    if (typeof value.thesisVersionId !== "string" || value.thesisVersionId.trim().length === 0) {
      throw new DailyBriefError("VALIDATION", "论点版本 ID 不能为空");
    }
    if (seenTheses.has(value.thesisId) || seenVersions.has(value.thesisVersionId)) {
      throw new DailyBriefError("VALIDATION", "论点或版本目标重复");
    }
    seenTheses.add(value.thesisId);
    seenVersions.add(value.thesisVersionId);
    return { thesisId: value.thesisId, thesisVersionId: value.thesisVersionId } as DailyBriefVersionTarget;
  });
  for (const exemption of exemptions) {
    if (seenTheses.has(exemption.thesisId)) {
      throw new DailyBriefError("VALIDATION", "同一论点不能同时提供版本与豁免");
    }
  }
  if (REQUIRED_DAILY_THESIS_IDS.some((id) => !seenTheses.has(id) && !exemptions.some((e) => e.thesisId === id))) {
    throw new DailyBriefError("VALIDATION", "每日判定缺少必需论点");
  }
  const headline = nonEmpty(command.headline, "标题");
  const summary = nonEmpty(command.summary, "摘要");
  const actor = nonEmpty(command.actor, "操作者");
  const reason = nonEmpty(command.reason, "原因");
  if (
    !Array.isArray(command.topChanges)
    || command.topChanges.length > 3
    || command.topChanges.some((item) => typeof item !== "string" || item.trim().length === 0)
    || new Set(command.topChanges).size !== command.topChanges.length
  ) {
    throw new DailyBriefError("VALIDATION", "topChanges 必须是不超过三项的非空唯一 change ID");
  }
  if (
    command.expectedFreezeKey !== null
    && (typeof command.expectedFreezeKey !== "string" || command.expectedFreezeKey.trim().length === 0)
  ) throw new DailyBriefError("VALIDATION", "expectedFreezeKey 无效");
  return {
    cutoff: command.cutoff,
    targets,
    headline,
    summary,
    topChanges: [...command.topChanges],
    actor,
    reason,
    occurredAt: command.occurredAt,
    expectedFreezeKey: command.expectedFreezeKey,
    exemptions,
  };
}

function validateExemptions(value: unknown): readonly DailyBriefExemption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > REQUIRED_DAILY_THESIS_IDS.length) {
    throw new DailyBriefError("VALIDATION", "覆盖缺口豁免最多六条且必须是数组");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new DailyBriefError("VALIDATION", "覆盖缺口豁免必须是对象");
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "thesisId" && key !== "gapId")) {
      throw new DailyBriefError("VALIDATION", "覆盖缺口豁免包含未知字段");
    }
    if (!REQUIRED_DAILY_THESIS_IDS.includes(record.thesisId as RequiredDailyThesisId)) {
      throw new DailyBriefError("VALIDATION", "覆盖缺口豁免包含未知论点");
    }
    const gapId = nonEmpty(record.gapId, "缺口 ID");
    if (seen.has(record.thesisId as string)) {
      throw new DailyBriefError("VALIDATION", "覆盖缺口豁免不能重复");
    }
    seen.add(record.thesisId as string);
    return { thesisId: record.thesisId as RequiredDailyThesisId, gapId };
  });
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DailyBriefError("VALIDATION", `${label}不能为空`);
  }
  return value;
}

function canonicalUtc(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new DailyBriefError("VALIDATION", `${field} 必须是规范 UTC 时间`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new DailyBriefError("VALIDATION", `${field} 必须是规范 UTC 时间`);
  }
}

function validCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function generatedId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new DailyBriefError("VALIDATION", `${label} 无效`);
  }
  return value;
}
