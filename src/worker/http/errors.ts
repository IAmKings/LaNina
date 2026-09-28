import { AccessJwtError } from "../modules/access-auth";
import { errorResponse } from "./envelope";

/**
 * One error-classification table replaces the six near-identical per-route mapper functions that
 * used to live in index.ts. Every entry is transcribed from the previous mapper functions —
 * status and copy are frozen so no existing error response changes.
 *
 * Keys are `<error class name>.<error code>`. Module error classes all set an explicit `name`, so
 * the key is a stable runtime string; the class qualification keeps the two same-code collisions
 * apart (DailyBriefError.VALIDATION vs DailyPublicationTargetError.VALIDATION).
 *
 * AccessJwtError is handled inside mapModuleError itself: authentication/authorization failures
 * use the error's own status (401/403/503) and message, exactly like the former
 * adminAuthorizationError branch.
 */

export type ModuleError = Error & { readonly code: string; readonly details?: unknown };

export interface ErrorMappingEntry {
  readonly status: number;
  readonly message: string | ((error: ModuleError) => string);
  /** Present only when the former mapper attached a details payload for this code. */
  readonly details?: (error: ModuleError) => unknown;
}

export interface ModuleErrorTable {
  /** Used when the thrown error is not a classified module error (or its code has no entry). */
  readonly fallback: { readonly code: string; readonly status: number; readonly message: string };
  readonly codes: Readonly<Record<string, ErrorMappingEntry>>;
}

export function mapModuleError(error: unknown, requestId: string, table: ModuleErrorTable): Response {
  if (error instanceof AccessJwtError) {
    return errorResponse(error.code, error.message, error.status, requestId);
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") {
      const entry = table.codes[`${error.name}.${code}`];
      if (entry !== undefined) {
        const moduleError = error as ModuleError;
        const message = typeof entry.message === "function" ? entry.message(moduleError) : entry.message;
        const details = entry.details?.(moduleError);
        return errorResponse(code, message, entry.status, requestId, details);
      }
    }
  }
  return errorResponse(table.fallback.code, table.fallback.message, table.fallback.status, requestId);
}

/** Shared by withAdmin and every audited-actor check; only the AccessJwtError branch ever fires. */
export const ADMIN_AUTHORIZATION_ERRORS: ModuleErrorTable = {
  fallback: { code: "AUTH_IDENTITY_PROVIDER", status: 503, message: "身份验证服务暂不可用" },
  codes: {},
};

export const MANUAL_SOURCE_RUN_ERRORS: ModuleErrorTable = {
  fallback: { code: "DATABASE", status: 503, message: "手动来源运行暂不可用，请稍后重试" },
  codes: {
    "ManualSourceRunError.SOURCE_UNAVAILABLE": { status: 404, message: "来源不存在、已停用或不允许手动运行" },
    "ManualSourceRunError.SOURCE_CONFIGURATION": { status: 503, message: "来源运行配置暂不可用" },
  },
};

export const ADMINISTRATIVE_DRAFT_EDIT_ERRORS: ModuleErrorTable = {
  fallback: { code: "DATABASE", status: 503, message: "草稿编辑暂不可用，请稍后重试" },
  codes: {
    "ThesisDraftError.VALIDATION": { status: 400, message: "草稿编辑请求无效" },
    "ThesisDraftError.NOT_FOUND": { status: 404, message: "未找到可编辑论点草稿" },
    "ThesisDraftError.VERSION_CONFLICT": { status: 409, message: "草稿版本已变化，请刷新后重试" },
    "ThesisDraftError.NON_DRAFT": { status: 409, message: "草稿版本已变化，请刷新后重试" },
  },
};

export const THESIS_PUBLICATION_ERRORS: ModuleErrorTable = {
  fallback: { code: "DATABASE", status: 503, message: "发布操作暂不可用，请稍后重试" },
  codes: {
    "ThesisPublicationError.VALIDATION": { status: 400, message: "发布或撤回请求无效" },
    "ThesisPublicationError.NOT_FOUND": { status: 404, message: "未找到可发布的论点版本" },
    "ThesisPublicationError.VERSION_CONFLICT": { status: 409, message: "论点版本已变化或当前不可发布，请刷新后重试" },
    "ThesisPublicationError.NON_DRAFT": { status: 409, message: "论点版本已变化或当前不可发布，请刷新后重试" },
    "ThesisPublicationError.NOT_PUBLISHED": { status: 409, message: "论点版本已变化或当前不可发布，请刷新后重试" },
    "ThesisPublicationError.PUBLICATION_DISABLED": { status: 409, message: "论点版本已变化或当前不可发布，请刷新后重试" },
  },
};

export const THESIS_CHANGE_REVIEW_ERRORS: ModuleErrorTable = {
  fallback: { code: "DATABASE", status: 503, message: "审核操作暂不可用，请稍后重试" },
  codes: {
    "ThesisChangeReviewError.VALIDATION": { status: 400, message: "审核请求无效" },
    "ThesisChangeReviewError.NOT_FOUND": { status: 404, message: "未找到可审核的论点版本" },
    "ThesisChangeReviewError.NO_PREVIOUS_BRIEF": { status: 409, message: (error) => error.message },
    "ThesisChangeReviewError.VERSION_CONFLICT": { status: 409, message: "审核身份已变化或有不同决定，请刷新后重试" },
  },
};

export const THESIS_EVALUATION_ERRORS: ModuleErrorTable = {
  fallback: { code: "DATABASE", status: 503, message: "重新评估暂不可用，请稍后重试" },
  codes: {
    "ThesisEvaluationError.VALIDATION": { status: 400, message: "重新评估请求无效" },
    "ThesisEvaluationError.NOT_FOUND": { status: 404, message: "未找到该影响论点" },
  },
};

export const DAILY_BRIEF_PUBLICATION_ERRORS: ModuleErrorTable = {
  fallback: { code: "DATABASE", status: 503, message: "每日判定操作暂不可用，请稍后重试" },
  codes: {
    "DailyBriefError.VALIDATION": { status: 400, message: "每日判定请求无效" },
    "DailyBriefError.NOT_FOUND": { status: 404, message: "未找到该日期的每日判定" },
    "DailyBriefError.VERSION_CONFLICT": {
      status: 409,
      message: "每日判定内容或版本已变化，请刷新后重试",
      details: (error) => error.details,
    },
    "DailyBriefError.IMMUTABLE": { status: 409, message: "该日期的每日判定已发布且不可替换" },
    // `details.stage` names the statement that did not take effect (no SQL, no stored values), so
    // an operator can tell a write-guard failure apart from a transient storage error.
    "DailyBriefError.DATABASE": {
      status: 503,
      message: "每日判定写入或读取失败，请稍后重试",
      details: (error) => error.details,
    },
    "DailyPublicationTargetError.VALIDATION": { status: 400, message: "每日判定截止时间无效" },
  },
};

export function logPublicRouteError(requestId: string, path: string, error: unknown): void {
  // 字段名遵循 logging spec 的稳定字段（handler/requestId）；path 只含 pathname，
  // 不含查询串，避免把可能带 token 的 query 写进日志。
  console.warn(JSON.stringify({
    handler: "public-route",
    requestId,
    path,
    error: String(error),
  }));
}
