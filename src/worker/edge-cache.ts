import type { EdgeCache, RequestHandlerDependencies } from "./context";

/**
 * Edge cache for the public read entry (R4). Worker responses do not enter the Cloudflare edge
 * cache by default, so every visitor would re-hit D1 even though the envelope is identical for
 * up to max-age=60. This module wraps `caches.default` for exactly two routes — parameterless
 * `GET /api/v1/overview` and `GET /api/v1/data-health` — leaving every other path byte-identical
 * in behavior.
 *
 * Semantics:
 * - TTL is owned by the response's existing Cache-Control (max-age=60 + stale-while-revalidate);
 *   the header value is never modified here.
 * - Only 200 responses are stored; 404/405/5xx, admin, feed/sitemap/robots, healthz, any request
 *   carrying query parameters and any non-GET method are never cached.
 * - A hit is the stored envelope plus `X-ENSO-Cache: hit`; the first (miss) response carries no
 *   such header, so absence of the header means "served by this isolate".
 * - `cache.put` runs inside `ctx.waitUntil`, so it never delays the response. Without an
 *   execution context (tests calling `handleRequest` directly) the put is skipped and the
 *   pipeline degrades safely to the uncached behavior.
 * - HEAD requests are normalized to GET before dispatch (see `handleRequest`), so they share the
 *   exact cache semantics of GET, matching the documented "HEAD headers equal GET headers" rule.
 */

/** Minimal execution-context surface the fetch entry needs; the real ExportedHandler ctx (with
 * `passThroughOnException` etc.) satisfies it structurally, and tests can pass a bare fake. */
export type FetchWaitUntilContext = Pick<ExecutionContext, "waitUntil">;

/** The two public GET envelopes worth caching at the edge; anything else is deliberately excluded. */
const EDGE_CACHEABLE_PATHS = new Set<string>(["/api/v1/overview", "/api/v1/data-health"]);

const EDGE_CACHE_HIT_HEADER = "x-enso-cache";

/**
 * No-op stand-in for runtimes without a Cache API (unit tests running under Node): lookups never
 * hit and puts do nothing, which reproduces the pre-R4 behavior exactly.
 */
const NOOP_EDGE_CACHE: EdgeCache = {
  match: async () => undefined,
  put: async () => undefined,
};

/** Explicit injection wins; otherwise the runtime's `caches.default` when present, else no-op. */
export function resolveEdgeCache(dependencies: RequestHandlerDependencies): EdgeCache {
  if (dependencies.edgeCache !== undefined) return dependencies.edgeCache;
  // workerd exposes caches.default; Node (unit tests) has no `caches` global at all.
  const runtime = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return runtime?.default ?? NOOP_EDGE_CACHE;
}

export function isEdgeCacheableRequest(request: Request, url: URL): boolean {
  return request.method === "GET" && url.search === "" && EDGE_CACHEABLE_PATHS.has(url.pathname);
}

/**
 * Returns the cached response for a cacheable request, or null when the request is not cacheable
 * or the edge has no entry. The hit is re-wrapped with `X-ENSO-Cache: hit` so the stored copy
 * stays pristine for subsequent hits.
 */
export async function edgeCacheLookup(
  request: Request,
  url: URL,
  dependencies: RequestHandlerDependencies,
): Promise<Response | null> {
  if (!isEdgeCacheableRequest(request, url)) return null;
  const hit = await resolveEdgeCache(dependencies).match(request);
  if (hit === undefined) return null;
  const headers = new Headers(hit.headers);
  headers.set(EDGE_CACHE_HIT_HEADER, "hit");
  return new Response(hit.body, {
    status: hit.status,
    statusText: hit.statusText,
    headers,
  });
}

/**
 * Stores a cacheable 200 response for later hits. The put happens inside `ctx.waitUntil` (or not
 * at all when no execution context is available) and clones the pre-security-headers response —
 * hits re-enter `handleRequest`, so `withSecurityHeaders` is applied uniformly to both paths.
 */
export function edgeCacheStore(
  request: Request,
  url: URL,
  response: Response,
  dependencies: RequestHandlerDependencies,
  executionContext: FetchWaitUntilContext | undefined,
): void {
  if (!isEdgeCacheableRequest(request, url)) return;
  if (response.status !== 200) return;
  if (executionContext === undefined) return;
  executionContext.waitUntil(resolveEdgeCache(dependencies).put(request, response.clone()));
}
