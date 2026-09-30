import { REQUIRED_DAILY_THESIS_IDS, type DailyBriefExemption, type RequiredDailyThesisId } from "../../domain/daily-brief";
import { isAdminThesisId } from "../modules/admin-read-models";
import type { ThesisChangeReviewDecision } from "../modules/thesis-change-reviews";
import { json } from "./envelope";

/**
 * Administrative request-body mechanics. Public routes are GET-only and never read a request
 * body — every parser here belongs to an admin write route, and every parser funnels through
 * parseBoundedAdministrativeJson so the 64 KiB ceiling cannot drift per route.
 */

export const ADMINISTRATIVE_BODY_LIMIT_BYTES = 64 * 1024;

/** 后台写路由请求体超过统一上限时抛出；由各路由在解析点转成 413 envelope。 */
export class AdministrativeBodyTooLargeError extends Error {
  constructor() {
    super("administrative request body exceeds the allowed size");
    this.name = "AdministrativeBodyTooLargeError";
  }
}

/**
 * 后台写路由共用的 JSON 请求体读取入口：先按声明的 content-length 拒绝超限载荷，
 * 缺失或不可信的声明长度再由流式计数兜底（对照 adapters/sources/http.ts 的既有流式上限读法）。
 * 畸形 JSON 返回 null，交由各路由既有校验归为 400；超过上限抛出专用错误以返回 413。
 */
export async function parseBoundedAdministrativeJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > ADMINISTRATIVE_BODY_LIMIT_BYTES) {
    throw new AdministrativeBodyTooLargeError();
  }

  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > ADMINISTRATIVE_BODY_LIMIT_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // 取消已超限的流失败无需处理：请求体即将被整体丢弃。
      }
      throw new AdministrativeBodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export function administrativeBodyTooLargeResponse(requestId: string): Response {
  return json({
    error: { code: "VALIDATION", message: "请求体超过允许大小", requestId },
  }, 413);
}

export interface AdministrativeThesisEvaluateBody {
  readonly reason: string;
  readonly cutoff: string | null;
}

/**
 * A manual re-evaluation carries only the audit reason and an optional cutoff. It cannot supply
 * evidence, weights or a stage, because those are rebuilt by the shared evaluation core.
 */
export async function parseAdministrativeThesisEvaluateBody(
  request: Request,
): Promise<AdministrativeThesisEvaluateBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await parseBoundedAdministrativeJson(request);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["reason", "cutoff", "confirm"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (record.confirm !== true) return null;
    const reason = boundedText(record.reason, 500);
    if (reason === null) return null;
    if (record.cutoff === undefined || record.cutoff === null) return { reason, cutoff: null };
    if (typeof record.cutoff !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.cutoff)) return null;
    if (new Date(record.cutoff).toISOString() !== record.cutoff) return null;
    return { reason, cutoff: record.cutoff };
  } catch (error) {
    if (error instanceof AdministrativeBodyTooLargeError) throw error;
    return null;
  }
}

export interface AdministrativeDailyPublicationBody {
  readonly cutoff: string;
  readonly headline: string;
  readonly summary: string;
  readonly topChanges: readonly string[];
  readonly reason: string;
  readonly expectedFreezeKey: string | null;
  readonly exemptions: readonly DailyBriefExemption[];
}

/**
 * Accepts only editorial copy plus the concurrency token. Targets are resolved server-side from the
 * cutoff so a caller cannot choose which public content a daily brief freezes.
 */
export async function parseAdministrativeDailyPublicationBody(
  request: Request,
): Promise<AdministrativeDailyPublicationBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await parseBoundedAdministrativeJson(request);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set([
      "cutoff", "headline", "summary", "topChanges", "reason", "expectedFreezeKey", "confirm",
      "exemptions",
    ]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (record.confirm !== true || typeof record.cutoff !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.cutoff)) return null;
    if (new Date(record.cutoff).toISOString() !== record.cutoff) return null;
    const headline = boundedText(record.headline, 200);
    const summary = boundedText(record.summary, 2_000);
    const reason = boundedText(record.reason, 500);
    if (headline === null || summary === null || reason === null) return null;

    const rawChanges = record.topChanges;
    if (!Array.isArray(rawChanges) || rawChanges.length > 3) return null;
    const topChanges: string[] = [];
    for (const item of rawChanges) {
      const changeId = boundedText(item, 128);
      if (changeId === null || topChanges.includes(changeId)) return null;
      topChanges.push(changeId);
    }

    const exemptions = parseAdministrativeDailyExemptions(record.exemptions);
    if (exemptions === null) return null;

    const expectedFreezeKey = record.expectedFreezeKey === undefined || record.expectedFreezeKey === null
      ? null
      : boundedText(record.expectedFreezeKey, 160);
    if (record.expectedFreezeKey !== undefined && record.expectedFreezeKey !== null && expectedFreezeKey === null) {
      return null;
    }

    return { cutoff: record.cutoff, headline, summary, topChanges, reason, expectedFreezeKey, exemptions };
  } catch (error) {
    if (error instanceof AdministrativeBodyTooLargeError) throw error;
    return null;
  }
}

/**
 * Exemptions are acknowledged coverage gaps, not a way to choose frozen content: only a required
 * thesis id and a gap id are accepted, at most one per thesis.
 */
function parseAdministrativeDailyExemptions(value: unknown): readonly DailyBriefExemption[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > REQUIRED_DAILY_THESIS_IDS.length) return null;
  const exemptions: DailyBriefExemption[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    const keys = Object.keys(entry);
    if (keys.length !== 2 || !keys.includes("thesisId") || !keys.includes("gapId")) return null;
    const thesisId = entry.thesisId;
    const gapId = boundedText(entry.gapId, 128);
    if (
      typeof thesisId !== "string"
      || !REQUIRED_DAILY_THESIS_IDS.includes(thesisId as RequiredDailyThesisId)
      || gapId === null
      || seen.has(thesisId)
    ) return null;
    seen.add(thesisId);
    exemptions.push({ thesisId: thesisId as RequiredDailyThesisId, gapId });
  }
  return exemptions;
}

export interface AdministrativeThesisReviewBody {
  readonly thesisId: string;
  readonly beforeVersionId: string;
  readonly decision: ThesisChangeReviewDecision;
  readonly reason: string;
}

/**
 * Accepts only the reviewed transition identity, the decision and a reason. Evidence, calculation
 * and weight fields stay out of the administrative boundary because they are rebuildable through
 * the evaluation workflow.
 */
export async function parseAdministrativeThesisReviewBody(
  request: Request,
): Promise<AdministrativeThesisReviewBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await parseBoundedAdministrativeJson(request);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["thesisId", "beforeVersionId", "decision", "reason", "confirm"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (
      record.confirm !== true
      || typeof record.thesisId !== "string"
      || !isAdminThesisId(record.thesisId)
      || (record.decision !== "approved" && record.decision !== "rejected")
    ) return null;
    const beforeVersionId = boundedText(record.beforeVersionId, 128);
    const reason = boundedText(record.reason, 500);
    if (beforeVersionId === null || reason === null) return null;
    return {
      thesisId: record.thesisId,
      beforeVersionId,
      decision: record.decision,
      reason,
    };
  } catch (error) {
    if (error instanceof AdministrativeBodyTooLargeError) throw error;
    return null;
  }
}

export async function parseManualSourceRunBody(
  request: Request,
): Promise<{ readonly reason: string; readonly force: boolean } | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await parseBoundedAdministrativeJson(request);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    // 键集：reason 必填；force 可选（一键「强制重新解析」——解析器修复后让同一页面重新入库）。
    const keys = Object.keys(record);
    if (keys.length !== 1 && keys.length !== 2) return null;
    if (typeof record.reason !== "string") return null;
    if (keys.includes("force") && record.force !== true) return null;
    const reason = record.reason.trim();
    return reason.length >= 1 && reason.length <= 500
      ? { reason, force: record.force === true }
      : null;
  } catch (error) {
    if (error instanceof AdministrativeBodyTooLargeError) throw error;
    return null;
  }
}

export interface AdministrativeDraftEditBody {
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly summary: string | undefined;
  readonly invalidation: string | undefined;
  readonly reason: string;
}

export async function parseAdministrativeDraftEditBody(request: Request): Promise<AdministrativeDraftEditBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await parseBoundedAdministrativeJson(request);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["thesisId", "expectedVersion", "summary", "invalidation", "reason"]);
    if (Object.keys(record).some((key) => !allowed.has(key))) return null;
    if (
      typeof record.thesisId !== "string"
      || !isAdminThesisId(record.thesisId)
      || !Number.isInteger(record.expectedVersion)
      || (record.expectedVersion as number) < 1
      || typeof record.reason !== "string"
    ) return null;
    const summary = editableText(record.summary, 500);
    const invalidation = editableText(record.invalidation, 2_000);
    const reason = boundedText(record.reason, 500);
    if (
      reason === null
      || summary === null
      || invalidation === null
      || (summary === undefined && invalidation === undefined)
    ) return null;
    return {
      thesisId: record.thesisId,
      expectedVersion: record.expectedVersion as number,
      summary: summary ?? undefined,
      invalidation: invalidation ?? undefined,
      reason,
    };
  } catch (error) {
    if (error instanceof AdministrativeBodyTooLargeError) throw error;
    return null;
  }
}

export interface AdministrativeThesisPublicationBody {
  readonly thesisId: string;
  readonly expectedVersion: number;
  readonly reason: string;
}

export async function parseAdministrativeThesisPublicationBody(
  request: Request,
): Promise<AdministrativeThesisPublicationBody | null> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return null;
  try {
    const parsed: unknown = await parseBoundedAdministrativeJson(request);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const allowed = new Set(["thesisId", "expectedVersion", "reason", "confirm"]);
    if (
      Object.keys(record).some((key) => !allowed.has(key))
      || record.confirm !== true
      || typeof record.thesisId !== "string"
      || !isAdminThesisId(record.thesisId)
      || !Number.isInteger(record.expectedVersion)
      || (record.expectedVersion as number) < 1
    ) return null;
    const reason = boundedText(record.reason, 500);
    return reason === null ? null : {
      thesisId: record.thesisId,
      expectedVersion: record.expectedVersion as number,
      reason,
    };
  } catch (error) {
    if (error instanceof AdministrativeBodyTooLargeError) throw error;
    return null;
  }
}

export function editableText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  return boundedText(value, maximumLength);
}

export function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && [...normalized].length <= maximumLength ? normalized : null;
}

export function parseIdempotencyKey(value: string | null): string | null {
  if (value === null) return null;
  const key = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key) ? key : null;
}
