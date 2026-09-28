import type { ApiEnvelope, ApiErrorEnvelope, ApiMeta } from "../../domain/contracts";

/**
 * Response envelope mechanics shared by every Worker route: the JSON envelope builder, the
 * Cache-Control vocabulary and the small response/error shorthands. Route code only picks a
 * constant and a payload; header and envelope shapes live here so they cannot drift per route.
 */

export const CACHE_CONTROL_NO_STORE = "no-store";
export const CACHE_CONTROL_OVERVIEW = "public, max-age=60, stale-while-revalidate=300";
export const CACHE_CONTROL_SHORT_LIVED = "public, max-age=60, stale-while-revalidate=60";
export const CACHE_CONTROL_INDICATOR_SERIES = "public, max-age=300, stale-while-revalidate=300";
export const CACHE_CONTROL_ATOM_FEED = "public, max-age=300, stale-while-revalidate=300";
export const CACHE_CONTROL_DAILY_BRIEF = "public, max-age=3600, stale-while-revalidate=3600";
export const CACHE_CONTROL_METHODOLOGY = "public, max-age=86400, stale-while-revalidate=86400";

export function json<T>(
  body: ApiEnvelope<T> | ApiErrorEnvelope,
  status = 200,
  cacheControl: string = CACHE_CONTROL_NO_STORE,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": cacheControl,
    },
  });
}

/** The generatedAt / dataCutoff / methodologyVersion triple repeated by every page envelope. */
export function pageMeta(
  generatedAt: string,
  dataCutoff: string,
  methodologyVersion: string,
): ApiMeta {
  return { generatedAt, dataCutoff, methodologyVersion };
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  requestId: string,
  details?: unknown,
): Response {
  return json(
    { error: details === undefined ? { code, message, requestId } : { code, message, requestId, details } },
    status,
  );
}

/** The route-table fallback: no registered pattern covers the request path. */
export function notFoundResponse(requestId: string): Response {
  return errorResponse("NOT_FOUND", "未找到该接口", 404, requestId);
}

/**
 * The one deliberately new status: the path is a registered route but its method is not. The
 * `Allow` header lists the methods that pattern serves. Carries no body by design — the 405
 * contract is the status line plus the header.
 */
export function methodNotAllowedResponse(allow: readonly string[]): Response {
  return new Response(null, {
    status: 405,
    headers: {
      "allow": allow.join(", "),
      "cache-control": CACHE_CONTROL_NO_STORE,
    },
  });
}
