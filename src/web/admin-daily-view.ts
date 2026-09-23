import type { ApiEnvelope } from "../domain/contracts";
import type { AdminDailyPageModel } from "../domain/page-models";

import { formatShanghaiTime } from "./overview-view";

export const MAX_TOP_CHANGES = 3;

export interface DailyPublishDraft {
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: string;
  readonly reason: string;
  readonly confirmed: boolean;
}

export interface DailyTargetRow {
  readonly thesisId: string;
  readonly thesisVersionId: string;
}

export function emptyDailyPublishDraft(): DailyPublishDraft {
  return { headline: "", summary: "", topChanges: "", reason: "", confirmed: false };
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

/** Null means the manual publication form may be offered. */
export function dailyPublishBlockReason(model: AdminDailyPageModel): string | null {
  if (model.published) return "该日期的每日判定已发布且不可替换。";
  if (model.blockers.length > 0) return "六条论点尚未全部具备该截止时间的已发布版本。";
  if (!mayPublishDaily(model)) {
    return "当前身份没有发布权限；发布由服务端 publisher 权限再次验证。";
  }
  return null;
}

export function dailyTargetRows(model: AdminDailyPageModel): readonly DailyTargetRow[] {
  return model.targets.map((target) => ({
    thesisId: target.thesisId,
    thesisVersionId: target.thesisVersionId,
  }));
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
} {
  return {
    cutoff: model.cutoff,
    headline: draft.headline.trim(),
    summary: draft.summary.trim(),
    topChanges: parseTopChangeIds(draft.topChanges).ids,
    reason: draft.reason.trim(),
    expectedFreezeKey: model.currentFreezeKey,
    confirm: true,
  };
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
    return "四类发布门禁未全部通过，未发布每日判定。高风险转场需先记录精确审核，其余门禁请按预检提示处理。";
  }
  if (code === "TARGETS_UNAVAILABLE") {
    return "六条论点尚未全部具备该截止时间的已发布版本，请先完成论点发布。";
  }
  if (code === "IMMUTABLE") return "该日期的每日判定已发布且不可替换。";
  if (code === "VERSION_CONFLICT") return "每日判定内容或版本已变化，请刷新预检信息后重试。";
  if (status === 401 || status === 403) return "当前身份没有发布权限，请重新验证 Access 身份。";
  if (status === 400 || status === 422) return "提交内容未通过服务端校验，请检查截止时间、文案与变化 ID。";
  if (status === 404) return "未找到该日期的每日判定目标。";
  if (status === 409) return "当前状态已变化，请刷新预检信息后重试。";
  return "发布操作暂时无法完成，请稍后重试。";
}

/** Reads only the stable error code; the server message is never rendered verbatim. */
export async function safeErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as unknown;
    if (body === null || typeof body !== "object") return null;
    const error = (body as { readonly error?: unknown }).error;
    if (error === null || typeof error !== "object") return null;
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === "string" && code.length <= 64 ? code : null;
  } catch {
    return null;
  }
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
    && data.actor !== undefined;
}

function bounded(value: string, maximumLength: number): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && [...normalized].length <= maximumLength;
}
