import type { ApiEnvelope } from "../domain/contracts";
import type { AdminDailyPageModel, AdminDailyReviewObligationModel } from "../domain/page-models";

import { formatShanghaiTime } from "./overview-view";

export const MAX_TOP_CHANGES = 3;

export interface DailyPublishDraft {
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: string;
  readonly reason: string;
  readonly confirmed: boolean;
  /** 路径①：操作者已阅读并同意被豁免论点的覆盖缺口后，才允许提交。 */
  readonly exemptionsConfirmed: boolean;
}

export interface DailyTargetRow {
  readonly thesisId: string;
  readonly thesisVersionId: string;
  readonly version: number;
  readonly status: "draft" | "published" | "withdrawn";
}

export function emptyDailyPublishDraft(): DailyPublishDraft {
  return {
    headline: "",
    summary: "",
    topChanges: "",
    reason: "",
    confirmed: false,
    exemptionsConfirmed: false,
  };
}

/** The brief date a publisher most likely wants, expressed in the product time zone. */
export function shanghaiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Browser role checks only control the affordance; the Worker remains the authorization boundary. */
export function mayPublishDaily(model: AdminDailyPageModel): boolean {
  return model.actor.roles.includes("publisher");
}

/**
 * Blockers an explicit coverage-gap exemption cannot cover. A missing or still-unpublished thesis is
 * exemptible; a duplicate, unknown or superseded version is not.
 */
export function dailyUncoveredBlockers(model: AdminDailyPageModel): readonly string[] {
  const exemptible = new Set(model.exemptibleTargets.map((target) => target.thesisId));
  return model.blockers.filter((blocker) => !blockerCoveredByExemption(blocker, exemptible));
}

/** Null means the manual publication form may be offered. */
export function dailyPublishBlockReason(model: AdminDailyPageModel): string | null {
  if (model.published) return "该日期的每日判定已发布且不可替换。";
  if (dailyUncoveredBlockers(model).length > 0) {
    return model.exemptibleTargets.length === 0
      ? "六条论点尚未全部具备该截止时间的已发布版本。"
      : "除可豁免论点外，仍有其他论点尚未具备该截止时间的已发布版本。";
  }
  if (!mayPublishDaily(model)) {
    return "当前身份没有发布权限；发布由服务端 publisher 权限再次验证。";
  }
  return null;
}

export function dailyTargetRows(model: AdminDailyPageModel): readonly DailyTargetRow[] {
  return model.targets.map((target) => ({
    thesisId: target.thesisId,
    thesisVersionId: target.thesisVersionId,
    version: target.version,
    status: target.status,
  }));
}

/** Only draft cutoff versions can be published; published/withdrawn ones would fail as NON_DRAFT. */
export function dailyDraftTargets(model: AdminDailyPageModel): readonly DailyTargetRow[] {
  return dailyTargetRows(model).filter((target) => target.status === "draft");
}

/**
 * Mirrors `parseAdministrativeThesisPublicationBody` exactly. The per-version publish endpoint
 * requires the thesis, its optimistic-concurrency version, a reason and an explicit confirmation;
 * calling it without a body is rejected as VALIDATION.
 */
export function thesisVersionPublishRequestBody(
  target: DailyTargetRow,
  reason: string,
): {
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly reason: string;
  readonly confirm: true;
} {
  return {
    thesisId: target.thesisId,
    expectedVersion: target.version,
    reason: reason.trim(),
    confirm: true,
  };
}

/** Turns a server blocker code into operator-facing text without inventing new server facts. */
export function blockerLabel(blocker: string): string {
  const separator = blocker.indexOf(":");
  const code = separator === -1 ? blocker : blocker.slice(0, separator);
  const subject = separator === -1 ? "" : blocker.slice(separator + 1);
  if (code === "TARGET_MISSING") return `${subject}：该截止时间没有评估版本`;
  if (code === "TARGET_DUPLICATE") return `${subject}：该截止时间存在多个版本`;
  if (code === "VERSION_NOT_PUBLISHED") return `${subject}：最新版本尚未发布`;
  if (code === "VERSION_NOT_LATEST") return `${subject}：存在更新的版本`;
  if (code === "UNKNOWN_THESIS") return `${subject}：不属于必需论点`;
  return blocker;
}

/**
 * Mirrors the Worker rule: only a missing or unpublished required thesis can be covered by an
 * explicitly acknowledged coverage gap. Anything else stays a hard blocker.
 */
function blockerCoveredByExemption(blocker: string, exemptibleTheses: ReadonlySet<string>): boolean {
  const separator = blocker.indexOf(":");
  if (separator === -1) return false;
  const code = blocker.slice(0, separator);
  const subject = blocker.slice(separator + 1);
  return (code === "TARGET_MISSING" || code === "VERSION_NOT_PUBLISHED") && exemptibleTheses.has(subject);
}

/**
 * Change IDs are the only accepted reference: the daily brief freezes identifiers, not free text.
 * Empty input means "no top change", which the freeze command accepts.
 */
export function parseTopChangeIds(value: string): { readonly ids: readonly string[]; readonly error: string | null } {
  const ids = value
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (ids.length > MAX_TOP_CHANGES) {
    return { ids: [], error: `最多填写 ${MAX_TOP_CHANGES} 个变化 ID。` };
  }
  if (ids.some((id) => [...id].length > 128)) {
    return { ids: [], error: "变化 ID 过长。" };
  }
  if (new Set(ids).size !== ids.length) {
    return { ids: [], error: "变化 ID 不能重复。" };
  }
  return { ids, error: null };
}

export function canSubmitDaily(
  draft: DailyPublishDraft,
  model: AdminDailyPageModel,
): boolean {
  if (dailyPublishBlockReason(model) !== null || !draft.confirmed) return false;
  if (model.exemptibleTargets.length > 0 && !draft.exemptionsConfirmed) return false;
  if (!bounded(draft.headline, 200) || !bounded(draft.summary, 2_000) || !bounded(draft.reason, 500)) {
    return false;
  }
  return parseTopChangeIds(draft.topChanges).error === null;
}

/** Mirrors the Worker body exactly; the freeze key is echoed verbatim as a concurrency token. */
export function dailyPublishRequestBody(
  model: AdminDailyPageModel,
  draft: DailyPublishDraft,
): {
  readonly cutoff: string;
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: readonly string[];
  readonly reason: string;
  readonly expectedFreezeKey: string | null;
  readonly confirm: true;
  readonly exemptions: readonly { readonly thesisId: string; readonly gapId: string }[];
} {
  return {
    cutoff: model.cutoff,
    headline: draft.headline.trim(),
    summary: draft.summary.trim(),
    topChanges: parseTopChangeIds(draft.topChanges).ids,
    reason: draft.reason.trim(),
    expectedFreezeKey: model.currentFreezeKey,
    confirm: true,
    exemptions: model.exemptibleTargets.map(({ thesisId, gapId }) => ({ thesisId, gapId })),
  };
}

/**
 * Mirrors `parseAdministrativeThesisReviewBody`. The review must bind the exact version frozen in
 * the previous published brief, so the obligation is the only safe source of `beforeVersionId`.
 */
export function thesisChangeReviewRequestBody(
  obligation: AdminDailyReviewObligationModel,
  reason: string,
): {
  readonly thesisId: string;
  readonly beforeVersionId: string;
  readonly decision: "approved";
  readonly reason: string;
  readonly confirm: true;
} {
  return {
    thesisId: obligation.thesisId,
    beforeVersionId: obligation.beforeVersionId,
    decision: "approved",
    reason: reason.trim(),
    confirm: true,
  };
}

/** Stable high-risk trigger labels; unknown codes stay visible instead of being invented. */
export function reviewTriggerLabel(trigger: string): string {
  if (trigger === "DIRECTION_CHANGE") return "方向变化";
  if (trigger.startsWith("STAGE_DELTA_")) return `阶段跨 ${trigger.slice("STAGE_DELTA_".length)} 级`;
  if (trigger.startsWith("CONFIDENCE_DELTA_")) {
    return `置信度变化 ${trigger.slice("CONFIDENCE_DELTA_".length)}`;
  }
  return trigger;
}

export function dailyCutoffLabel(model: AdminDailyPageModel): string {
  return formatShanghaiTime(model.cutoff);
}

export function dailyPublishedLabel(model: AdminDailyPageModel): string {
  return model.published
    ? `已发布 · ${formatShanghaiTime(model.publishedAt)}`
    : "尚未发布";
}

/** Converts only HTTP status categories and stable server codes to browser-safe feedback. */
export function dailyPublishFailureMessage(status: number, code: string | null): string {
  if (code === "GATES_FAILED") {
    return "四类发布门禁未全部通过，未发布每日判定。具体未通过项与原因见下方列表。";
  }
  if (code === "TARGETS_UNAVAILABLE") {
    return "六条论点尚未全部具备该截止时间的已发布版本或已确认豁免，请先完成论点发布。";
  }
  if (code === "EXEMPTION_INVALID") {
    return "覆盖缺口豁免与服务端预检不一致，请刷新预检信息后重试。";
  }
  if (code === "IMMUTABLE") return "该日期的每日判定已发布且不可替换。";
  if (code === "VERSION_CONFLICT") {
    return "提交时使用的预检并发令牌已过期（页面停留期间已有另一次发布尝试）。预检正在自动刷新，请等按钮恢复后再次提交。";
  }
  if (status === 401 || status === 403) return "当前身份没有发布权限，请重新验证 Access 身份。";
  if (status === 400 || status === 422) return "提交内容未通过服务端校验，请检查截止时间、文案与变化 ID。";
  if (status === 404) return "未找到该日期的每日判定目标。";
  if (status === 409) return "当前状态已变化，请刷新预检信息后重试。";
  return "发布操作暂时无法完成，请稍后重试。";
}

/** Reads only the stable error code; the server message is never rendered verbatim. */
export async function safeErrorCode(response: Response): Promise<string | null> {
  return (await safeDailyPublishError(response)).code;
}

export interface DailyGateFailure {
  readonly code: string;
  readonly reasons: readonly string[];
}

export interface DailyPublishError {
  readonly code: string | null;
  readonly gates: readonly DailyGateFailure[];
  /** Stable write-failure stage label (for example `guarded-attempt` or `link:ENSO-CORE-01`). */
  readonly stage: string | null;
}

/**
 * Reads the stable error code plus the optional structured diagnostics (gate list, write stage). A
 * response body can only be consumed once, so every field comes from the same parse.
 */
export async function safeDailyPublishError(response: Response): Promise<DailyPublishError> {
  try {
    const body = await response.json() as unknown;
    if (body === null || typeof body !== "object") return { code: null, gates: [], stage: null };
    const error = (body as { readonly error?: unknown }).error;
    if (error === null || typeof error !== "object") return { code: null, gates: [], stage: null };
    const record = error as { readonly code?: unknown; readonly details?: unknown };
    const code = typeof record.code === "string" && record.code.length <= 64 ? record.code : null;
    return { code, gates: decodeGateFailures(record.details), stage: decodeStage(record.details) };
  } catch {
    return { code: null, gates: [], stage: null };
  }
}

function decodeStage(details: unknown): string | null {
  if (details === null || typeof details !== "object") return null;
  const stage = (details as { readonly stage?: unknown }).stage;
  return typeof stage === "string" && stage.length > 0 && stage.length <= 128 ? stage : null;
}

function decodeGateFailures(details: unknown): readonly DailyGateFailure[] {
  if (details === null || typeof details !== "object") return [];
  const gates = (details as { readonly gates?: unknown }).gates;
  if (!Array.isArray(gates)) return [];
  const decoded: DailyGateFailure[] = [];
  for (const gate of gates) {
    if (gate === null || typeof gate !== "object") continue;
    const code = (gate as { readonly code?: unknown }).code;
    if (typeof code !== "string" || code.length > 64) continue;
    const rawReasons = (gate as { readonly reasons?: unknown }).reasons;
    const reasons = Array.isArray(rawReasons)
      ? rawReasons.filter((reason): reason is string => typeof reason === "string" && reason.length <= 160)
      : [];
    decoded.push({ code, reasons });
  }
  return decoded;
}

/** Stable gate labels; unknown codes fall back to the raw enum rather than inventing text. */
export function gateLabel(code: string): string {
  const labels: Record<string, string> = {
    PRIMARY_SOURCE_HEALTH: "ENSO 主来源健康",
    FREEZE_COMPLETENESS: "六论点与冻结元数据完整",
    CITATION_COMPLETENESS: "冻结证据引用完整",
    HIGH_RISK_REVIEW: "高风险变化人工审核",
  };
  return labels[code] ?? code;
}

/**
 * Turns a gate reason enum into operator-facing text. Reason codes are a documented contract, so
 * mapping them is not "rendering a server message"; unknown codes stay visible as-is.
 */
export function gateReasonLabel(reason: string): string {
  const separator = reason.indexOf(":");
  const code = separator === -1 ? reason : reason.slice(0, separator);
  const subject = separator === -1 ? "" : reason.slice(separator + 1);
  if (code === "PRIMARY_SOURCE_MISSING") return `主来源 ${subject} 缺失`;
  if (code === "SOURCE_SNAPSHOT_CUTOFF_MISMATCH") return `主来源 ${subject} 快照截止不一致`;
  if (code === "PRIMARY_SOURCE_STALE") return `主来源 ${subject} 在该截止时间已过期`;
  if (code === "PRIMARY_SOURCE_BROKEN") return `主来源 ${subject} 在该截止时间为故障`;
  if (code === "SOURCE_HEALTH_SNAPSHOT_MISSING") return "缺少来源健康快照";
  if (code === "SOURCE_HEALTH_DUPLICATE") return `来源 ${subject} 健康记录重复`;
  if (code === "SOURCE_HEALTH_CUTOFF_MISMATCH") return `来源 ${subject} 健康快照截止不一致`;
  if (code === "TARGET_COUNT_NOT_SIX") return "已发布版本 + 已登记豁免不等于六条";
  if (code === "TARGET_MISSING") return `${subject}：该截止时间没有已发布版本（需发布或勾选豁免）`;
  if (code === "VERSION_NOT_PUBLISHED") return `${subject}：该截止时间的版本尚未发布`;
  if (code === "VERSION_NOT_LATEST") return `${subject}：存在更新的版本，需重新评估该截止时间`;
  if (code === "CUTOFF_MISMATCH") return `${subject}：版本截止时间与冻结截止不一致`;
  if (code === "METHODOLOGY_VERSION_MISSING") return `${subject}：缺少方法论版本`;
  if (code === "RULE_VERSION_MISSING") return `${subject}：缺少规则版本`;
  if (code === "EVIDENCE_MISSING") return `${subject}：已发布版本没有任何引用证据`;
  if (code === "CITATION_MISSING") return `${subject}：存在空引用链接`;
  if (code === "DUPLICATE_THESIS_TARGET" || code === "DUPLICATE_VERSION_TARGET") return "目标版本重复";
  if (code === "DUPLICATE_EXEMPTION") return "同一论点重复豁免";
  if (code === "EXEMPTION_CONFLICTS_TARGET") return `${subject}：同时提供了版本与豁免`;
  if (code === "UNKNOWN_EXEMPTION") return `${subject}：不属于必需论点`;
  if (code === "VERSION_ID_MISMATCH" || code === "CROSS_THESIS") return `${subject}：版本身份与论点不一致`;
  if (code === "UNREVIEWED_DIRECTION_CHANGE") return `${subject}：方向变化尚未记录精确审核`;
  if (code.startsWith("UNREVIEWED_STAGE_DELTA_")) return `${subject}：阶段跨级变化尚未记录精确审核`;
  if (code.startsWith("UNREVIEWED_CONFIDENCE_DELTA_")) return `${subject}：置信度变化 ≥20 尚未记录精确审核`;
  return reason;
}

export function isAdminDailyEnvelope(value: unknown): value is ApiEnvelope<AdminDailyPageModel> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { readonly data?: unknown; readonly meta?: unknown };
  if (candidate.data === undefined || candidate.meta === undefined) return false;
  const data = candidate.data as Partial<AdminDailyPageModel>;
  return typeof data.briefDate === "string"
    && typeof data.cutoff === "string"
    && typeof data.published === "boolean"
    && Array.isArray(data.targets)
    && Array.isArray(data.blockers)
    && Array.isArray(data.exemptibleTargets)
    && Array.isArray(data.pendingReviews)
    && data.actor !== undefined;
}

function bounded(value: string, maximumLength: number): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && [...normalized].length <= maximumLength;
}
